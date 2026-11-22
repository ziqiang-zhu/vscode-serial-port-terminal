import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { USE_VIRTUAL_HAL, createSerialPortHal, createVirtualHal } from './hal/halSelection';
import { SerialPortConnectionService } from './SerialPortConnection/SerialPortConnectionService';
import { SerialPortDeviceDetector } from './SerialPortDeviceDetector/SerialPortDeviceDetector';
import { SerialPortTerminal, registerSerialPortLogCommands } from './SerialPortConsumer/SerialPortTerminal/SerialPortTerminal';
import { SerialPortConfigStore } from './SerialPortConfig/SerialPortConfigStore';
import { SerialPortDeviceManagerTreeView } from './view/SerialPortDeviceManagerTreeView';
import { registerVirtualDeviceConsole } from './view/SerialPortConsoleView';
import { SerialPortMacroManager } from './SerialPortMacroSender/SerialPortMacroManager';

// 与 package.json 中 serialPortConsole 视图的 when 守卫同名：设置开启（或测试构建）
// 时显示虚拟设备控制台视图，关闭时整个隐藏。
const CONTEXT_VIRTUAL_CONSOLE = 'serialPortTerminal.virtualConsoleActive';

export function activate(context: vscode.ExtensionContext) {
  logBuildInfo();
  // VDC 生效门控：测试构建（build.js 产物注入 USE_VIRTUAL_HAL=true）恒开，保持
  // F5 开发与集成测试现状；产品构建按设置——激活期一次性读取，修改后重启扩展
  // 宿主或重启 VS Code 生效（有意不监听配置变更）。Restart Extension Host 不清空
  // 窗口 context key，必须双向显式 setContext，防止上次会话的残留值。
  const virtualEnabled = USE_VIRTUAL_HAL ||
    vscode.workspace.getConfiguration('serialPortTerminal').get<boolean>('virtualConsole', false);
  void vscode.commands.executeCommand('setContext', CONTEXT_VIRTUAL_CONSOLE, virtualEnabled);
  const virtualHal = createVirtualHal(virtualEnabled);
  const hal = createSerialPortHal(virtualHal);
  const detector = new SerialPortDeviceDetector(hal, context);
  context.subscriptions.push(detector);
  const connectionService = new SerialPortConnectionService(hal, detector, context, () => new SerialPortTerminal());
  connectionServices.push(connectionService);
  const configStore = new SerialPortConfigStore(context.globalState);
  context.subscriptions.push(configStore);
  new SerialPortDeviceManagerTreeView(detector, connectionService, configStore, context);
  new SerialPortMacroManager(connectionService, context.globalState, context);
  registerSerialPortLogCommands(context);
  context.subscriptions.push(
    ...registerVirtualDeviceConsole(context, virtualHal)
  );
}

// 连接服务的强引用：deactivate（扩展停用/宿主卸载事件）时主动销毁全部连接并
// 关闭端口——subscriptions 的 dispose 由框架在卸载时遍历，此处显式调用双保险，
// 确保禁用扩展引发的宿主卸载路径同样履行"连接随停用销毁"契约。
const connectionServices: SerialPortConnectionService[] = [];

export function deactivate(): void {
  for (const service of connectionServices.splice(0)) {
    service.dispose();
  }
}

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
