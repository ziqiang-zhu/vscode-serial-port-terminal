const ANSI_ESCAPE_SEQUENCE =
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

const LINE_FEED = 0x0a;

// 行缓冲式 ANSI 剥离（契约见 doc/Test/开发测试体系规划.md §6.1）：
// 以 \n 为行单位，转义序列不跨行生效；未获得换行时尾行按原始字节保留，
// 等待后续数据，断开收尾经 flush() 剥离刷出。
export class SerialPortAnsiStripper {
  private pending: Buffer = Buffer.alloc(0);

  // 处理一个 chunk：输出其中完整行的剥离结果，尾行保留。
  process(data: Buffer): Buffer {
    if (data.length > 0) {
      this.pending = Buffer.concat([this.pending, data]);
    }
    const outputs: string[] = [];
    let start = 0;
    for (let i = 0; i < this.pending.length; i++) {
      if (this.pending[i] === LINE_FEED) {
        outputs.push(this.stripLine(this.pending.subarray(start, i + 1)));
        start = i + 1;
      }
    }
    this.pending = this.pending.subarray(start);
    return Buffer.from(outputs.join(''), 'utf-8');
  }

  // 断开收尾：剥离并刷出剩余半行，随后状态复位。
  flush(): Buffer {
    if (this.pending.length === 0) {
      return Buffer.alloc(0);
    }
    const rest = this.stripLine(this.pending);
    this.pending = Buffer.alloc(0);
    return Buffer.from(rest, 'utf-8');
  }

  private stripLine(line: Buffer): string {
    return line.toString('utf-8').replace(ANSI_ESCAPE_SEQUENCE, '');
  }
}
