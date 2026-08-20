import * as vscode from 'vscode';
import { initSerialPortDeviceManager } from './SerialPortDeviceManager/SerialPortDeviceManager'; // 引入组件

export function activate(context: vscode.ExtensionContext) {
  console.log('Serial Port Terminal is activating...');

	initSerialPortDeviceManager(context); // 初始化串口设备管理器
}

export function deactivate() {}
