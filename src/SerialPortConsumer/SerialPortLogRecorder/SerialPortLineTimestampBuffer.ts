import * as vscode from 'vscode';

const DEFAULT_TIMESTAMP_FORMAT = '[{HH}:{mm}:{ss}.{SSS}] ';
const TIMESTAMP_TOKEN = /\{YYYY\}|\{MM\}|\{DD\}|\{HH\}|\{mm\}|\{ss\}|\{SSS\}/g;
const LINE_FEED = 0x0a;

export class SerialPortLineTimestampBuffer {
  private readonly timestampFormat: string;
  private pending: Buffer = Buffer.alloc(0);

  constructor() {
    const config = vscode.workspace.getConfiguration('serialPortTerminal');
    const format = config.get<string>('logTimestampFormat', DEFAULT_TIMESTAMP_FORMAT);
    this.timestampFormat = format && format.trim() ? format : DEFAULT_TIMESTAMP_FORMAT;
  }

  // 行缓冲：按原始字节累积、以 \n 切分完整行——多字节字符跨 chunk 不会损坏。
  process(data: Buffer): Buffer {
    if (data.length > 0) {
      this.pending = Buffer.concat([this.pending, data]);
    }
    const lines: Buffer[] = [];
    let start = 0;
    for (let i = 0; i < this.pending.length; i++) {
      if (this.pending[i] === LINE_FEED) {
        lines.push(this.pending.subarray(start, i + 1));
        start = i + 1;
      }
    }
    this.pending = this.pending.subarray(start);
    if (lines.length === 0) {
      return Buffer.alloc(0);
    }
    const timestamp = this.formatTimestamp();
    return Buffer.from(lines.map(line => timestamp + line.toString('utf-8')).join(''), 'utf-8');
  }

  flush(): Buffer {
    if (this.pending.length === 0) {
      return Buffer.alloc(0);
    }
    const result = this.formatTimestamp() + this.pending.toString('utf-8');
    this.pending = Buffer.alloc(0);
    return Buffer.from(result, 'utf-8');
  }

  private formatTimestamp(): string {
    const now = new Date();
    const pad = (n: number, len: number) => String(n).padStart(len, '0');
    const replacements: Record<string, string> = {
      '{YYYY}': String(now.getFullYear()),
      '{MM}': pad(now.getMonth() + 1, 2),
      '{DD}': pad(now.getDate(), 2),
      '{HH}': pad(now.getHours(), 2),
      '{mm}': pad(now.getMinutes(), 2),
      '{ss}': pad(now.getSeconds(), 2),
      '{SSS}': pad(now.getMilliseconds(), 3)
    };
    return this.timestampFormat.replace(TIMESTAMP_TOKEN, token => replacements[token] ?? token);
  }
}
