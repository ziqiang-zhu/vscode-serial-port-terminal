import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { SerialPortHalComposite } from '../../../src/hal/SerialPortHalComposite';
import { SerialPortHalImpl } from '../../../src/hal/SerialPortHalImpl';
import { SerialPortHalVirtual } from '../../../src/hal/SerialPortHalVirtual/SerialPortHalVirtual';
import { SerialPortDeviceDetector } from '../../../src/SerialPortDeviceDetector/SerialPortDeviceDetector';
import { SerialPortDeviceInterface } from '../../../src/SerialPortDeviceDetector/SerialPortDeviceInterface';
import { SerialPortConnectionService } from '../../../src/SerialPortConnection/SerialPortConnectionService';
import { SerialPortConsumer } from '../../../src/SerialPortConnection/SerialPortConsumer';

// 自装配基础设施（契约见 doc/Test/开发测试体系规划.md §3 P1）：
// 鸭子类型 context（业务模块仅用到 subscriptions）+ 虚拟 HAL 混排（与产品测试构建
// 的 createSerialPortHal 装配同构）。全部运行在真实 vscode API 之上。
export interface TestHarness {
  virtual: SerialPortHalVirtual;
  detector: SerialPortDeviceDetector;
  service: SerialPortConnectionService;
  /** context.subscriptions（Service 与 Detector 均已注册其中）——dispose 模拟扩展停用。 */
  subscriptions: { dispose(): unknown }[];
}

export function createHarness(defaultConsumerFactory?: () => SerialPortConsumer): TestHarness {
  const subscriptions: { dispose(): unknown }[] = [];
  const stubContext = { subscriptions } as unknown as vscode.ExtensionContext;
  const virtual = new SerialPortHalVirtual();
  const hal = new SerialPortHalComposite(new SerialPortHalImpl(), virtual);
  const detector = new SerialPortDeviceDetector(hal, stubContext);
  const service = new SerialPortConnectionService(hal, detector, stubContext, defaultConsumerFactory);
  return { virtual, detector, service, subscriptions };
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// 轮询等待条件成立（真实异步环境无 mock.timers；写盘、TCP、状态回写均为异步到达）。
// dump 可选：超时失败时附带现场快照，便于定位。
export async function waitFor(
  message: string,
  probe: () => boolean,
  timeoutMs = 5000,
  dump?: () => string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!probe()) {
    if (Date.now() > deadline) {
      const snapshot = dump ? `\n--- dump ---\n${dump()}` : '';
      throw new Error(`waitFor timeout: ${message}${snapshot}`);
    }
    await sleep(25);
  }
}

// 记录型 Consumer：断言 onData 到达与 onClosed 生命周期。
export class RecordingConsumer extends SerialPortConsumer {
  readonly received: string[] = [];
  closed = false;

  constructor(readonly id: string, readonly displayName = 'Recording Consumer') {
    super();
  }

  onData(data: Buffer): void {
    this.received.push(data.toString('utf8'));
  }

  onClosed(): void {
    this.closed = true;
  }
}

// 虚拟侧路径固定，查找失败即用例前置失败。
export function findDevice(detector: SerialPortDeviceDetector, virtualPath: string): SerialPortDeviceInterface {
  const device = detector.getDevices().find(item => item.path === virtualPath);
  if (!device) {
    throw new Error(`device not found after scan: ${virtualPath}`);
  }
  return device;
}

// 临时目录（用后整删）。
export function withTempDir(): { dir: string; dispose(): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spt-integration-'));
  return { dir, dispose: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// TCP 测试客户端：收集服务端广播并感知关闭。
export class TcpTestClient {
  private readonly chunks: Buffer[] = [];
  private closeResolve?: () => void;
  private readonly closePromise: Promise<void>;
  private readonly connectedPromise: Promise<void>;

  readonly socket: net.Socket;

  constructor(port: number, host = '127.0.0.1') {
    this.closePromise = new Promise(resolve => {
      this.closeResolve = resolve;
    });
    this.socket = net.connect(port, host);
    // 连接/错误监听必须在构造期注册：socket 可能在测试真正 await connected()
    // 之前就完成握手（loopback 极快），迟挂监听会错过事件导致 Promise 永不 settle。
    this.connectedPromise = new Promise((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('error', reject);
    });
    this.socket.on('data', chunk => this.chunks.push(chunk));
    this.socket.on('close', () => this.closeResolve?.());
  }

  get text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }

  async connected(): Promise<void> {
    await this.handshaken();
    // 确定性的服务端就绪信号：写探针、等回显。仅等待客户端 connect 事件存在
    // 竞态——服务端 accept 的回调时序（Windows IOCP 上尤甚）可能晚于客户端
    // connect 的处理，而桥在无客户端时会按设计丢弃设备数据。探针写入经服务端
    // 内核缓冲必达且回显意味着：accept 已完成、桥的客户端集合含本连接、
    // 设备回显链路可用（探针依赖所测套件的 Echo 设备）。
    // ⚠️ 只读桥（readonlyMode）上该探针不可用——客户端→设备路径被设计性丢弃，
    // 请改用 handshaken() + 等待设备→客户端方向的广播数据。
    this.socket.write('probe\n', 'utf8');
    await waitFor('probe echo (server-side ready)', () => this.text.includes('probe'));
  }

  // 仅等待 TCP 握手完成（无探针）。供只读桥等"客户端→设备路径不可用"的场景：
  // 就绪信号改由「设备数据广播到达」承担（广播需要 socket 已被 accept）。
  async handshaken(): Promise<void> {
    await this.connectedPromise;
  }

  write(text: string): void {
    this.socket.write(text, 'utf8');
  }

  closed(): Promise<void> {
    return this.closePromise;
  }

  dispose(): void {
    this.socket.destroy();
  }
}
