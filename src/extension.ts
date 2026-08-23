import * as vscode from 'vscode';
import { SerialPortHalImpl } from './hal/SerialPortHalImpl';
import { SerialPortDeviceDetector } from './SerialPortDeviceDetector/SerialPortDeviceDetector';
import { SerialPortConnectionService } from './SerialPortConnection/SerialPortConnectionService';
import { SerialPortTerminal } from './SerialPortConsumer/SerialPortTerminal/SerialPortTerminal';
import { SerialPortConfigStore } from './SerialPortConfig/SerialPortConfigStore';
import { SerialPortDeviceManagerTreeView } from './view/SerialPortDeviceManagerTreeView';
import { SerialPortPresetManager } from './view/SerialPortPresetManager';

export function activate(context: vscode.ExtensionContext) {
  const hal = new SerialPortHalImpl();
  const detector = new SerialPortDeviceDetector(hal, context);
  const connectionService = new SerialPortConnectionService(hal, detector, context, () => new SerialPortTerminal());
  const configStore = new SerialPortConfigStore(context.globalState);
  new SerialPortPresetManager(context);
  new SerialPortDeviceManagerTreeView(detector, connectionService, configStore, context);
}

export function deactivate() {}
