import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';

import { SerialPortLineTimestampBuffer } from '../../src/SerialPortConsumer/SerialPortLogRecorder/SerialPortLineTimestampBuffer';

// 契约（doc/Test/开发测试体系规划.md §6.2）：按 \n 行缓冲加时间戳，
// 未完成尾行保留、flush 刷出；格式经 workspace 配置注入，空/空白回退默认。
// 模块桩配置表跨用例共享：每个用例开头显式设置或清除格式，避免顺序污染。
// 时钟不可注入：仅用无占位符恒定格式与 {SSS} 结构断言，不做墙钟精确比对。

const setFormat = (format: string | undefined): void => {
  (vscode as unknown as {
    __setConfiguration(key: string, value: string | undefined): void;
  }).__setConfiguration('logTimestampFormat', format);
};

const text = (buf: Buffer): string => buf.toString('utf-8');

describe('SerialPortLineTimestampBuffer（行缓冲契约）', () => {
  it('#1 prefixes every completed line with a constant custom format', () => {
    setFormat('T|');
    const s = new SerialPortLineTimestampBuffer();
    assert.equal(text(s.process(Buffer.from('line\n'))), 'T|line\n');
    assert.equal(text(s.flush()), '');
  });

  it('#2 uses the default format when none is configured', () => {
    setFormat(undefined);
    const s = new SerialPortLineTimestampBuffer();
    assert.match(text(s.process(Buffer.from('line\n'))), /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] line\n$/);
  });

  it('#3 falls back to the default format for a whitespace-only format', () => {
    setFormat('   ');
    const s = new SerialPortLineTimestampBuffer();
    assert.match(text(s.process(Buffer.from('line\n'))), /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] line\n$/);
  });

  it('#4 falls back to the default format for an empty format', () => {
    setFormat('');
    const s = new SerialPortLineTimestampBuffer();
    assert.match(text(s.process(Buffer.from('line\n'))), /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] line\n$/);
  });

  it('#5 replaces the {SSS} token with zero-padded milliseconds', () => {
    setFormat('[{SSS}] ');
    const s = new SerialPortLineTimestampBuffer();
    assert.match(text(s.process(Buffer.from('line\n'))), /^\[\d{3}\] line\n$/);
  });

  it('#6 replaces every supported placeholder exactly once', () => {
    setFormat('{YYYY}-{MM}-{DD} {HH}:{mm}:{ss}.{SSS} ');
    const s = new SerialPortLineTimestampBuffer();
    assert.match(
      text(s.process(Buffer.from('line\n'))),
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} line\n$/
    );
  });

  it('#7 keeps unknown tokens as literal text', () => {
    setFormat('T{X}|');
    const s = new SerialPortLineTimestampBuffer();
    assert.equal(text(s.process(Buffer.from('line\n'))), 'T{X}|line\n');
  });

  it('#8 prefixes every line in one multi-line chunk', () => {
    setFormat('T|');
    const s = new SerialPortLineTimestampBuffer();
    assert.equal(text(s.process(Buffer.from('a\nb\n'))), 'T|a\nT|b\n');
  });

  it('#9 holds an incomplete line until the newline arrives', () => {
    setFormat('T|');
    const s = new SerialPortLineTimestampBuffer();
    assert.equal(text(s.process(Buffer.from('half'))), '');
    assert.equal(text(s.process(Buffer.from('\n'))), 'T|half\n');
  });

  it('#10 accumulates one line across three chunks', () => {
    setFormat('T|');
    const s = new SerialPortLineTimestampBuffer();
    assert.equal(text(s.process(Buffer.from('sta'))), '');
    assert.equal(text(s.process(Buffer.from('rt-'))), '');
    assert.equal(text(s.process(Buffer.from('end\n'))), 'T|start-end\n');
  });

  it('#11 flushes an empty buffer to empty output', () => {
    setFormat('T|');
    const s = new SerialPortLineTimestampBuffer();
    assert.equal(text(s.process(Buffer.from('done\n'))), 'T|done\n');
    assert.equal(text(s.flush()), '');
  });

  it('#12 flushes the remaining half-line without a newline', () => {
    setFormat('T|');
    const s = new SerialPortLineTimestampBuffer();
    assert.equal(text(s.process(Buffer.from('half'))), '');
    assert.equal(text(s.flush()), 'T|half');
  });

  it('#13 resets state after flush', () => {
    setFormat('T|');
    const s = new SerialPortLineTimestampBuffer();
    s.process(Buffer.from('half'));
    assert.equal(text(s.flush()), 'T|half');
    assert.equal(text(s.process(Buffer.from('x\n'))), 'T|x\n');
    assert.equal(text(s.flush()), '');
  });

  it('#14 prefixes empty lines too', () => {
    setFormat('T|');
    const s = new SerialPortLineTimestampBuffer();
    assert.equal(text(s.process(Buffer.from('\n'))), 'T|\n');
  });

  it('#15 keeps CRLF line endings and multibyte content intact', () => {
    setFormat('T|');
    const s = new SerialPortLineTimestampBuffer();
    assert.equal(text(s.process(Buffer.from('win\r\n启动\n'))), 'T|win\r\nT|启动\n');
  });

  it('#16 carries no state pollution across consecutive rounds', () => {
    setFormat('T|');
    const s = new SerialPortLineTimestampBuffer();
    assert.equal(text(s.process(Buffer.from('a\n'))), 'T|a\n');
    assert.equal(text(s.process(Buffer.from('b\n'))), 'T|b\n');
    assert.equal(text(s.process(Buffer.from('c\n'))), 'T|c\n');
    assert.equal(text(s.flush()), '');
  });

  it('#17 processes an empty chunk to empty output', () => {
    setFormat('T|');
    const s = new SerialPortLineTimestampBuffer();
    assert.equal(text(s.process(Buffer.alloc(0))), '');
  });

  it('#18 contract: multibyte characters split across chunks are buffered byte-wise', () => {
    setFormat('T|');
    const s = new SerialPortLineTimestampBuffer();
    const qi = Buffer.from('启', 'utf-8');
    assert.equal(text(s.process(qi.subarray(0, 1))), '');
    assert.equal(text(s.process(qi.subarray(1))), '');
    assert.equal(text(s.process(Buffer.from('动\n'))), 'T|启动\n');
  });

  it('#19 shares one timestamp across the lines of the same chunk', () => {
    setFormat('[{SSS}] ');
    const s = new SerialPortLineTimestampBuffer();
    const out = text(s.process(Buffer.from('a\nb\n')));
    const prefixes = out.split('\n').filter(Boolean).map(line => line.slice(0, 6));
    assert.equal(prefixes[0], prefixes[1]);
  });

  it('#20 outputs half-lines fed after a completed line via flush', () => {
    setFormat('T|');
    const s = new SerialPortLineTimestampBuffer();
    // 模拟 LogRecorder 断开管线：先喂入完整行，再喂入剥离器 flush 出的半行。
    assert.equal(text(s.process(Buffer.from('a\n'))), 'T|a\n');
    assert.equal(text(s.process(Buffer.from('tail'))), '');
    assert.equal(text(s.flush()), 'T|tail');
  });
});
