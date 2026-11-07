import * as fs from 'fs';
import { SerialPortInfo } from '../SerialPortHal';
import { VirtualDeviceProfile, VirtualDeviceKind, VirtualEmit } from './VirtualDeviceProfile';

const TICK_MS = 100;
const LINES_UNIT_MS = 1000; // 1 行的预算（ms 基整数，规避浮点累进漂移）

// 回放播放状态机（控制台 P1 设计需求）：idle 无文件；armed 已选文件待开始
// （端口打开时自动开播，连接中选文件则等待显式开始）；playing 播放中；
// paused 暂停（进度保留）。EOF 播放结束回 armed；stop 回 armed 并清进度。
export type ReplayPhase = 'idle' | 'armed' | 'playing' | 'paused';

// 日志回放画像（契约见 doc/Hal/SerialPortHalVirtual规划.md §4.4、§10.3）：
// 数据源为纯文本日志文件，打开端口时读取，按原始字节切片逐行播放——
// \r\n 行尾与多字节字符字节级保真（真实采集日志回放的核心价值）。
// 速率 = 行/秒；内部以 100ms 节拍批发（每节拍预算 rate*100ms，满 1000ms 出 1 行，余数累进）。
// 无文件或不可读 → 静默设备；主机输入忽略；播放随端口 close 停止。
// 纯逻辑 + Node 内建 fs，不 import vscode，可直接单测。
export class ReplayProfile extends VirtualDeviceProfile {
  readonly info: SerialPortInfo = { path: 'VCOM-REPLAY', manufacturer: 'Virtual' };
  readonly kind: VirtualDeviceKind = 'replay';

  private phase: ReplayPhase;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lines: Buffer[] = [];
  private lineIndex = 0;
  private carryMs = 0;
  private playingEmit: VirtualEmit | undefined;

  constructor(
    private file?: string,
    private rate = 100,
    private loop = false
  ) {
    super();
    this.phase = this.file ? 'armed' : 'idle';
  }

  getRate(): number {
    return this.rate;
  }

  getLoop(): boolean {
    return this.loop;
  }

  getFile(): string | undefined {
    return this.file;
  }

  getPhase(): ReplayPhase {
    return this.phase;
  }

  // 控制面（P3）：速率播放中即时生效（tick 逐拍读取），待播状态仅保存。
  setRate(rate: number): void {
    if (Number.isFinite(rate) && rate >= 1) {
      this.rate = Math.floor(rate);
    }
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    // armed（含 EOF 播放结束）后启用循环：进度内容仍在时重启播放；
    // 用户 stop() 已清空 lines，此处不会误重启。
    if (this.loop && this.phase === 'armed' && this.playingEmit !== undefined && this.lines.length > 0) {
      const emit = this.playingEmit;
      this.phase = 'playing';
      this.timer = setInterval(() => this.tick(emit), TICK_MS);
    }
  }

  // 控制面（P1 播放状态机）：选文件进入 armed（端口已开也不自动播，显式 [开始播放]）；
  // 清空文件（取消选择）回 idle。
  setFile(file: string): void {
    this.file = file && file.trim() ? file : undefined;
    this.stopPlayback();
    this.lines = [];
    this.lineIndex = 0;
    this.carryMs = 0;
    this.phase = this.file ? 'armed' : 'idle';
  }

  // play（控制面）= 确保播放中：armed 从头开播、paused 从原位置继续。
  start(): void {
    if (this.phase === 'paused') {
      this.resume();
      return;
    }
    if (this.phase !== 'armed' || this.playingEmit === undefined) {
      return; // 仅 armed 且端口已打开时可开始
    }
    this.startPlayback();
  }

  pause(): void {
    if (this.phase !== 'playing') {
      return;
    }
    this.stopPlayback(); // 定时器停，进度（lines/lineIndex/carryMs）保留
    this.phase = 'paused';
  }

  resume(): void {
    if (this.phase !== 'paused') {
      return;
    }
    const emit = this.playingEmit;
    if (emit === undefined || this.lines.length === 0) {
      this.phase = this.lines.length > 0 ? 'armed' : 'idle'; // 防御：进度不可用
      return;
    }
    this.phase = 'playing';
    this.timer = setInterval(() => this.tick(emit), TICK_MS);
  }

  stop(): void {
    if (this.phase !== 'playing' && this.phase !== 'paused') {
      return;
    }
    this.stopPlayback();
    this.lines = [];
    this.lineIndex = 0;
    this.carryMs = 0;
    this.phase = 'armed'; // 保留文件，可 [开始播放] 重头再来或 [取消选择]
  }

  onOpen(emit: VirtualEmit): void {
    this.playingEmit = emit;
    if (this.phase === 'armed') {
      this.startPlayback(); // 连接时已选文件：自动开播（P2 契约）
    }
  }

  onInput(_data: Buffer, _emit: VirtualEmit): void {
    // 回放设备为纯数据源：主机侧输入忽略。
  }

  onClose(): void {
    this.stopPlayback();
    this.playingEmit = undefined;
    this.lines = [];
    this.lineIndex = 0;
    this.carryMs = 0;
    this.phase = this.file ? 'armed' : 'idle';
  }

  private startPlayback(): void {
    this.lines = this.readLines();
    this.lineIndex = 0;
    this.carryMs = 0;
    const emit = this.playingEmit;
    if (this.lines.length === 0 || emit === undefined) {
      return; // 文件不可读或端口未就绪：保持 armed（静默，可重新开始）
    }
    this.phase = 'playing';
    this.timer = setInterval(() => this.tick(emit), TICK_MS);
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
          this.phase = 'armed'; // 播放结束：进度内容保留，可 [开始播放] 重头再来
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
