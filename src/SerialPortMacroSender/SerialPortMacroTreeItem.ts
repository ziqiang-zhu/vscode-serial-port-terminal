import * as vscode from 'vscode';
import { SerialPortMacro } from './SerialPortMacro';

export class SerialPortMacroTreeItem extends vscode.TreeItem {
  constructor(public readonly macro: SerialPortMacro) {
    super(macro.label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'serialPortMacro';
    this.iconPath = new vscode.ThemeIcon('symbol-text');
    this.description = summarizeData(macro.data);
    this.tooltip = macro.data;
  }
}

function summarizeData(data: string): string {
  const oneLine = data.replace(/[\r\n\t]+/g, ' ').trim();
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine;
}
