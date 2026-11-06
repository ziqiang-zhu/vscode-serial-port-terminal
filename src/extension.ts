import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { USE_VIRTUAL_HAL, createSerialPortHal, createVirtualHal } from './hal/halSelection';
import { SerialPortDeviceDetector } from './SerialPortDeviceDetector/SerialPortDeviceDetector';
import { SerialPortConnectionService } from './SerialPortConnection/SerialPortConnectionService';
import { SerialPortTerminal, registerSerialPortLogCommands } from './SerialPortConsumer/SerialPortTerminal/SerialPortTerminal';
import { SerialPortConfigStore } from './SerialPortConfig/SerialPortConfigStore';
import { SerialPortDeviceManagerTreeView } from './view/SerialPortDeviceManagerTreeView';
import { SerialPortConsoleView, registerVirtualDeviceConsole } from './view/SerialPortConsoleView';
import { SerialPortMacroManager } from './SerialPortMacroSender/SerialPortMacroManager';

export function activate(context: vscode.ExtensionContext) {
  logBuildInfo();
  const virtualHal = USE_VIRTUAL_HAL ? createVirtualHal() : undefined;
  const hal = createSerialPortHal(virtualHal);
  const detector = new SerialPortDeviceDetector(hal, context);
  context.subscriptions.push(detector);
  const connectionService = new SerialPortConnectionService(hal, detector, context, () => new SerialPortTerminal());
  const configStore = new SerialPortConfigStore(context.globalState);
  context.subscriptions.push(configStore);
  new SerialPortDeviceManagerTreeView(detector, connectionService, configStore, context);
  new SerialPortMacroManager(connectionService, context.globalState, context);
  registerSerialPortLogCommands(context);
  context.subscriptions.push(
    ...registerVirtualDeviceConsole(context, virtualHal)
  );
}

export function deactivate() {}

// 构建指纹（dist/build-info.json，由 scripts/build.js 写入）：调试控制台首行输出，
// 用于核对宿主加载的是本次编译产物及其编译形态（时间戳非刚才即说明加载了旧版）。
function logBuildInfo(): void {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')) as {
      builtAt: string;
      commit: string;
      virtualHal?: boolean;
    };
    const mode = info.virtualHal ? 'test build (virtual HAL)' : 'product build';
    console.log(`[Serial Port Terminal] build ${info.builtAt} @ ${info.commit} (${mode})`);
  } catch {
    // 无指纹（如直接以源码运行）时静默
  }
}
