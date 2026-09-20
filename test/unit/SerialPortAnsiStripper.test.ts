import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SerialPortAnsiStripper } from '../../src/SerialPortConsumer/SerialPortDataParsers/SerialPortAnsiStripper';

// 目标契约：行缓冲式剥离（doc/Test/开发测试体系规划.md §6.1）。
// 以 \n 为行单位，转义序列不跨行生效；未获得换行时尾行保留，断开时刷出剩余半行。
// 本套件以现行 strip API 逐 chunk 断言目标契约：失败用例如实保留（暂不修复实现），
// actual / expected 即当前行为与契约的差距明细。

const stripper = new SerialPortAnsiStripper();
const strip = (text: string): string =>
  stripper.strip(Buffer.from(text, 'utf-8')).toString('utf-8');

describe('SerialPortAnsiStripper 剥离逻辑（逐 chunk strip 对比行缓冲契约）', () => {
  it('#1 strips a complete line with CSI colors', () => {
    assert.equal(strip('\x1b[31mRED\x1b[0m\n'), 'RED\n');
  });

  it('#2 strips every line in one multi-line chunk', () => {
    assert.equal(strip('\x1b[1ma\x1b[0m\nb\x1b[2Kc\n'), 'a\nbc\n');
  });

  it('#3 strips sequences at line start, middle and end', () => {
    assert.equal(strip('\x1b[1mhead mid\x1b[3;4Htail\x1b[0m\n'), 'head midtail\n');
  });

  it('#4 strips OSC lines', () => {
    assert.equal(strip('\x1b]0;title\x07rest\n'), 'rest\n');
  });

  it('#5 strips C1 (0x9B) lines', () => {
    assert.equal(strip('\x9b4mC1\n'), 'C1\n');
  });

  it('#6 strips screen-clear and cursor-home lines', () => {
    assert.equal(strip('\x1b[2J\x1b[Hready\n'), 'ready\n');
  });

  it('#7 passes plain lines through', () => {
    assert.equal(strip('plain\n'), 'plain\n');
  });

  it('#8 contract: an incomplete line is held until a newline arrives', () => {
    assert.equal(strip('half\x1b[31mway'), '');
  });

  it('#9 contract: a sequence split across chunks is fully stripped once the line completes', () => {
    assert.equal(strip('foo\x1b[3'), '');
    assert.equal(strip('1mbar\x1b[0m\n'), 'foobar\n');
  });

  it('#10 contract: one line accumulated across three chunks', () => {
    assert.equal(strip('sta\x1b[3'), '');
    assert.equal(strip('1mrt\x1b'), '');
    assert.equal(strip('[31m!end\n'), 'start!end\n');
  });

  it('#11 contract: multibyte characters split across chunks are buffered byte-wise', () => {
    const qi = Buffer.from('启', 'utf-8');
    assert.equal(strip(qi.subarray(0, 1).toString('utf-8')), '');
  });

  it('#12 keeps CR as line content for CRLF lines', () => {
    assert.equal(strip('win\r\n'), 'win\r\n');
  });

  it('#13 keeps a dangling ESC at end of line as literal text', () => {
    assert.equal(strip('abc\x1b\n'), 'abc\x1b\n');
  });

  it('#14 strips a truncated sequence inside a complete line', () => {
    assert.equal(strip('abc\x1b[31\n'), 'abc\n');
  });

  it('#15 emits empty lines and strips a bare-reset line', () => {
    assert.equal(strip('\n\n\x1b[0m\n'), '\n\n\n');
  });

  it('#16 keeps multibyte text intact in a complete line', () => {
    assert.equal(strip('\x1b[32m启动中\x1b[0m ok\n'), '启动中 ok\n');
  });

  it('#17 contract: byte-by-byte chunks are equivalent to a single chunk', () => {
    let out = '';
    for (const b of Buffer.from('a\x1b[31mb\n')) {
      out += stripper.strip(Buffer.from([b])).toString('utf-8');
    }
    assert.equal(out, 'ab\n');
  });

  it('#18 contract: a chunk without newline is held, not emitted', () => {
    assert.equal(strip('c'), '');
  });
});

describe('SerialPortAnsiStripper 行缓冲 API 契约', () => {
  it('#19 provides process/flush for line buffering and disconnect flush', () => {
    const s = stripper as unknown as Record<string, unknown>;
    assert.equal(typeof s.process, 'function', 'process(data: Buffer): Buffer 缺失');
    assert.equal(typeof s.flush, 'function', 'flush(): Buffer 缺失');
  });
});
