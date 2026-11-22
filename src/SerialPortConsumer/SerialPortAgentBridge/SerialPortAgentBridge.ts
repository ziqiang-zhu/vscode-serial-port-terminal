import * as net from 'net';
import { setTimeout } from 'timers';
import { SerialPortConsumer } from '../../SerialPortConnection/SerialPortConsumer';
import { SerialPortAnsiStripper } from '../SerialPortDataParsers/SerialPortAnsiStripper';

const IDLE_FLUSH_MS = 200;

export interface AgentBridgeAddress {
  host: string;
  port: number;
}

// 启动挂起被取消的专属错误类型（listening 送达前 server 已被关闭——启动期间点了
// 停止 / 断开收尾）：startBridge 的 catch 据此静默返回，与端口占用等真实失败区分。
export class AgentBridgeCancelledError extends Error {}

export class SerialPortAgentBridge extends SerialPortConsumer {
  readonly id = 'serialPortAgentBridge';
  readonly displayName = 'Serial Port Agent Bridge';

  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private readonly bindHost: string;
  private readonly ansiStripper = new SerialPortAnsiStripper();
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(
    host: string,
    private readonly port: number,
    // 只读模式（安全增强）：客户端仅能接收设备数据，发送的字节被忽略——
    // 不挂 data handler，内核未读缓冲自动丢弃，设备侧收不到任何注入。
    private readonly readonlyMode = false,
    // ANSI 剥离开关：默认开启（终端语义，
    // 颜色码剥离 + 空闲刷出）；关闭时字节原样透传——不经剥离行缓冲、不挂空闲
    // 刷出（消除 200ms 固有延迟），二进制协议不被 UTF-8 往返损坏。
    private readonly stripAnsi = true
  ) {
    super();
    this.bindHost = host;
    this.server = net.createServer(socket => this.onClientConnected(socket));
    this.server.on('error', () => {});
  }

  isReadonly(): boolean {
    return this.readonlyMode;
  }

  isStripAnsi(): boolean {
    return this.stripAnsi;
  }

  listen(): Promise<AgentBridgeAddress> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        settled = true;
        this.server.removeListener('error', onError);
        this.server.removeListener('listening', onListening);
        this.server.removeListener('close', onClose);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onListening = () => {
        cleanup();
        const address = this.server.address();
        const actualPort = typeof address === 'object' && address ? address.port : this.port;
        resolve({ host: this.bindHost, port: actualPort });
      };
      // server 在 listening 送达前被关闭（启动期间点了停止 / 断开收尾）：取消挂起
      // 并 reject 取消错误——否则 promise 永久 pending，实例泄漏。
      const onClose = () => {
        if (!settled) {
          cleanup();
          reject(new AgentBridgeCancelledError());
        }
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.once('close', onClose);
      this.server.listen(this.port, this.bindHost);
    });
  }

  onData(data: Buffer): void {
    if (this.closed || this.sockets.size === 0) {
      return;
    }
    if (this.stripAnsi) {
      this.broadcast(this.ansiStripper.process(data));
      this.armIdleFlush(); // 空闲刷出仅为剥离行缓冲服务；透传模式数据即时到达
    } else {
      this.broadcast(data);
    }
  }

  onClosed(): void {
    this.closed = true;
    this.disarmIdleFlush();
    // 断开收尾：剥离模式下先向在线客户端刷出保留的半行，再销毁连接；
    // 透传模式无缓冲，直接销毁。
    if (this.stripAnsi) {
      this.broadcast(this.ansiStripper.flush());
    }
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    // 无条件 close（listening 窗口的早边缘也不跳过）：'close' 事件是 listen 挂起
    // 的取消信号；显式端口的句柄在 listen() 调用时已同步建立，close 总是有效，
    // 极早窗口的抛错防御性吞掉。
    try {
      this.server.close();
    } catch {
      // ignore
    }
  }

  private onClientConnected(socket: net.Socket): void {
    if (this.closed) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    if (!this.readonlyMode) {
      socket.on('data', chunk => {
        this.send(chunk);
      });
    }
    socket.on('error', () => {});
    socket.on('close', () => {
      this.sockets.delete(socket);
    });
  }

  // 空闲刷出：半行滞留超过 200ms 即剥离广播，消除提示符延迟。
  private armIdleFlush(): void {
    this.disarmIdleFlush();
    this.idleTimer = setTimeout(() => this.onIdleFlush(), IDLE_FLUSH_MS);
    this.idleTimer.unref();
  }

  private disarmIdleFlush(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private onIdleFlush(): void {
    this.idleTimer = undefined;
    if (this.closed) {
      return;
    }
    this.broadcast(this.ansiStripper.flush());
  }

  private broadcast(data: Buffer): void {
    if (data.length === 0 || this.sockets.size === 0) {
      return;
    }
    for (const socket of this.sockets) {
      socket.write(data);
    }
  }
}
