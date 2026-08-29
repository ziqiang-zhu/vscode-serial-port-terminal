import * as vscode from 'vscode';
import { SerialPortInfo } from '../hal/SerialPortHal';
import { SerialPortDeviceInterface, SerialPortDeviceStatus } from './SerialPortDeviceInterface';

export function computeDeviceIdentity(info: SerialPortInfo): string {
  const serial = info.serialNumber;
  if (serial && !/^0+$/.test(serial)) {
    return `serial:${serial}`;
  }
  if (info.vendorId && info.productId && info.locationId) {
    return `vid-pid-loc:${info.vendorId}-${info.productId}-${info.locationId}`;
  }
  return `path:${info.path}`;
}

export class SerialPortDeviceImpl implements SerialPortDeviceInterface {
  private _status: SerialPortDeviceStatus = 'disconnected';

  constructor(private readonly info: SerialPortInfo) {}

  get path(): string {
    return this.info.path;
  }

  get vendorId(): string {
    return this.info.vendorId || vscode.l10n.t('Unknown');
  }

  get productId(): string {
    return this.info.productId || vscode.l10n.t('Unknown');
  }

  get manufacturer(): string {
    return this.info.manufacturer || vscode.l10n.t('Unknown');
  }

  get serialNumber(): string {
    return this.info.serialNumber || vscode.l10n.t('Unknown');
  }

  get locationId(): string {
    return this.info.locationId || vscode.l10n.t('Unknown');
  }

  get identity(): string {
    return computeDeviceIdentity(this.info);
  }

  get status(): SerialPortDeviceStatus {
    return this._status;
  }

  setStatus(status: SerialPortDeviceStatus): void {
    this._status = status;
  }
}
