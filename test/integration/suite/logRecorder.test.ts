import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { after, describe, it } from 'mocha';

import { SerialPortLogRecorder } from '../../../src/SerialPortConsumer/SerialPortLogRecorder/SerialPortLogRecorder';
import { createHarness, findDevice, waitFor, withTempDir, type TestHarness } from './helpers';

// 日志落盘契约（doc/Test/开发测试体系规划.md §6.10 #10–#14）：
// 延迟建文件、ANSI 剥离透传、按大小分割、时间戳行前缀、断开收尾补齐半行。
// 写盘为异步流：onClosed 后轮询断言文件内容（超时 2s）。配置类用例经 workspace
// update(Global) 设置并在 finally 恢复默认。
describe('日志落盘（自装配）', () => {
  let harness: TestHarness;

  before(async () => {
    harness = createHarness();
    await harness.detector.scan();
  });

  after(() => {
    harness.detector.dispose();
  });

  async function connectEchoWithRecorder(logPath: string): Promise<void> {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device);
    const connection = harness.service.getConnection('VCOM-ECHO');
    assert.ok(connection);
    connection.addConsumer(new SerialPortLogRecorder(logPath));
  }

  it('#10 writes received data to the file lazily', async () => {
    const temp = withTempDir();
    try {
      const logPath = path.join(temp.dir, 'session.log');
      await connectEchoWithRecorder(logPath);
      harness.service.getConnection('VCOM-ECHO')?.send(Buffer.from('hello disk\n'));
      await harness.service.disconnect(findDevice(harness.detector, 'VCOM-ECHO'));
      await waitFor('log file content', () => {
        try {
          return fs.readFileSync(logPath, 'utf8').includes('hello disk');
        } catch {
          return false;
        }
      }, 2000);
    } finally {
      temp.dispose();
    }
  });

  it('#11 strips ANSI sequences before writing', async () => {
    const temp = withTempDir();
    try {
      const logPath = path.join(temp.dir, 'ansi.log');
      await connectEchoWithRecorder(logPath);
      harness.service.getConnection('VCOM-ECHO')?.send(Buffer.from('\x1b[31mRED\x1b[0m plain\n'));
      await harness.service.disconnect(findDevice(harness.detector, 'VCOM-ECHO'));
      await waitFor('ansi-stripped content', () => {
        try {
          return fs.readFileSync(logPath, 'utf8').includes('RED plain');
        } catch {
          return false;
        }
      }, 2000);
      assert.ok(!fs.readFileSync(logPath, 'utf8').includes('\x1b['), 'escape sequence leaked to the log file');
    } finally {
      temp.dispose();
    }
  });

  it('#12 splits segments by size (logMaxFileSize)', async () => {
    const temp = withTempDir();
    const config = vscode.workspace.getConfiguration('serialPortTerminal');
    await config.update('logMaxFileSize', 1, vscode.ConfigurationTarget.Global); // 1 KB
    try {
      const logPath = path.join(temp.dir, 'split.log');
      await connectEchoWithRecorder(logPath);
      const chunk = Buffer.from(`${'x'.repeat(512)}\n`, 'utf8');
      for (let index = 0; index < 4; index += 1) {
        harness.service.getConnection('VCOM-ECHO')?.send(chunk);
      }
      await harness.service.disconnect(findDevice(harness.detector, 'VCOM-ECHO'));
      const secondSegment = `${logPath.slice(0, -4)}_002.log`;
      await waitFor('second segment file', () => fs.existsSync(secondSegment), 2000);
      assert.ok(fs.statSync(logPath).size >= 1024, 'first segment should hold at least maxBytes');
    } finally {
      await config.update('logMaxFileSize', undefined, vscode.ConfigurationTarget.Global);
      temp.dispose();
    }
  });

  it('#13 prefixes lines with a millisecond timestamp (logTimestampEnabled)', async () => {
    const temp = withTempDir();
    const config = vscode.workspace.getConfiguration('serialPortTerminal');
    await config.update('logTimestampEnabled', true, vscode.ConfigurationTarget.Global);
    try {
      const logPath = path.join(temp.dir, 'ts.log');
      await connectEchoWithRecorder(logPath);
      harness.service.getConnection('VCOM-ECHO')?.send(Buffer.from('stamped line\n'));
      await harness.service.disconnect(findDevice(harness.detector, 'VCOM-ECHO'));
      // 默认时间戳格式 [HH:mm:ss.SSS]（doc/SerialPortLogRecorder设计.md）
      await waitFor('timestamped content', () => /\[\d{2}:\d{2}:\d{2}\.\d{3}\] stamped line/.test(safeRead(logPath)), 2000);
    } finally {
      await config.update('logTimestampEnabled', undefined, vscode.ConfigurationTarget.Global);
      temp.dispose();
    }
  });

  it('#14 flushes the trailing half-line on close', async () => {
    const temp = withTempDir();
    try {
      const logPath = path.join(temp.dir, 'half.log');
      await connectEchoWithRecorder(logPath);
      harness.service.getConnection('VCOM-ECHO')?.send(Buffer.from('trailing half without newline'));
      await harness.service.disconnect(findDevice(harness.detector, 'VCOM-ECHO'));
      await waitFor('half-line flushed on close', () => safeRead(logPath).includes('trailing half without newline'), 2000);
    } finally {
      temp.dispose();
    }
  });

  function safeRead(logPath: string): string {
    try {
      return fs.readFileSync(logPath, 'utf8');
    } catch {
      return '';
    }
  }
});
