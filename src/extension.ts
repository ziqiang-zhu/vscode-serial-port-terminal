import * as vscode from 'vscode';
import { SerialPortDeviceManager } from './SerialPortDeviceManager/SerialPortDeviceManager'; // 引入组件

export function activate(context: vscode.ExtensionContext) {
  console.log('Serial Port Terminal is activating...');

  new SerialPortDeviceManager(context);
}

export function deactivate() {}
