import * as vscode from 'vscode';
import { SerialPortDeviceInterface } from '../SerialPortDeviceDetector/SerialPortDeviceInterface';
import { SerialConfig, formatSerialConfigDetails, formatSerialConfigSummary } from '../SerialPortConfig/SerialPortQuickConfig';

export class SerialPortDeviceTreeItem extends vscode.TreeItem {
  constructor(public readonly device: SerialPortDeviceInterface) {
    super(device.path, vscode.TreeItemCollapsibleState.None);
    this.description = device.manufacturer;
    this.tooltip = this.baseTooltip();
    this.syncStatusAppearance();
  }

  public syncConnectionConfig(config: SerialConfig | undefined): void {
    this.description = config
      ? `${this.device.manufacturer} · ${formatSerialConfigSummary(config)}`
      : this.device.manufacturer;
    this.tooltip = config
      ? `${this.baseTooltip()}\n${formatSerialConfigDetails(config)}`
      : this.baseTooltip();
  }

  private baseTooltip(): string {
    return vscode.l10n.t(
      'Path: {0}\nVendorID: {1}\nProductID: {2}\nManufacturer: {3}',
      this.device.path,
      this.device.vendorId,
      this.device.productId,
      this.device.manufacturer
    );
  }

  public syncStatusAppearance(): void {
    switch (this.device.status) {
      case 'connected':
        this.contextValue = 'serialPortDevice.connected';
        this.iconPath = new vscode.ThemeIcon('vm-connect');
        break;
      case 'connecting':
        this.contextValue = 'serialPortDevice.connecting';
        this.iconPath = new vscode.ThemeIcon('loading~spin');
        break;
      default:
        this.contextValue = 'serialPortDevice.disconnected';
        this.iconPath = new vscode.ThemeIcon('vm-outline');
        break;
    }
  }
}
