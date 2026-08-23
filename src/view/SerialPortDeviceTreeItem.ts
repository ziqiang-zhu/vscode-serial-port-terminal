import * as vscode from 'vscode';
import { SerialPortDeviceInterface } from '../SerialPortDeviceDetector/SerialPortDeviceInterface';
import { SerialConfig, formatSerialConfigSummary } from '../SerialPortConfig/SerialPortQuickConfig';

export class SerialPortDeviceTreeItem extends vscode.TreeItem {
  constructor(public readonly device: SerialPortDeviceInterface) {
    super(device.path, vscode.TreeItemCollapsibleState.None);
    this.description = device.manufacturer;
    this.tooltip = `Path: ${device.path}\nVendorID: ${device.vendorId}\nProductID: ${device.productId}\nManufacturer: ${device.manufacturer}`;
    this.syncStatusAppearance();
  }

  public syncConnectionConfig(config: SerialConfig | undefined): void {
    this.description = config
      ? `${this.device.manufacturer} · ${formatSerialConfigSummary(config)}`
      : this.device.manufacturer;
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
