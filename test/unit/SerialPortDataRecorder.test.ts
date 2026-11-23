import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { SerialPortDataRecorder } from '../../src/SerialPortConsumer/SerialPortAssist/SerialPortDataRecorder';

// 契约（doc/ConsumerDesign/SerialPortAssist设计.md §6 / doc/Test/开发测试体系.md §6.20）：
// chunk 级记录「[固定毫秒时间戳] 方向 小写HEX」行（\r\n 行尾）；RX 经广播（onData）、
// TX 经发送漏斗直调（recordTx）；空 chunk 跳过；懒建文件（open 确认创建、「已保存」
// 以确认为前提）；按大小分割（logMaxFileSize）；A3 失败语义（每次失败都提示、总是
// 允许重试）。真实 fs + 临时目录；提示经模块桩记录器做增量断言；配置注入走桩的
// __setConfiguration（maxBytes 构造期读取）。

const stub = vscode as unknown as {
  __shownErrorMessages(): string[];
  __shownInfoMessages(): string[];
  __setConfiguration(key: string, value: string | number | boolean | undefined): void;
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(message: string, probe: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!probe()) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor timeout: ${message}`);
    }
    await sleep(20);
  }
}

function tempDir(): { dir: string; dispose(): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spt-datarecorder-'));
  return { dir, dispose: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// 行格式断言（时间戳为墙钟生成，按结构匹配——同 LineTimestampBuffer 的无 flake 策略）：
// [YYYY-MM-DD HH:mm:ss.SSS] RX 55 85（split 后不含行尾，行尾 \r\n 另行断言）
const LINE_PATTERN = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] (RX|TX) [0-9a-f ]+$/;

describe('SerialPortDataRecorder（数据记录）', () => {
  it('#1 records rx and tx lines in the fixed machine format', async () => {
    const { dir, dispose } = tempDir();
    try {
      const file = path.join(dir, 'session.dat');
      const recorder = new SerialPortDataRecorder(file);
      recorder.onData(Buffer.from([0x55, 0x85, 0x11, 0x94]));
      recorder.recordTx(Buffer.from([0xff, 0x00]));
      recorder.onClosed();
      await waitFor('content flushed', () => {
        try {
          const text = fs.readFileSync(file, 'utf8');
          return text.includes('RX 55 85 11 94') && text.includes('TX ff 00');
        } catch {
          return false;
        }
      });
      const raw = fs.readFileSync(file, 'utf8');
      assert.ok(raw.endsWith('\r\n'), 'every record line ends with CRLF');
      const lines = raw.split('\r\n').filter(line => line.length > 0);
      assert.equal(lines.length, 2);
      assert.ok(lines.every(line => LINE_PATTERN.test(line)), 'every line matches the fixed machine format');
      assert.ok(lines.some(line => line.includes(' RX 55 85 11 94')));
      assert.ok(lines.some(line => line.includes(' TX ff 00')));
    } finally {
      dispose();
    }
  });

  it('#2 creates the file lazily on the first record and shows the saved notice on close', async () => {
    const infoBefore = stub.__shownInfoMessages().length;
    const errorBefore = stub.__shownErrorMessages().length;
    const { dir, dispose } = tempDir();
    try {
      const file = path.join(dir, 'lazy.dat');
      const recorder = new SerialPortDataRecorder(file);
      assert.equal(fs.existsSync(file), false, 'file must not exist before the first record');
      recorder.onData(Buffer.from('ping'));
      await waitFor('file created on disk (open event)', () => fs.existsSync(file));
      recorder.onClosed();
      await waitFor('saved notice shown', () => stub.__shownInfoMessages().length === infoBefore + 1);
      assert.equal(stub.__shownErrorMessages().length, errorBefore);
    } finally {
      dispose();
    }
  });

  it('#3 skips empty chunks (no file, no lines, no saved notice)', async () => {
    const infoBefore = stub.__shownInfoMessages().length;
    const { dir, dispose } = tempDir();
    try {
      const file = path.join(dir, 'empty.dat');
      const recorder = new SerialPortDataRecorder(file);
      recorder.onData(Buffer.alloc(0));
      recorder.recordTx(Buffer.alloc(0));
      recorder.onClosed();
      assert.equal(fs.existsSync(file), false);
      assert.equal(stub.__shownInfoMessages().length, infoBefore, 'open 未成功确认 → 无「已保存」');
    } finally {
      dispose();
    }
  });

  it('#4 splits segments by size (logMaxFileSize)', async () => {
    stub.__setConfiguration('logMaxFileSize', 1); // 1 KB
    const { dir, dispose } = tempDir();
    try {
      const file = path.join(dir, 'split.dat');
      const recorder = new SerialPortDataRecorder(file);
      const chunk = Buffer.alloc(512, 0xab);
      for (let i = 0; i < 5; i++) {
        recorder.onData(chunk);
      }
      recorder.onClosed();
      await waitFor('segment files flushed', () => fs.existsSync(file) && fs.existsSync(`${dir}/split_002.dat`));
      const first = fs.readFileSync(file, 'utf8');
      const second = fs.readFileSync(path.join(dir, 'split_002.dat'), 'utf8');
      assert.ok(first.split('\r\n').filter(l => l.length > 0).length > 0);
      assert.ok(second.split('\r\n').filter(l => l.length > 0).length > 0);
      assert.ok(second.includes('RX ab ab'));
    } finally {
      stub.__setConfiguration('logMaxFileSize', 0);
      dispose();
    }
  });

  it('#5 reports every write failure and keeps retrying (A3 semantics)', async () => {
    const infoBefore = stub.__shownInfoMessages().length;
    const errorBefore = stub.__shownErrorMessages().length;
    const { dir, dispose } = tempDir();
    try {
      // 父目录位置被文件占用 → open 确定性失败（ENOTDIR/ENOENT）
      const blocker = path.join(dir, 'blocker');
      fs.writeFileSync(blocker, 'x');
      const file = path.join(blocker, 'session.dat');
      const recorder = new SerialPortDataRecorder(file);
      recorder.onData(Buffer.from('hello'));
      await waitFor('first write error shown', () => stub.__shownErrorMessages().length === errorBefore + 1);
      recorder.recordTx(Buffer.from('more')); // 重建流重新尝试 → 仍失败 → 再次提示
      await waitFor('second write error shown', () => stub.__shownErrorMessages().length === errorBefore + 2);
      recorder.onClosed(); // 收尾关流 + notifySaved（open 未成功 → 抑制）
      assert.equal(stub.__shownErrorMessages().length, errorBefore + 2);
      assert.equal(stub.__shownInfoMessages().length, infoBefore);
      assert.equal(fs.existsSync(file), false);
    } finally {
      dispose();
    }
  });
});
