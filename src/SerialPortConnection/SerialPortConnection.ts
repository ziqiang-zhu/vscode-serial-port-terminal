import { SerialPortHandle } from '../hal/SerialPortHal';
import { SerialPortDeviceInterface } from '../SerialPortDeviceDetector/SerialPortDeviceInterface';

export class SerialPortConnection {
  constructor(
    private readonly device: SerialPortDeviceInterface,
    private readonly handle: SerialPortHandle
  ) {
    this.handle.onError(error => {
      console.error(`Serial port error (${device.path}):`, error);
    });
  }

  public close(): Promise<void> {
    return this.handle.close();
  }
}
