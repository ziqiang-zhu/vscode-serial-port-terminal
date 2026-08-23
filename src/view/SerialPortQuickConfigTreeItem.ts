import * as vscode from 'vscode';
import { SerialPortDeviceInterface } from '../SerialPortDeviceDetector/SerialPortDeviceInterface';
import { SerialPortQuickConfig, formatSerialConfigDetails, formatSerialConfigSummary } from '../SerialPortConfig/SerialPortQuickConfig';

export class SerialPortQuickConfigTreeItem extends vscode.TreeItem {
  constructor(public readonly device: SerialPortDeviceInterface, public readonly quickConfig: SerialPortQuickConfig) {
    super(quickConfig.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'serialPortQuickConfig';
    this.iconPath = new vscode.ThemeIcon('debug-configure');
    this.description = formatSerialConfigSummary(quickConfig.config);
    this.tooltip = formatSerialConfigDetails(quickConfig.config);
  }
}
