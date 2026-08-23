export interface SerialPortInfo {
  path: string;
  manufacturer?: string | undefined;
  serialNumber?: string | undefined;
  pnpId?: string | undefined;
  locationId?: string | undefined;
  productId?: string | undefined;
  vendorId?: string | undefined;
}

export interface SerialPortOpenOptions {
  path: string;
  baudRate: number;
  dataBits?: number;
  parity?: string;
  stopBits?: number;
  rtscts?: boolean;
}

export interface SerialPortHandle {
  close(): Promise<void>;
  write(data: Buffer): void;
  onData(listener: (data: Buffer) => void): void;
  onError(listener: (error: Error) => void): void;
}

export interface SerialPortHal {
  listDevices(): Promise<SerialPortInfo[]>;
  openPort(options: SerialPortOpenOptions): Promise<SerialPortHandle>;
}
