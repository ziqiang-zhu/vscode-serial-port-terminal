import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ASSIST_BUFFER_LIMIT, SerialPortAssistBuffer } from '../../src/SerialPortConsumer/SerialPortAssist/SerialPortAssistBuffer';

// 契约（doc/ConsumerDesign/SerialPortAssist设计.md §5.1）：chunk 级环形缓冲——
// push 记录 seq（全局单调）与入缓冲时刻（ms）、容量超限丢弃最旧并累计 truncated、
// drain(sinceSeq) 取增量（防乱序防丢失）。纯逻辑（无 vscode 依赖）。
// 时间戳断言采用无 flake 策略（前闭后开窗口 + 非递减），不依赖墙钟精确值。

describe('SerialPortAssistBuffer（串口助手缓冲管线）', () => {
  it('#1 push 产出 seq 全局单调递增（跨方向连续）', () => {
    const buffer = new SerialPortAssistBuffer();
    const a = buffer.push(Buffer.from('a'), 'rx');
    const b = buffer.push(Buffer.from('b'), 'tx');
    const c = buffer.push(Buffer.from('c'), 'rx');
    assert.deepEqual([a.seq, b.seq, c.seq], [1, 2, 3]);
  });

  it('#2 entry 携带方向与原字节（同引用零拷贝）', () => {
    const buffer = new SerialPortAssistBuffer();
    const data = Buffer.from('ping');
    const entry = buffer.push(data, 'rx');
    assert.equal(entry.dir, 'rx');
    assert.equal(entry.bytes, data);
  });

  it('#3 ts 为入缓冲时刻（前闭后开窗口，多次 push 非递减）', () => {
    const buffer = new SerialPortAssistBuffer();
    const before = Date.now();
    const first = buffer.push(Buffer.from('x'), 'rx');
    const second = buffer.push(Buffer.from('y'), 'tx');
    const after = Date.now();
    assert.ok(first.ts >= before && first.ts <= after);
    assert.ok(second.ts >= first.ts);
  });

  it('#4 drain(0) 返回全部条目；drain(latest) 返回空', () => {
    const buffer = new SerialPortAssistBuffer();
    const a = buffer.push(Buffer.from('a'), 'rx');
    buffer.push(Buffer.from('b'), 'tx');
    assert.equal(buffer.drain(0).length, 2);
    assert.deepEqual(buffer.drain(a.seq + 1), []);
    const latest = buffer.snapshot().at(-1);
    if (!latest) {
      assert.fail('buffer should not be empty');
    }
    assert.equal(buffer.drain(latest.seq).length, 0);
  });

  it('#5 drain(sinceSeq) 只返回其后的增量（不重不漏）', () => {
    const buffer = new SerialPortAssistBuffer();
    for (const ch of ['1', '2', '3']) {
      buffer.push(Buffer.from(ch), 'rx');
    }
    const mid = buffer.drain(0).at(1);
    if (!mid) {
      assert.fail('second entry missing');
    }
    const tail = buffer.drain(mid.seq);
    assert.deepEqual(
      tail.map(entry => entry.bytes.toString()),
      ['3']
    );
  });

  it('#6 超限丢弃最旧并累计 truncated（容量保持 LIMIT）', () => {
    const buffer = new SerialPortAssistBuffer();
    const total = ASSIST_BUFFER_LIMIT + 5;
    for (let i = 0; i < total; i++) {
      buffer.push(Buffer.from([i % 256]), 'rx');
    }
    assert.equal(buffer.size, ASSIST_BUFFER_LIMIT);
    assert.equal(buffer.truncated, 5);
    // 最旧的 5 条被丢弃：缓冲首条 seq = 6
    assert.equal(buffer.snapshot().at(0)?.seq, 6);
  });

  it('#7 截断后 drain 的缺口可经 truncated 获知', () => {
    const buffer = new SerialPortAssistBuffer();
    for (let i = 0; i < ASSIST_BUFFER_LIMIT + 1; i++) {
      buffer.push(Buffer.from([i % 256]), 'tx');
    }
    assert.equal(buffer.truncated, 1);
    // sinceSeq=0 请求全量也只拿得到保留区间（调用方对比 truncated 得知缺口）
    assert.equal(buffer.drain(0).length, ASSIST_BUFFER_LIMIT);
  });

  it('#8 rx/tx 混合入缓冲保持到达顺序', () => {
    const buffer = new SerialPortAssistBuffer();
    buffer.push(Buffer.from('r1'), 'rx');
    buffer.push(Buffer.from('t1'), 'tx');
    buffer.push(Buffer.from('r2'), 'rx');
    const drained = buffer.drain(0);
    assert.deepEqual(
      drained.map(e => `${e.dir}:${e.bytes.toString()}`),
      ['rx:r1', 'tx:t1', 'rx:r2']
    );
  });

  it('#9 空 chunk 也成条目（方向与 seq 完整）', () => {
    const buffer = new SerialPortAssistBuffer();
    const entry = buffer.push(Buffer.alloc(0), 'tx');
    assert.equal(entry.seq, 1);
    assert.equal(entry.dir, 'tx');
    assert.equal(buffer.size, 1);
  });

  it('#10 snapshot 返回副本（外部变更不影响缓冲）', () => {
    const buffer = new SerialPortAssistBuffer();
    buffer.push(Buffer.from('a'), 'rx');
    const snap = buffer.snapshot();
    (snap as AssistEntryMutable[]).push({
      seq: 99,
      ts: 0,
      dir: 'rx',
      bytes: Buffer.alloc(0)
    });
    assert.equal(buffer.size, 1);
  });

  it('#11 容量常量锚点 5000（设计 §5.1）', () => {
    assert.equal(ASSIST_BUFFER_LIMIT, 5000);
  });
});

type AssistEntryMutable = {
  seq: number;
  ts: number;
  dir: 'rx' | 'tx';
  bytes: Buffer;
};
