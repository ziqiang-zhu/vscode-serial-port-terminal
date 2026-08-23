import * as vscode from 'vscode';
import { SerialPortHalImpl } from './hal/SerialPortHalImpl';
import { SerialPortDeviceDetector } from './SerialPortDeviceDetector/SerialPortDeviceDetector';
import { SerialPortConnectionService } from './SerialPortConnection/SerialPortConnectionService';
import { SerialPortDeviceManagerTreeView } from './view/SerialPortDeviceManagerTreeView';

export function activate(context: vscode.ExtensionContext) {
  const hal = new SerialPortHalImpl();
  const detector = new SerialPortDeviceDetector(hal, context);
  const connectionService = new SerialPortConnectionService(hal, detector, context);
  new SerialPortDeviceManagerTreeView(detector, connectionService, context);
}

export function deactivate() {}
