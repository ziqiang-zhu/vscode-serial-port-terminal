export interface SerialPortConsumerHost {
  readonly path: string;
  send(data: Buffer): void;
  requestDisconnect(): void;
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
}
