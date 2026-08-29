import * as vscode from 'vscode';
import { SerialPortDeviceInterface } from '../SerialPortDeviceDetector/SerialPortDeviceInterface';
import { SerialConfig, SerialPortQuickConfig, formatSerialConfigDetails, formatSerialConfigSummary, serialConfigEquals } from '../SerialPortConfig/SerialPortQuickConfig';

export class SerialPortQuickConfigTreeItem extends vscode.TreeItem {
  constructor(
    public readonly device: SerialPortDeviceInterface,
    public readonly quickConfig: SerialPortQuickConfig,
    public readonly isLegacy: boolean = false
  ) {
    super(quickConfig.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = isLegacy ? 'serialPortQuickConfigLegacy' : 'serialPortQuickConfig';
    this.iconPath = new vscode.ThemeIcon('debug-configure');
    this.description = formatSerialConfigSummary(quickConfig.config);
    this.tooltip = formatSerialConfigDetails(quickConfig.config);
  }

  public syncActiveState(activeConfig: SerialConfig | undefined): void {
    if (this.isLegacy) {
      return;
    }
    const active = activeConfig !== undefined && serialConfigEquals(activeConfig, this.quickConfig.config);
    this.iconPath = new vscode.ThemeIcon(active ? 'radio-tower' : 'debug-configure');
    this.description = active
      ? `${formatSerialConfigSummary(this.quickConfig.config)} · ${vscode.l10n.t('Current connection')}`
      : formatSerialConfigSummary(this.quickConfig.config);
  }
}
