import { SerialPort } from 'serialport';
import { SerialPortHal, SerialPortHandle, SerialPortInfo, SerialPortOpenOptions } from './SerialPortHal';

class SerialPortHandleImpl implements SerialPortHandle {
  constructor(private readonly port: SerialPort) {
    // 兜底监听：防止无监听时 Node 因 unhandled 'error' 事件崩溃，同时保留错误可观测性。
    port.on('error', (error) => {
      console.error('[serial-port] port error:', error);
    });
  }

  close(): Promise<void> {
    return new Promise(resolve => {
      this.port.close(() => resolve());
    });
  }

  write(data: Buffer): boolean {
    return this.port.write(data);
  }

  onDrain(listener: () => void): void {
    this.port.on('drain', listener);
  }

  onData(listener: (data: Buffer) => void): void {
    this.port.on('data', listener);
  }

  onError(listener: (error: Error) => void): void {
    this.port.on('error', listener);
  }
}

export class SerialPortHalImpl implements SerialPortHal {
  listDevices(): Promise<SerialPortInfo[]> {
    return SerialPort.list();
  }

  openPort(options: SerialPortOpenOptions): Promise<SerialPortHandle> {
    return new Promise((resolve, reject) => {
      let port: SerialPort;
      try {
        port = new SerialPort({ ...options, autoOpen: false } as ConstructorParameters<typeof SerialPort>[0]);
      } catch (error) {
        reject(error);
        return;
      }
      port.open(error => {
        if (error) {
          port.on('error', () => {});
          try {
            port.close(() => {});
          } catch {
            // 打开失败后的尽力清理，忽略关闭错误
          }
          reject(error);
          return;
        }
        resolve(new SerialPortHandleImpl(port));
      });
    });
  }
}
