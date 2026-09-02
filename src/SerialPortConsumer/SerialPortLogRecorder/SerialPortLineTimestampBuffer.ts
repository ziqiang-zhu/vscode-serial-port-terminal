import * as vscode from 'vscode';

const DEFAULT_TIMESTAMP_FORMAT = '[{HH}:{mm}:{ss}.{SSS}] ';
const TIMESTAMP_TOKEN = /\{YYYY\}|\{MM\}|\{DD\}|\{HH\}|\{mm\}|\{ss\}|\{SSS\}/g;

export class SerialPortLineTimestampBuffer {
  private readonly timestampFormat: string;
  private pending = '';

  constructor() {
    const config = vscode.workspace.getConfiguration('serialPortTerminal');
    const format = config.get<string>('logTimestampFormat', DEFAULT_TIMESTAMP_FORMAT);
    this.timestampFormat = format && format.trim() ? format : DEFAULT_TIMESTAMP_FORMAT;
  }

  process(data: Buffer): Buffer {
    this.pending += data.toString('utf-8');
    const lines = this.pending.split('\n');
    this.pending = lines.pop() ?? '';
    const timestamp = this.formatTimestamp();
    return Buffer.from(lines.map(line => timestamp + line + '\n').join(''), 'utf-8');
  }

  flush(): Buffer {
    if (this.pending.length === 0) {
      return Buffer.alloc(0);
    }
    const result = this.formatTimestamp() + this.pending;
    this.pending = '';
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
