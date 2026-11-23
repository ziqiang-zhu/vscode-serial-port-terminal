import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SerialPortConsumer } from '../../SerialPortConnection/SerialPortConsumer';

// 数据记录 Consumer（契约见 doc/ConsumerDesign/SerialPortAssist设计.md §6）：
// 串口收发的原始字节按 chunk 记为「[固定毫秒时间戳] 方向 HEX」文本行落盘——
// RX 经 Connection 广播（onData），TX 由 Assist 发送漏斗直调（recordTx：面板
// 发送与桥客户端字节两条来源汇聚于此）。chunk 即一行、无行缓冲（chunk 边界
// 即时序信息）；空 chunk 跳过（无内容不建文件不写行）。
// 生命周期与写盘语义全套复用 LogRecorder 模式：懒建文件（open 事件确认创建）、
// 按大小分割（logMaxFileSize）、A3 失败语义（每次失败都提示、总是允许重试）。

export class SerialPortDataRecorder extends SerialPortConsumer {
  readonly id = 'serialPortDataRecorder';
  readonly displayName = 'Serial Port Data Recorder';

  private stream: fs.WriteStream | undefined;
  private fileCreated = false;
  private readonly maxBytes: number;
  private segmentIndex = 0;
  private segmentBytes = 0;

  constructor(private readonly baseFilePath: string) {
    super();
    const maxKb = vscode.workspace.getConfiguration('serialPortTerminal').get<number>('logMaxFileSize', 0);
    this.maxBytes = Number.isFinite(maxKb) && maxKb > 0 ? maxKb * 1024 : 0;
  }

  onData(data: Buffer): void {
    this.record(data, 'RX');
  }

  recordTx(data: Buffer): void {
    this.record(data, 'TX');
  }

  onClosed(): void {
    // chunk 制无半行/缓冲——收尾仅关流 + 「已保存」提示（open 确认为前提）。
    this.closeStream();
    this.notifySaved();
  }

  private record(data: Buffer, direction: 'RX' | 'TX'): void {
    if (data.length === 0) {
      return;
    }
    const line = Buffer.from(`${formatTimestamp()} ${direction} ${toHex(data)}\r\n`, 'utf-8');
    this.ensureStream();
    this.stream?.write(line);
    this.segmentBytes += line.length;
    if (this.maxBytes > 0 && this.segmentBytes >= this.maxBytes) {
      this.rotate();
    }
  }

  private ensureStream(): void {
    if (this.stream) {
      return;
    }
    this.stream = fs.createWriteStream(this.currentSegmentPath(), { flags: 'a' });
    const stream = this.stream;
    // 与 LogRecorder 同语义：保存失败时丢弃数据并提示，新流仍可尝试保存，
    // 失败继续提示，直到用户修复故障（如清理/恢复磁盘）。
    this.stream.on('error', (error: Error) => {
      if (this.stream === stream) {
        this.stream = undefined;
      }
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to write log: {0}', `${error}`));
    });
    // 文件以 open 事件确认创建成功：建流时置位会把「打开失败」也当成已保存。
    this.stream.once('open', () => {
      this.fileCreated = true;
    });
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

/** 固定全格式毫秒时间戳（机器解析友好，不接 logTimestampFormat——设计 §6）。 */
function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return (
    `[${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}]`
  );
}

/** 小写十六进制、单空格分隔（设计 §6 行格式）。 */
function toHex(data: Buffer): string {
  return Array.from(data, byte => byte.toString(16).padStart(2, '0')).join(' ');
}
