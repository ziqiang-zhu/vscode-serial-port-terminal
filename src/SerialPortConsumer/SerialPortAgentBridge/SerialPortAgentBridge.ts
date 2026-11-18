import * as net from 'net';
import { setTimeout } from 'timers';
import { SerialPortConsumer } from '../../SerialPortConnection/SerialPortConsumer';
import { SerialPortAnsiStripper } from '../SerialPortDataParsers/SerialPortAnsiStripper';

const IDLE_FLUSH_MS = 200;

export interface AgentBridgeAddress {
  host: string;
  port: number;
}

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
      const onError = (error: Error) => {
        this.server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.removeListener('error', onError);
        const address = this.server.address();
        const actualPort = typeof address === 'object' && address ? address.port : this.port;
        resolve({ host: this.bindHost, port: actualPort });
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
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
    if (this.server.listening) {
      this.server.close();
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
