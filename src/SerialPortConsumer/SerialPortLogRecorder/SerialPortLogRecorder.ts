import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SerialPortConsumer } from '../../SerialPortConnection/SerialPortConsumer';
import { SerialPortAnsiStripper } from '../SerialPortDataParsers/SerialPortAnsiStripper';
import { SerialPortLineTimestampBuffer } from './SerialPortLineTimestampBuffer';

export class SerialPortLogRecorder extends SerialPortConsumer {
  readonly id = 'serialPortLogRecorder';
  readonly displayName = 'Serial Port Log Recorder';

  private stream: fs.WriteStream | undefined;
  private paused = false;
  private fileCreated = false;
  private readonly ansiStripper = new SerialPortAnsiStripper();
  private readonly timestampEnabled: boolean;
  private readonly timestampBuffer = new SerialPortLineTimestampBuffer();
  private readonly maxBytes: number;
  private segmentIndex = 0;
  private segmentBytes = 0;

  constructor(private readonly baseFilePath: string) {
    super();
    this.timestampEnabled = vscode.workspace
      .getConfiguration('serialPortTerminal')
      .get<boolean>('logTimestampEnabled', false);
    const maxKb = vscode.workspace.getConfiguration('serialPortTerminal').get<number>('logMaxFileSize', 0);
    this.maxBytes = Number.isFinite(maxKb) && maxKb > 0 ? maxKb * 1024 : 0;
  }

  onData(data: Buffer): void {
    if (this.paused) {
      return;
    }
    const clean = this.ansiStripper.strip(data);
    const processed = this.timestampEnabled ? this.timestampBuffer.process(clean) : clean;
    if (processed.length === 0) {
      return;
    }
    this.ensureStream();
    this.stream?.write(processed);
    this.segmentBytes += processed.length;
    if (this.maxBytes > 0 && this.segmentBytes >= this.maxBytes) {
      this.rotate();
    }
  }

  onClosed(): void {
    const remaining = this.timestampEnabled ? this.timestampBuffer.flush() : Buffer.alloc(0);
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
    this.stream = fs.createWriteStream(this.currentSegmentPath(), { flags: 'a' });
    this.stream.on('error', () => {});
    this.fileCreated = true;
  }

  private rotate(): void {
    this.closeStream();
    this.segmentIndex += 1;
    this.segmentBytes = 0;
  }

  private currentSegmentPath(): string {
    if (this.segmentIndex === 0) {
      return this.baseFilePath;
    }
    const ext = path.extname(this.baseFilePath);
    const stem = ext ? this.baseFilePath.slice(0, -ext.length) : this.baseFilePath;
    const number = String(this.segmentIndex + 1).padStart(3, '0');
    return `${stem}_${number}${ext}`;
  }

  private notifySaved(): void {
    if (!this.fileCreated) {
      return;
    }
    void vscode.window.showInformationMessage(vscode.l10n.t('File saved to: {0}', this.baseFilePath));
  }

  private closeStream(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = undefined;
    }
  }
}
