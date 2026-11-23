// 串口助手缓冲管线（纯逻辑，无 vscode 依赖——契约见 doc/ConsumerDesign/SerialPortAssist设计.md §5.1）：
// chunk 级环形缓冲——push 记录入缓冲时刻（ms）与方向，容量超限丢弃最旧并累计
// truncated；drain(sinceSeq) 供 100ms 批刷取增量，seq 全局单调防乱序防丢失。
// 显示与落盘均以 chunk 为粒度（chunk 边界即时序信息，不做跨 chunk 聚合）。

export const ASSIST_BUFFER_LIMIT = 5000;

export type AssistDirection = 'rx' | 'tx';

export interface AssistEntry {
  /** 全局单调递增序号（跨 rx/tx 连续），批刷去重与前端排序的唯一依据 */
  readonly seq: number;
  /** 入缓冲时刻 Date.now()（ms）——DataRecorder 与页内时间列共用同一时刻 */
  readonly ts: number;
  readonly dir: AssistDirection;
  readonly bytes: Buffer;
}

export class SerialPortAssistBuffer {
  private entries: AssistEntry[] = [];
  private nextSeq = 1;
  private truncatedCount = 0;

  /** chunk 入缓冲；容量超限一次性收紧并按丢弃条数累计 truncated。 */
  push(data: Buffer, dir: AssistDirection): AssistEntry {
    const entry: AssistEntry = {
      seq: this.nextSeq++,
      ts: Date.now(),
      dir,
      bytes: data
    };
    this.entries.push(entry);
    if (this.entries.length > ASSIST_BUFFER_LIMIT) {
      const drop = this.entries.length - ASSIST_BUFFER_LIMIT;
      this.entries.splice(0, drop);
      this.truncatedCount += drop;
    }
    return entry;
  }

  /** 取 seq 大于 sinceSeq 的全部条目（被截断丢弃的旧条目天然不在其中，缺口经 truncated 获知）。 */
  drain(sinceSeq: number): AssistEntry[] {
    return this.entries.filter(entry => entry.seq > sinceSeq);
  }

  /** 诊断/集成断言用：当前缓冲全量快照（拷贝引用数组，不拷贝条目）。 */
  snapshot(): readonly AssistEntry[] {
    return [...this.entries];
  }

  /** 累计被容量上限丢弃的条目数。 */
  get truncated(): number {
    return this.truncatedCount;
  }

  get size(): number {
    return this.entries.length;
  }
}
