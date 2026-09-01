import * as net from 'net';
import { SerialPortConsumer } from '../../SerialPortConnection/SerialPortConsumer';

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
    for (const socket of this.sockets) {
      socket.write(data);
    }
  }

  onClosed(): void {
    this.closed = true;
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
}
