export type SerialPortDeviceStatus = 'connected' | 'disconnected' | 'connecting';

export interface SerialPortDeviceInterface {
  readonly path: string;
  readonly vendorId: string;
  readonly productId: string;
  readonly manufacturer: string;
  readonly serialNumber: string;
  readonly locationId: string;
  readonly identity: string;
  readonly status: SerialPortDeviceStatus;
  setStatus(status: SerialPortDeviceStatus): void;
}
