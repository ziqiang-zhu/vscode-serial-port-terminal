import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SerialPortConsumer, SerialPortConsumerHost } from '../../SerialPortConnection/SerialPortConsumer';
import { SerialPortLogRecorder } from '../SerialPortLogRecorder/SerialPortLogRecorder';

const CONTEXT_FOCUS = 'serialPortTerminal.focus';
const CONTEXT_RECORDING = 'serialPortTerminal.recording';
const CONTEXT_PAUSED = 'serialPortTerminal.paused';

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
    private readonly onTerminalClosed: () => void
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
    this.onInput(data);
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

  public attach(host: SerialPortConsumerHost): void {
    super.attach(host);
    this.hostPath = host.path;
    const pty = new SerialPortPseudoTerminal(
      data => this.send(Buffer.from(data, 'utf-8')),
      () => this.requestDisconnect()
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

  isRecording(): boolean {
    return this.logRecorder !== undefined;
  }

  isPaused(): boolean {
    return this.logRecorder?.isPaused() ?? false;
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

function buildLogFilePath(devicePath: string): string {
  const directory = resolveLogDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const base = path.basename(devicePath).replace(/[\\/:*?"<>|]/g, '_');
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
  return path.join(directory, `${base}_${timestamp}.log`);
}

function resolveLogDirectory(): string {
  const configured = vscode.workspace.getConfiguration('serialPortTerminal').get<string>('logDirectory', '');
  if (configured) {
    return configured;
  }
  return path.join(os.homedir(), 'Documents', 'SerialPortTerminal', 'Log');
}

function getActiveInstance(): SerialPortTerminal | undefined {
  const terminal = vscode.window.activeTerminal;
  return terminal ? terminalInstances.get(terminal) : undefined;
}

function updateLogContext(instance: SerialPortTerminal | undefined): void {
  void vscode.commands.executeCommand('setContext', CONTEXT_FOCUS, instance !== undefined);
  void vscode.commands.executeCommand('setContext', CONTEXT_RECORDING, instance?.isRecording() ?? false);
  void vscode.commands.executeCommand('setContext', CONTEXT_PAUSED, instance?.isPaused() ?? false);
}

function refreshLogContext(): void {
  updateLogContext(getActiveInstance());
}

export function registerSerialPortLogCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('serialPortLog.start', () => getActiveInstance()?.startLog()),
    vscode.commands.registerCommand('serialPortLog.pause', () => getActiveInstance()?.pauseLog()),
    vscode.commands.registerCommand('serialPortLog.resume', () => getActiveInstance()?.resumeLog()),
    vscode.commands.registerCommand('serialPortLog.stop', () => getActiveInstance()?.stopLog()),
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
