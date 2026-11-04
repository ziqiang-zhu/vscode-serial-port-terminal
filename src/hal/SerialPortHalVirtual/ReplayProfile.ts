import * as fs from 'fs';
import { SerialPortInfo } from '../SerialPortHal';
import { VirtualDeviceProfile, VirtualEmit } from './VirtualDeviceProfile';

const TICK_MS = 100;
const LINES_UNIT_MS = 1000; // 1 行的预算（ms 基整数，规避浮点累进漂移）

// 日志回放画像（契约见 doc/Hal/SerialPortHalVirtual规划.md §4.4、§10.3）：
// 数据源为纯文本日志文件，打开端口时读取，按原始字节切片逐行播放——
// \r\n 行尾与多字节字符字节级保真（真实采集日志回放的核心价值）。
// 速率 = 行/秒；内部以 100ms 节拍批发（每节拍预算 rate*100ms，满 1000ms 出 1 行，余数累进）。
// 无文件或不可读 → 静默设备；主机输入忽略；播放随端口 close 停止。
// 纯逻辑 + Node 内建 fs，不 import vscode，可直接单测。
export class ReplayProfile extends VirtualDeviceProfile {
  readonly info: SerialPortInfo = { path: 'VCOM-REPLAY', manufacturer: 'Virtual' };

  private timer: ReturnType<typeof setInterval> | undefined;
  private lines: Buffer[] = [];
  private lineIndex = 0;
  private carryMs = 0;

  constructor(
    private readonly file?: string,
    private readonly rate = 100,
    private readonly loop = false
  ) {
    super();
  }

  onOpen(emit: VirtualEmit): void {
    this.stopPlayback();
    this.lines = this.readLines();
    this.lineIndex = 0;
    this.carryMs = 0;
    if (this.lines.length === 0) {
      return; // 无文件 / 不可读 / 空文件 → 静默设备
    }
    this.timer = setInterval(() => this.tick(emit), TICK_MS);
  }

  onInput(_data: Buffer, _emit: VirtualEmit): void {
    // 回放设备为纯数据源：主机侧输入忽略。
  }

  onClose(): void {
    this.stopPlayback();
    this.lines = [];
    this.lineIndex = 0;
    this.carryMs = 0;
  }

  private readLines(): Buffer[] {
    if (!this.file) {
      return [];
    }
    try {
      const content = fs.readFileSync(this.file);
      const lines: Buffer[] = [];
      let start = 0;
      for (let i = 0; i < content.length; i++) {
        if (content[i] === 0x0a) {
          lines.push(content.subarray(start, i + 1));
          start = i + 1;
        }
      }
      if (start < content.length) {
        lines.push(content.subarray(start)); // 末行无换行符
      }
      return lines;
    } catch {
      return [];
    }
  }

  private tick(emit: VirtualEmit): void {
    this.carryMs += this.rate * TICK_MS;
    const chunk: Buffer[] = [];
    while (this.carryMs >= LINES_UNIT_MS) {
      if (this.lineIndex >= this.lines.length) {
        if (!this.loop) {
          this.stopPlayback();
          break;
        }
        this.lineIndex = 0;
      }
      const line = this.lines[this.lineIndex++];
      if (line) {
        chunk.push(line);
      }
      this.carryMs -= LINES_UNIT_MS;
    }
    if (chunk.length > 0) {
      emit(Buffer.concat(chunk));
    }
  }

  private stopPlayback(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
