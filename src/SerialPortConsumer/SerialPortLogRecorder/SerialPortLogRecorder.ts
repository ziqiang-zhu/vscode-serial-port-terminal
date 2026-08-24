import * as fs from 'fs';
import { SerialPortConsumer } from '../../SerialPortConnection/SerialPortConsumer';

export class SerialPortLogRecorder extends SerialPortConsumer {
  readonly id = 'serialPortLogRecorder';
  readonly displayName = 'Serial Port Log Recorder';

  private stream: fs.WriteStream | undefined;
  private paused = false;

  constructor(filePath: string) {
    super();
    this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    this.stream.on('error', () => {});
  }

  onData(data: Buffer): void {
    if (this.paused) {
      return;
    }
    this.stream?.write(data);
  }

  onClosed(): void {
    this.closeStream();
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

  private closeStream(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = undefined;
    }
  }
}
