import { SerialConfig } from '../SerialPortConfig/SerialPortQuickConfig';

export interface SerialPortConsumerHost {
  readonly path: string;
  readonly config: SerialConfig;
  readonly label: string | undefined;
  send(data: Buffer): void;
  requestDisconnect(): void;
  addConsumer(consumer: SerialPortConsumer): void;
  removeConsumer(id: string): void;
}

export abstract class SerialPortConsumer {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract onData(data: Buffer): void;
  abstract onClosed(): void;
  onError?(error: Error): void;

  private host?: SerialPortConsumerHost;

  public attach(host: SerialPortConsumerHost): void {
    this.host = host;
  }

  protected send(data: Buffer): void {
    this.host?.send(data);
  }

  protected requestDisconnect(): void {
    this.host?.requestDisconnect();
  }

  protected addConsumer(consumer: SerialPortConsumer): void {
    this.host?.addConsumer(consumer);
  }

  protected removeConsumer(id: string): void {
    this.host?.removeConsumer(id);
  }
}
