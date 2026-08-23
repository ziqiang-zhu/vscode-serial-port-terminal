import { SerialPortHandle } from '../hal/SerialPortHal';
import { SerialPortDeviceInterface } from '../SerialPortDeviceDetector/SerialPortDeviceInterface';
import { SerialConfig } from '../SerialPortConfig/SerialPortQuickConfig';
import { SerialPortConsumer, SerialPortConsumerHost } from './SerialPortConsumer';

export class SerialPortConnection implements SerialPortConsumerHost {
  private readonly consumers = new Map<string, SerialPortConsumer>();

  constructor(
    private readonly device: SerialPortDeviceInterface,
    private readonly handle: SerialPortHandle,
    readonly config: SerialConfig,
    private readonly onCloseRequested: () => void
  ) {
    this.handle.onError(error => {
      console.error(`Serial port error (${device.path}):`, error);
      for (const consumer of this.consumers.values()) {
        consumer.onError?.(error);
      }
    });

    this.handle.onData(data => {
      for (const consumer of this.consumers.values()) {
        consumer.onData(data);
      }
    });
  }

  get path(): string {
    return this.device.path;
  }

  public addConsumer(consumer: SerialPortConsumer): void {
    this.consumers.get(consumer.id)?.onClosed();
    consumer.attach(this);
    this.consumers.set(consumer.id, consumer);
  }

  public removeConsumer(id: string): void {
    const consumer = this.consumers.get(id);
    if (consumer) {
      consumer.onClosed();
      this.consumers.delete(id);
    }
    if (this.consumers.size === 0) {
      this.onCloseRequested();
    }
  }

  public send(data: Buffer): void {
    this.handle.write(data);
  }

  public requestDisconnect(): void {
    this.onCloseRequested();
  }

  public close(): Promise<void> {
    for (const consumer of this.consumers.values()) {
      consumer.onClosed();
    }
    this.consumers.clear();
    return this.handle.close();
  }
}
