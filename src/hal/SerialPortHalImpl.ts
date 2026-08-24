import { SerialPort } from 'serialport';
import { SerialPortHal, SerialPortHandle, SerialPortInfo, SerialPortOpenOptions } from './SerialPortHal';

class SerialPortHandleImpl implements SerialPortHandle {
  constructor(private readonly port: SerialPort) {
    port.on('error', () => {});
  }

  close(): Promise<void> {
    return new Promise(resolve => {
      this.port.close(() => resolve());
    });
  }

  write(data: Buffer): void {
    this.port.write(data);
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
