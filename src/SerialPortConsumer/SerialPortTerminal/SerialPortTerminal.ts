import * as vscode from 'vscode';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { SerialPortConsumer, SerialPortConsumerHost } from '../../SerialPortConnection/SerialPortConsumer';
import { SerialPortLogRecorder } from '../SerialPortLogRecorder/SerialPortLogRecorder';
import { AgentBridgeSession } from '../SerialPortAgentBridge/AgentBridgeSession';
import { buildLogFilePath, resolveLogDirectory } from '../SerialPortLogFiles';

const CONTEXT_FOCUS = 'serialPortTerminal.focus';
const CONTEXT_RECORDING = 'serialPortTerminal.recording';
const CONTEXT_PAUSED = 'serialPortTerminal.paused';
const CONTEXT_AGENT_BRIDGE = 'serialPortTerminal.agentBridgeActive';

const terminalInstances = new Map<vscode.Terminal, SerialPortTerminal>();

// 全局桥状态栏的 Assist 回退数据源（注册经装配层注入——extension.ts 调
// registerAssistBridgeStatusProvider，避免 Terminal ↔ Assist 循环依赖）：
// 活动终端的桥优先，活动终端无桥时状态栏回退显示任一 Assist 会话的运行中桥。
export interface AssistBridgeStatusBarInfo {
  address: string;
  readonly: boolean;
  clients: number;
}

let assistBridgeStatusProvider: (() => AssistBridgeStatusBarInfo | undefined) | undefined;

export function registerAssistBridgeStatusProvider(
  provider: () => AssistBridgeStatusBarInfo | undefined
): void {
  assistBridgeStatusProvider = provider;
}

/** 全局桥状态栏刷新（Assist 桥状态迁移时由 Assist 模块调用；Terminal 内部走 refreshLogContext）。解析为确定性重算（活动终端桥 → 最近可见面板桥 → 隐藏），无需事件携带面板身份。 */
export function refreshAgentBridgeStatus(): void {
  updateLogContext(getActiveInstance());
}

class SerialPortPseudoTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite = this.writeEmitter.event;

  private closeEmitter = new vscode.EventEmitter<void>();
  readonly onDidClose = this.closeEmitter.event;

  private closed = false;
  private disconnected = false;

  constructor(
    private readonly onInput: (data: string) => void,
    private readonly onTerminalClosed: () => void,
    private readonly onToggleLog: () => void
  ) {}

  open(): void {}

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.dispose();
    this.onTerminalClosed();
  }

  setDimensions(): void {}

  handleInput(data: string): void {
    if (this.closed || this.disconnected) {
      return;
    }
    const shortcutsEnabled = vscode.workspace
      .getConfiguration('serialPortTerminal')
      .get<boolean>('logShortcutsEnabled', false);
    if (!shortcutsEnabled || !data.includes('\x13')) {
      this.onInput(data);
      return;
    }
    // 拦截 Ctrl+S（0x13）：触发开始/停止记录，不发送给设备
    const parts = data.split('\x13');
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part) {
        this.onInput(part);
      }
      if (i < parts.length - 1) {
        this.onToggleLog();
      }
    }
  }

  notifyDisconnected(path: string): void {
    if (this.closed) {
      return;
    }
    this.disconnected = true;
    this.writeText(`\r\n\r\n${vscode.l10n.t('Disconnected: {0}', path)}\r\n`);
  }

  writeText(text: string): void {
    if (this.closed) {
      return;
    }
    this.writeEmitter.fire(text.replace(/\r?\n/g, '\r\n'));
  }

  dispose(): void {
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }
}

export class SerialPortTerminal extends SerialPortConsumer {
  readonly id = 'serialPortTerminal';
  readonly displayName = 'Serial Port Terminal';

  private terminal: vscode.Terminal | undefined;
  private pty: SerialPortPseudoTerminal | undefined;
  private hostPath = '';
  private logRecorder: SerialPortLogRecorder | undefined;
  // 桥启动会话（公共工厂，AgentBridge设计 §4——呈现差异经 presenter 注入）：
  // 状态栏拉模型呈现，onChange 即 refreshLogContext。
  private bridgeSession: AgentBridgeSession | undefined;

  public get devicePath(): string {
    return this.hostPath;
  }

  public attach(host: SerialPortConsumerHost): void {
    super.attach(host);
    this.hostPath = host.path;
    const pty = new SerialPortPseudoTerminal(
      data => this.send(Buffer.from(data, 'utf-8')),
      () => this.requestDisconnect(),
      () => this.toggleLog()
    );
    this.pty = pty;
    const title = `${host.path} · ${host.label ?? String(host.config.baudRate)}`;
    const terminal = vscode.window.createTerminal({ name: title, pty });
    this.terminal = terminal;
    terminalInstances.set(terminal, this);
    terminal.show();
  }

  onData(data: Buffer): void {
    this.pty?.writeText(data.toString('utf-8'));
  }

  onClosed(): void {
    this.pty?.notifyDisconnected(this.hostPath);
    this.logRecorder = undefined;
    // 桥随 Connection 关闭链自行清理（A11 取消路径含其中），此处仅丢弃会话引用。
    this.bridgeSession?.detach();
    this.bridgeSession = undefined;
    this.detachTerminal();
  }

  startLog(): void {
    if (this.logRecorder) {
      return;
    }
    try {
      const filePath = buildLogFilePath(this.hostPath);
      this.logRecorder = new SerialPortLogRecorder(filePath);
      this.addConsumer(this.logRecorder);
      refreshLogContext();
    } catch (error) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to start log: {0}', `${error}`));
    }
  }

  pauseLog(): void {
    this.logRecorder?.pause();
    refreshLogContext();
  }

  resumeLog(): void {
    this.logRecorder?.resume();
    refreshLogContext();
  }

  stopLog(): void {
    if (!this.logRecorder) {
      return;
    }
    const recorder = this.logRecorder;
    this.logRecorder = undefined;
    this.removeConsumer(recorder.id);
    refreshLogContext();
  }

  toggleLog(): void {
    if (this.isRecording()) {
      this.stopLog();
    } else {
      this.startLog();
    }
  }

  isRecording(): boolean {
    return this.logRecorder !== undefined;
  }

  isPaused(): boolean {
    return this.logRecorder?.isPaused() ?? false;
  }

  async startBridge(): Promise<void> {
    await this.ensureBridgeSession().start();
  }

  stopBridge(): void {
    this.bridgeSession?.stop();
  }

  isBridgeActive(): boolean {
    return this.bridgeSession?.active ?? false;
  }

  isAgentBridgeReadonly(): boolean {
    return this.bridgeSession?.isReadonly ?? false;
  }

  getAgentBridgeAddress(): string | undefined {
    return this.bridgeSession?.bridgeAddress;
  }

  getAgentBridgeClientCount(): number {
    return this.bridgeSession?.clients ?? 0;
  }

  // 桥会话懒建（公共工厂，AgentBridge设计 §4）：状态栏拉模型呈现——onChange
  // 即 refreshLogContext（按活动实例读取，非活动终端的桥触发亦安全幂等）；
  // stripAnsi 恒取终端语义 true；出站回调不传（桥客户端字节无面板回显诉求）。
  private ensureBridgeSession(): AgentBridgeSession {
    if (!this.bridgeSession) {
      this.bridgeSession = new AgentBridgeSession(
        {
          addConsumer: consumer => this.addConsumer(consumer),
          removeConsumer: id => this.removeConsumer(id)
        },
        {
          onChange: () => refreshLogContext(),
          onStarted: (address, readonlyMode) => {
            const suffix = readonlyMode ? ' (read-only)' : '';
            void vscode.window.showInformationMessage(
              vscode.l10n.t('Agent Bridge: {0}', `${address}${suffix}`)
            );
          },
          onFailed: error => {
            void vscode.window.showErrorMessage(vscode.l10n.t('Failed to start Agent Bridge: {0}', `${error}`));
          }
        },
        true
      );
    }
    return this.bridgeSession;
  }

  private detachTerminal(): void {
    if (this.terminal) {
      terminalInstances.delete(this.terminal);
      if (vscode.window.activeTerminal === this.terminal) {
        updateLogContext(undefined);
      }
    }
  }
}

async function openLogDirectory(): Promise<void> {
  try {
    const directory = resolveLogDirectory();
    await fs.promises.mkdir(directory, { recursive: true });
    openDirectoryInOS(directory);
  } catch (error) {
    vscode.window.showErrorMessage(vscode.l10n.t('Failed to open log directory: {0}', `${error}`));
  }
}

function openDirectoryInOS(directory: string): void {
  const command =
    process.platform === 'win32' ? 'explorer.exe' :
    process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [directory]);
  child.on('error', error => {
    vscode.window.showErrorMessage(vscode.l10n.t('Failed to open log directory: {0}', `${error}`));
  });
}

function getActiveInstance(): SerialPortTerminal | undefined {
  const terminal = vscode.window.activeTerminal;
  return terminal ? terminalInstances.get(terminal) : undefined;
}

export function getActiveSerialPortDevicePath(): string | undefined {
  return getActiveInstance()?.devicePath;
}

let agentBridgeStatusBarItem: vscode.StatusBarItem | undefined;

function updateAgentBridgeStatus(address: string | undefined, readonlyMode = false, clientCount = 0): void {
  if (!agentBridgeStatusBarItem) {
    return;
  }
  if (address) {
    const suffix = readonlyMode ? ' (read-only)' : '';
    // 客户端计数仅在 ≥1 时显示（"0" 是常态噪音）；与地址一样跟随活动终端。
    const clients = clientCount > 0 ? ` · ${clientCount}` : '';
    agentBridgeStatusBarItem.text = `$(record) AgentBridge ${address}${suffix}${clients}`;
    agentBridgeStatusBarItem.tooltip = vscode.l10n.t('Agent Bridge: {0} (click to copy)', address);
    agentBridgeStatusBarItem.command = 'serialPortAgentBridge.copyAddress';
    agentBridgeStatusBarItem.show();
  } else {
    agentBridgeStatusBarItem.hide();
  }
}

function updateLogContext(instance: SerialPortTerminal | undefined): void {
  void vscode.commands.executeCommand('setContext', CONTEXT_FOCUS, instance !== undefined);
  void vscode.commands.executeCommand('setContext', CONTEXT_RECORDING, instance?.isRecording() ?? false);
  void vscode.commands.executeCommand('setContext', CONTEXT_PAUSED, instance?.isPaused() ?? false);
  void vscode.commands.executeCommand('setContext', CONTEXT_AGENT_BRIDGE, instance?.isBridgeActive() ?? false);
  // 状态栏 = 全局桥指示，跟随最近交互面（设计 §7）——确定性两步解析，与事件
  // 先后顺序无关：①活动串口终端有桥优先；②否则最近可见的 Assist 面板有桥；
  // ③都没有则隐藏。readonly/clients 同源取值（不走 `??`：false/0 非 nullish
  // 不穿透）。
  const instanceAddress = instance?.getAgentBridgeAddress();
  const assistBridge = instanceAddress === undefined ? assistBridgeStatusProvider?.() : undefined;
  const address = instanceAddress ?? assistBridge?.address;
  const readonlyMode = assistBridge ? assistBridge.readonly : instance?.isAgentBridgeReadonly() ?? false;
  const clientCount = assistBridge ? assistBridge.clients : instance?.getAgentBridgeClientCount() ?? 0;
  updateAgentBridgeStatus(address, readonlyMode, clientCount);
}

function refreshLogContext(): void {
  updateLogContext(getActiveInstance());
}

export function registerSerialPortLogCommands(context: vscode.ExtensionContext): void {
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  agentBridgeStatusBarItem = statusBarItem;
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(
    vscode.commands.registerCommand('serialPortLog.openDirectory', () => {
      void openLogDirectory();
    }),
    vscode.commands.registerCommand('serialPortLog.start', () => getActiveInstance()?.startLog()),
    vscode.commands.registerCommand('serialPortLog.pause', () => getActiveInstance()?.pauseLog()),
    vscode.commands.registerCommand('serialPortLog.resume', () => getActiveInstance()?.resumeLog()),
    vscode.commands.registerCommand('serialPortLog.stop', () => getActiveInstance()?.stopLog()),
    vscode.commands.registerCommand('serialPortAgentBridge.start', () => void getActiveInstance()?.startBridge()),
    vscode.commands.registerCommand('serialPortAgentBridge.stop', () => getActiveInstance()?.stopBridge()),
    vscode.commands.registerCommand('serialPortAgentBridge.toggleReadonly', async () => {
      const config = vscode.workspace.getConfiguration('serialPortTerminal');
      const next = !(config.get<boolean>('agentBridge.readonly', false));
      await config.update('agentBridge.readonly', next, vscode.ConfigurationTarget.Global);
      const message = next
        ? vscode.l10n.t('Agent Bridge read-only mode is now ENABLED. Changes take effect the next time Agent Bridge starts.')
        : vscode.l10n.t('Agent Bridge read-only mode is now DISABLED. Changes take effect the next time Agent Bridge starts.');
      void vscode.window.showInformationMessage(message);
    }),
    vscode.commands.registerCommand('serialPortAgentBridge.copyAddress', () => {
      // 状态栏显示的地址即当前全局桥：活动终端的桥优先，否则为 Assist 会话的桥。
      const address = getActiveInstance()?.getAgentBridgeAddress() ?? assistBridgeStatusProvider?.()?.address;
      if (address) {
        void vscode.env.clipboard.writeText(address);
        void vscode.window.showInformationMessage(vscode.l10n.t('Agent Bridge address copied: {0}', address));
      }
    }),
    vscode.window.onDidChangeActiveTerminal(terminal => {
      updateLogContext(terminal ? terminalInstances.get(terminal) : undefined);
    }),
    vscode.window.onDidCloseTerminal(terminal => {
      if (terminalInstances.delete(terminal) && vscode.window.activeTerminal === terminal) {
        updateLogContext(undefined);
      }
    })
  );
}
