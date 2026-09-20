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

  constructor(host: string, private readonly port: number) {
    super();
    this.bindHost = host;
    this.server = net.createServer(socket => this.onClientConnected(socket));
    this.server.on('error', () => {});
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
    this.broadcast(this.ansiStripper.process(data));
    this.armIdleFlush();
  }

  onClosed(): void {
    this.closed = true;
    this.disarmIdleFlush();
    // 断开收尾：先向在线客户端刷出保留的半行，再销毁连接。
    this.broadcast(this.ansiStripper.flush());
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
    socket.on('data', chunk => {
      this.send(chunk);
    });
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
