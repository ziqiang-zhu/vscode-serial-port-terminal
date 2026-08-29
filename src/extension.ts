import * as vscode from 'vscode';
import { SerialPortHalImpl } from './hal/SerialPortHalImpl';
import { SerialPortDeviceDetector } from './SerialPortDeviceDetector/SerialPortDeviceDetector';
import { SerialPortConnectionService } from './SerialPortConnection/SerialPortConnectionService';
import { SerialPortTerminal, registerSerialPortLogCommands } from './SerialPortConsumer/SerialPortTerminal/SerialPortTerminal';
import { SerialPortConfigStore } from './SerialPortConfig/SerialPortConfigStore';
import { SerialPortDeviceManagerTreeView } from './view/SerialPortDeviceManagerTreeView';
import { SerialPortMacroManager } from './SerialPortMacroSender/SerialPortMacroManager';

export function activate(context: vscode.ExtensionContext) {
  const hal = new SerialPortHalImpl();
  const detector = new SerialPortDeviceDetector(hal, context);
  context.subscriptions.push(detector);
  const connectionService = new SerialPortConnectionService(hal, detector, context, () => new SerialPortTerminal());
  const configStore = new SerialPortConfigStore(context.globalState);
  context.subscriptions.push(configStore);
  new SerialPortDeviceManagerTreeView(detector, connectionService, configStore, context);
  new SerialPortMacroManager(connectionService, context.globalState, context);
  registerSerialPortLogCommands(context);
}

export function deactivate() {}
