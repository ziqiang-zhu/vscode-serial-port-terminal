import * as vscode from 'vscode';
import { SerialPortConsumer, SerialPortConsumerHost } from '../../SerialPortConnection/SerialPortConsumer';

class SerialPortPseudoTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite = this.writeEmitter.event;

  private closeEmitter = new vscode.EventEmitter<void>();
  readonly onDidClose = this.closeEmitter.event;

  private inputBuffer = '';
  private closed = false;
  private disconnected = false;

  constructor(
    private readonly onLineInput: (line: string) => void,
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
    if (data.startsWith('\x1b')) {
      return;
    }
    for (const char of data) {
      if (char === '\r') {
        const line = this.inputBuffer;
        this.inputBuffer = '';
        this.echo('\r\n');
        this.onLineInput(line);
      } else if (char === '\x7f') {
        if (this.inputBuffer) {
          this.inputBuffer = this.inputBuffer.slice(0, -1);
          this.echo('\b \b');
        }
      } else {
        this.inputBuffer += char;
        this.echo(char);
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

  private echo(text: string): void {
    this.writeEmitter.fire(text);
  }
}

export class SerialPortTerminal extends SerialPortConsumer {
  readonly id = 'serialPortTerminal';
  readonly displayName = 'Serial Port Terminal';

  private terminal: vscode.Terminal | undefined;
  private pty: SerialPortPseudoTerminal | undefined;
  private hostPath = '';

  public attach(host: SerialPortConsumerHost): void {
    super.attach(host);
    this.hostPath = host.path;
    const pty = new SerialPortPseudoTerminal(
      line => this.send(Buffer.from(line + '\n', 'utf-8')),
      () => this.requestDisconnect()
    );
    this.pty = pty;
    this.terminal = vscode.window.createTerminal({ name: vscode.l10n.t('Serial Port: {0}', host.path), pty });
    this.terminal.show();
  }

  onData(data: Buffer): void {
    this.pty?.writeText(data.toString('utf-8'));
  }

  onClosed(): void {
    this.pty?.notifyDisconnected(this.hostPath);
  }
}
