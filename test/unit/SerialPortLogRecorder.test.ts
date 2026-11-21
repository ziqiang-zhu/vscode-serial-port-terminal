import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { SerialPortLogRecorder } from '../../src/SerialPortConsumer/SerialPortLogRecorder/SerialPortLogRecorder';

// 契约（doc/Test/开发测试体系.md §6.12）：写盘失败每次都提示（不去重）；错误流丢弃后
// 下一块数据重建流重新尝试（总是允许尝试保存，恢复后自动续记）；「文件已保存」提示以
// open 事件确认创建为前提（打开失败不弹）。真实 fs + 临时目录；提示经模块桩记录器
// （__shownInfoMessages / __shownErrorMessages）断言（桩跨用例共享，各用例以进入时
// 快照做增量断言，不依赖执行顺序）。

const stub = vscode as unknown as {
  __shownErrorMessages(): string[];
  __shownInfoMessages(): string[];
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// 等待谓词成立：流式写盘 end 后异步刷盘、open/error 事件异步到达，轮询至超时。
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spt-recorder-'));
  return { dir, dispose: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe('SerialPortLogRecorder（写盘失败语义）', () => {
  it('#1 writes data, confirms creation and shows the saved notice', async () => {
    const infoBefore = stub.__shownInfoMessages().length;
    const errorBefore = stub.__shownErrorMessages().length;
    const { dir, dispose } = tempDir();
    try {
      const file = path.join(dir, 'log.log');
      const recorder = new SerialPortLogRecorder(file);
      recorder.onData(Buffer.from('hello\n'));
      await waitFor('file created on disk (open event)', () => fs.existsSync(file));
      recorder.onClosed();
      // 「已保存」提示在收尾 end 回调（尾部 flush 完成）内弹出
      await waitFor('saved notice shown', () => stub.__shownInfoMessages().length === infoBefore + 1);
      await waitFor('data flushed to disk', () => {
        try {
          return fs.readFileSync(file, 'utf8') === 'hello\n';
        } catch {
          return false;
        }
      });
      assert.equal(stub.__shownErrorMessages().length, errorBefore);
    } finally {
      dispose();
    }
  });

  it('#2 shows one write error, no saved notice and creates no file on an unwritable path', async () => {
    const infoBefore = stub.__shownInfoMessages().length;
    const errorBefore = stub.__shownErrorMessages().length;
    const { dir, dispose } = tempDir();
    try {
      // 父目录位置被文件占用 → open 确定性失败（ENOTDIR/ENOENT）
      const blocker = path.join(dir, 'blocker');
      fs.writeFileSync(blocker, 'x');
      const file = path.join(blocker, 'log.log');
      const recorder = new SerialPortLogRecorder(file);
      recorder.onData(Buffer.from('hello\n'));
      recorder.onClosed();
      await waitFor('one write error shown', () => stub.__shownErrorMessages().length === errorBefore + 1);
      // fileCreated 由 open 置位（失败则保持 false）+ writeFailed 双守 → 无「已保存」
      assert.equal(stub.__shownInfoMessages().length, infoBefore);
      assert.equal(fs.existsSync(file), false);
    } finally {
      dispose();
    }
  });

  it('#3 reports every failure and keeps retrying on later data', async () => {
    const infoBefore = stub.__shownInfoMessages().length;
    const errorBefore = stub.__shownErrorMessages().length;
    const { dir, dispose } = tempDir();
    try {
      const blocker = path.join(dir, 'blocker');
      fs.writeFileSync(blocker, 'x');
      const file = path.join(blocker, 'log.log');
      const recorder = new SerialPortLogRecorder(file);
      recorder.onData(Buffer.from('hello\n'));
      await waitFor('first write error shown', () => stub.__shownErrorMessages().length === errorBefore + 1);
      recorder.onData(Buffer.from('more\n')); // 重建流重新尝试（总是允许尝试保存）→ 仍失败 → 再次提示
      await waitFor('second write error shown', () => stub.__shownErrorMessages().length === errorBefore + 2);
      recorder.onClosed(); // 收尾 flush 尝试 + notifySaved（open 未成功 → 抑制）
      assert.equal(stub.__shownErrorMessages().length, errorBefore + 2);
      assert.equal(stub.__shownInfoMessages().length, infoBefore);
      assert.equal(fs.existsSync(file), false);
    } finally {
      dispose();
    }
  });
});
