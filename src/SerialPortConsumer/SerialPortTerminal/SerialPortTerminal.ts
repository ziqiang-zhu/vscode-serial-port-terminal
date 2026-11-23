import * as vscode from 'vscode';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { SerialPortConsumer, SerialPortConsumerHost } from '../../SerialPortConnection/SerialPortConsumer';
import { SerialPortLogRecorder } from '../SerialPortLogRecorder/SerialPortLogRecorder';
import { SerialPortAgentBridge, AgentBridgeCancelledError } from '../SerialPortAgentBridge/SerialPortAgentBridge';
import { buildLogFilePath, resolveLogDirectory } from '../SerialPortLogFiles';

const CONTEXT_FOCUS = 'serialPortTerminal.focus';
const CONTEXT_RECORDING = 'serialPortTerminal.recording';
const CONTEXT_PAUSED = 'serialPortTerminal.paused';
const CONTEXT_AGENT_BRIDGE = 'serialPortTerminal.agentBridgeActive';

const terminalInstances = new Map<vscode.Terminal, SerialPortTerminal>();

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
  private agentBridge: SerialPortAgentBridge | undefined;
  private agentBridgeAddress: string | undefined;
  private agentBridgeReadonly: boolean | undefined;
  private agentBridgeClientCount = 0;
  // 选端口窗口内的重入守卫：多端口配置时 QuickPick 可挂起任意久，期间二次调用
  // 会穿透 agentBridge 空守卫并产生双桥（同 id 注册顶掉旧桥，状态错乱）。listen
  // 窗口无需持锁——agentBridge 已置位，原守卫自然拦截二次调用。
  private bridgeStarting = false;

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
    this.agentBridge = undefined;
    this.agentBridgeAddress = undefined;
    this.agentBridgeClientCount = 0;
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
    if (this.agentBridge || this.bridgeStarting) {
      return;
    }
    this.bridgeStarting = true;
    try {
      const port = await this.pickAgentBridgePort();
      if (port === undefined) {
        return;
      }
      const readonlyMode = this.getAgentBridgeReadonly();
      // stripAnsi 恒取默认 true；第 5 参接线客户端数回调（状态栏计数）。
      const bridge = new SerialPortAgentBridge(
        this.getAgentBridgeHost(),
        port,
        readonlyMode,
        true,
        count => this.onBridgeClientCountChanged(count)
      );
      this.agentBridge = bridge;
      this.agentBridgeReadonly = readonlyMode;
      this.agentBridgeClientCount = 0;
      this.addConsumer(bridge);
      refreshLogContext();
      try {
        const address = await bridge.listen();
        this.agentBridgeAddress = `${address.host}:${address.port}`;
        refreshLogContext();
        const suffix = readonlyMode ? ' (read-only)' : '';
        void vscode.window.showInformationMessage(
          vscode.l10n.t('Agent Bridge: {0}', `${address.host}:${address.port}${suffix}`)
        );
      } catch (error) {
        if (error instanceof AgentBridgeCancelledError) {
          // 启动挂起被取消（启动期间点了停止 / 断开收尾）：清理已由取消方
          // （stopBridge / onClosed）完成，静默返回。
          return;
        }
        this.agentBridge = undefined;
        this.agentBridgeReadonly = undefined;
        this.agentBridgeAddress = undefined;
        this.agentBridgeClientCount = 0;
        this.removeConsumer(bridge.id);
        refreshLogContext();
        void vscode.window.showErrorMessage(vscode.l10n.t('Failed to start Agent Bridge: {0}', `${error}`));
      }
    } finally {
      this.bridgeStarting = false;
    }
  }

  stopBridge(): void {
    if (!this.agentBridge) {
      return;
    }
    const bridge = this.agentBridge;
    this.agentBridge = undefined;
    this.agentBridgeAddress = undefined;
    this.agentBridgeReadonly = undefined;
    this.agentBridgeClientCount = 0;
    this.removeConsumer(bridge.id);
    refreshLogContext();
  }

  // 客户端计数（状态栏 · N）：仅刷新计数字段与状态栏；有意不写终端提示行——
  // 提示行干扰终端内容本身（用户实测定夺）。refreshLogContext 按活动实例读取，
  // 非活动终端的桥触发亦安全幂等。
  private onBridgeClientCountChanged(count: number): void {
    this.agentBridgeClientCount = count;
    refreshLogContext();
  }

  isBridgeActive(): boolean {
    return this.agentBridge !== undefined;
  }

  isAgentBridgeReadonly(): boolean {
    return this.agentBridgeReadonly ?? false;
  }

  getAgentBridgeAddress(): string | undefined {
    return this.agentBridgeAddress;
  }

  getAgentBridgeClientCount(): number {
    return this.agentBridgeClientCount;
  }

  private getAgentBridgeReadonly(): boolean {
    return vscode.workspace
      .getConfiguration('serialPortTerminal')
      .get<boolean>('agentBridge.readonly', false);
  }

  private getAgentBridgeHost(): string {
    const host = vscode.workspace.getConfiguration('serialPortTerminal').get<string>('agentBridge.host', '127.0.0.1');
    return host && host.trim() ? host : '127.0.0.1';
  }

  private async pickAgentBridgePort(): Promise<number | undefined> {
    const configured = vscode.workspace.getConfiguration('serialPortTerminal').get<number[]>('agentBridge.ports', [2000]);
    const ports = (configured ?? [])
      .map(p => Number(p))
      .filter(p => Number.isInteger(p) && p >= 1 && p <= 65535);
    if (ports.length === 0) {
      void vscode.window.showErrorMessage(vscode.l10n.t('No Agent Bridge port configured'));
      return undefined;
    }
    if (ports.length === 1) {
      return ports[0];
    }
    const picked = await vscode.window.showQuickPick(
      ports.map(p => ({ label: String(p) })),
      { placeHolder: vscode.l10n.t('Select Agent Bridge port') }
    );
    return picked ? Number(picked.label) : undefined;
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
  updateAgentBridgeStatus(instance?.getAgentBridgeAddress(), instance?.isAgentBridgeReadonly() ?? false, instance?.getAgentBridgeClientCount() ?? 0);
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
      const address = getActiveInstance()?.getAgentBridgeAddress();
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
