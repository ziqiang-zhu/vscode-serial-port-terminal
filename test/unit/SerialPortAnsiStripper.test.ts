import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SerialPortAnsiStripper } from '../../src/SerialPortConsumer/SerialPortDataParsers/SerialPortAnsiStripper';

// 行缓冲式剥离契约（doc/Test/开发测试体系规划.md §6.1，已实现）：
// 以 \n 为行单位，转义序列不跨行生效；未获得换行时尾行保留，断开时 flush 刷出剩余半行。
describe('SerialPortAnsiStripper（行缓冲契约）', () => {
  const run = (s: SerialPortAnsiStripper, text: string): string =>
    s.process(Buffer.from(text, 'utf-8')).toString('utf-8');

  it('#1 strips a complete line with CSI colors', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, '\x1b[31mRED\x1b[0m\n'), 'RED\n');
    assert.equal(s.flush().toString('utf-8'), '');
  });

  it('#2 strips every line in one multi-line chunk', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, '\x1b[1ma\x1b[0m\nb\x1b[2Kc\n'), 'a\nbc\n');
    assert.equal(s.flush().toString('utf-8'), '');
  });

  it('#3 strips sequences at line start, middle and end', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, '\x1b[1mhead mid\x1b[3;4Htail\x1b[0m\n'), 'head midtail\n');
  });

  it('#4 strips OSC lines', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, '\x1b]0;title\x07rest\n'), 'rest\n');
  });

  it('#5 strips C1 (0x9B) lines', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, '\x9b4mC1\n'), 'C1\n');
  });

  it('#6 strips screen-clear and cursor-home lines', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, '\x1b[2J\x1b[Hready\n'), 'ready\n');
  });

  it('#7 passes plain lines through', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, 'plain\n'), 'plain\n');
    assert.equal(s.flush().toString('utf-8'), '');
  });

  it('#8 holds an incomplete line and emits nothing until a newline arrives', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, 'half\x1b[31mway'), '');
    assert.equal(run(s, '\n'), 'halfway\n');
    assert.equal(s.flush().toString('utf-8'), '');
  });

  it('#9 completes a sequence split across a chunk boundary within one line', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, 'foo\x1b[3'), '');
    assert.equal(run(s, '1mbar\x1b[0m\n'), 'foobar\n');
    assert.equal(s.flush().toString('utf-8'), '');
  });

  it('#10 accumulates one line across three chunks', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, 'sta\x1b[3'), '');
    assert.equal(run(s, '1mrt\x1b'), '');
    assert.equal(run(s, '[31m!end\n'), 'start!end\n');
  });

  it('#11 keeps multibyte characters split across chunks intact', () => {
    const s = new SerialPortAnsiStripper();
    const qi = Buffer.from('启', 'utf-8');
    assert.equal(s.process(qi.subarray(0, 1)).toString('utf-8'), '');
    assert.equal(s.process(qi.subarray(1)).toString('utf-8'), '');
    assert.equal(run(s, '动\x1b[0m\n'), '启动\n');
  });

  it('#12 keeps CR as line content for CRLF lines', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, 'win\r\n'), 'win\r\n');
  });

  it('#13 keeps a dangling ESC at end of line as literal text', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, 'abc\x1b\n'), 'abc\x1b\n');
  });

  it('#14 strips a truncated sequence inside a complete line', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, 'abc\x1b[31\n'), 'abc\n');
  });

  it('#15 emits empty lines and strips a bare-reset line', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, '\n\n\x1b[0m\n'), '\n\n\n');
  });

  it('#16 keeps multibyte text intact in a complete line', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, '\x1b[32m启动中\x1b[0m ok\n'), '启动中 ok\n');
  });

  it('#17 byte-by-byte chunks are equivalent to a single chunk', () => {
    const s = new SerialPortAnsiStripper();
    let out = '';
    for (const b of Buffer.from('a\x1b[31mb\n')) {
      out += s.process(Buffer.from([b])).toString('utf-8');
    }
    out += s.flush().toString('utf-8');
    assert.equal(out, 'ab\n');

    const s2 = new SerialPortAnsiStripper();
    let out2 = '';
    for (const b of Buffer.from('启', 'utf-8')) {
      out2 += s2.process(Buffer.from([b])).toString('utf-8');
    }
    out2 += run(s2, '动\x1b[0m\n');
    assert.equal(out2, '启动\n');
  });

  it('#18 flushes the remaining half-line on disconnect', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(run(s, 'c'), '');
    assert.equal(s.flush().toString('utf-8'), 'c');
  });

  it('#19 provides the process/flush line-buffering API', () => {
    const s = new SerialPortAnsiStripper();
    assert.equal(typeof s.process, 'function');
    assert.equal(typeof s.flush, 'function');
  });
});
