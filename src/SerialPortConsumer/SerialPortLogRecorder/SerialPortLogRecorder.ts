import * as fs from 'fs';
import * as vscode from 'vscode';
import { SerialPortConsumer } from '../../SerialPortConnection/SerialPortConsumer';
import { SerialPortLogDataParser } from './SerialPortLogDataParser';

export class SerialPortLogRecorder extends SerialPortConsumer {
  readonly id = 'serialPortLogRecorder';
  readonly displayName = 'Serial Port Log Recorder';

  private stream: fs.WriteStream | undefined;
  private paused = false;
  private fileCreated = false;
  private readonly dataParser = new SerialPortLogDataParser();

  constructor(private readonly filePath: string) {
    super();
  }

  onData(data: Buffer): void {
    if (this.paused) {
      return;
    }
    const processed = this.dataParser.process(data);
    if (processed.length === 0) {
      return;
    }
    this.ensureStream();
    this.stream?.write(processed);
  }

  onClosed(): void {
    const remaining = this.dataParser.flush();
    if (remaining.length > 0) {
      this.ensureStream();
      this.stream?.write(remaining);
    }
    this.closeStream();
    this.notifySaved();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  private ensureStream(): void {
    if (this.stream) {
      return;
    }
    this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
    this.stream.on('error', () => {});
    this.fileCreated = true;
  }

  private notifySaved(): void {
    if (!this.fileCreated) {
      return;
    }
    void vscode.window.showInformationMessage(vscode.l10n.t('File saved to: {0}', this.filePath));
  }

  private closeStream(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = undefined;
    }
  }
}
