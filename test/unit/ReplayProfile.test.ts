import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ReplayProfile } from '../../src/hal/SerialPortHalVirtual/ReplayProfile';
import { VirtualPortHandle } from '../../src/hal/SerialPortHalVirtual/VirtualPortHandle';
import { SerialPortHalVirtual } from '../../src/hal/SerialPortHalVirtual/SerialPortHalVirtual';

// 回放画像契约（doc/Test/开发测试体系规划.md §6.7 / doc/Hal/SerialPortHalVirtual规划.md
// §4.4、§10.3）：速率 = 行/秒（100ms 节拍批发、余数累进，ms 基整数规避浮点漂移）；
// 文件打开时读取、原始字节切片（\r\n 与多字节字节级保真）；EOF 按 loop 循环 / 停止；
// 无文件或不可读 → 静默设备；主机输入忽略；close 停播。临时文件 + fs 验证，mock.timers 控时。
const makeReplay = (opts: { file?: string; rate?: number; loop?: boolean } = {}): VirtualPortHandle =>
  new VirtualPortHandle(new ReplayProfile(opts.file, opts.rate, opts.loop), 0);
const collect = (handle: VirtualPortHandle): string[] => {
  const received: string[] = [];
  handle.onData(data => received.push(data.toString('utf8')));
  return received;
};

const withTempDir = (run: (dir: string) => void): void => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'halvirtual-p2-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// noUncheckedIndexedAccess 下取第 i 次输出（附带存在性断言）。
const at = (received: string[], index: number): string => {
  const value = received[index];
  assert.ok(value !== undefined, `missing emission at index ${index}`);
  return value;
};

const writeLines = (dir: string, name: string, lines: string[]): string => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
};

describe('Replay 注册与打开', () => {
  it('#1 registers four devices (ECHO / LINUX / UBOOT / REPLAY, all Virtual)', async () => {
    const hal = new SerialPortHalVirtual();
    const devices = await hal.listDevices();
    assert.deepEqual(devices.map(d => d.path), [
      'VCOM-ECHO',
      'VCOM-LINUX',
      'VCOM-UBOOT',
      'VCOM-REPLAY',
    ]);
    assert.ok(devices.every(d => d.manufacturer === 'Virtual'));
  });

  it('#2 opens VCOM-REPLAY like any virtual port', async () => {
    const hal = new SerialPortHalVirtual();
    const handle = await hal.openPort({ path: 'VCOM-REPLAY', baudRate: 115200 });
    assert.ok(handle instanceof VirtualPortHandle);
  });
});

describe('Replay 静默设备', () => {
  it('#3 stays silent when no file is configured', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const handle = makeReplay();
    const received = collect(handle);
    t.mock.timers.tick(2000);
    assert.deepEqual(received, []);
  });

  it('#4 stays silent when the file cannot be read', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const handle = makeReplay({ file: path.join(os.tmpdir(), 'definitely-missing-replay.log') });
    const received = collect(handle);
    t.mock.timers.tick(2000);
    assert.deepEqual(received, []);
  });
});

describe('Replay 播放管线', () => {
  it('#5 starts playback on first subscription and is clock-driven', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    withTempDir(dir => {
      const file = writeLines(dir, 'a.log', ['l1', 'l2', 'l3']);
      const handle = makeReplay({ file, rate: 10 });
      const received = collect(handle);
      assert.deepEqual(received, []); // 未推进时钟：无输出
      t.mock.timers.tick(100);
      assert.deepEqual(received, ['l1\n']);
      t.mock.timers.tick(100);
      assert.deepEqual(received, ['l1\n', 'l2\n']);
      t.mock.timers.tick(100);
      assert.deepEqual(received, ['l1\n', 'l2\n', 'l3\n']);
    });
  });

  it('#6 paces at exactly rate lines per second (carry accumulator)', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    withTempDir(dir => {
      const file = writeLines(dir, 'slow.log', ['s1', 's2']);
      const handle = makeReplay({ file, rate: 1 }); // 1 行/秒 → 每 10 个 100ms 节拍 1 行
      const received = collect(handle);
      t.mock.timers.tick(900);
      assert.deepEqual(received, []); // 900ms：预算不足 1 行
      t.mock.timers.tick(100);
      assert.deepEqual(received, ['s1\n']); // 1000ms：第 1 行
      t.mock.timers.tick(1000);
      assert.deepEqual(received, ['s1\n', 's2\n']); // 2000ms：第 2 行
    });
  });

  it('#7 preserves bytes exactly: CRLF endings and multibyte content', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    withTempDir(dir => {
      const file = path.join(dir, 'bytes.log');
      const raw = Buffer.from('启\r\n动\r\nend', 'utf8'); // 末行无换行
      fs.writeFileSync(file, raw);
      const handle = makeReplay({ file, rate: 10 });
      const received = collect(handle);
      t.mock.timers.tick(300);
      assert.deepEqual(received, ['启\r\n', '动\r\n', 'end']);
      assert.ok(Buffer.from(received.join(''), 'utf8').equals(raw)); // 字节级一致
    });
  });

  it('#8 batches high rates into larger chunks (10 lines per tick at rate=100)', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    withTempDir(dir => {
      const file = writeLines(dir, 'big.log', Array.from({ length: 30 }, (_, i) => `line${i + 1}`));
      const handle = makeReplay({ file, rate: 100 });
      const received = collect(handle);
      t.mock.timers.tick(300);
      assert.equal(received.length, 3); // 每节拍一批 10 行
      for (const batch of received) {
        assert.equal(batch.split('\n').filter(Boolean).length, 10);
      }
      assert.match(at(received, 0), /^line1\n/);
      assert.match(at(received, 2), /line30\n$/);
    });
  });

  it('#9 stops at EOF without loop', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    withTempDir(dir => {
      const file = writeLines(dir, 'eof.log', Array.from({ length: 25 }, (_, i) => `e${i + 1}`));
      const handle = makeReplay({ file, rate: 100 });
      const received = collect(handle);
      t.mock.timers.tick(300); // 10 + 10 + 5 行，EOF
      const total = received.join('').split('\n').filter(Boolean).length;
      assert.equal(total, 25);
      t.mock.timers.tick(1000); // EOF 后：无输出、不崩
      assert.equal(received.length, 3);
    });
  });

  it('#10 loops from the beginning after EOF when loop is on', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    withTempDir(dir => {
      const file = writeLines(dir, 'loop.log', ['c1', 'c2', 'c3']);
      const handle = makeReplay({ file, rate: 10, loop: true });
      const received = collect(handle);
      t.mock.timers.tick(300);
      assert.deepEqual(received, ['c1\n', 'c2\n', 'c3\n']);
      t.mock.timers.tick(300);
      assert.deepEqual(received.slice(3), ['c1\n', 'c2\n', 'c3\n']); // 从头再来
    });
  });

  it('#11 stops playback on close and close is repeatable', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    withTempDir(dir => {
      const file = writeLines(dir, 'close.log', Array.from({ length: 100 }, (_, i) => `k${i + 1}`));
      const handle = makeReplay({ file, rate: 10 });
      const received = collect(handle);
      t.mock.timers.tick(100);
      assert.equal(received.length, 1);
      void handle.close();
      t.mock.timers.tick(2000); // 定时器已清理：无输出
      assert.equal(received.length, 1);
      void handle.close(); // 重复 close 安全
    });
  });

  it('#12 ignores host input entirely', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    withTempDir(dir => {
      const file = writeLines(dir, 'in.log', ['i1', 'i2']);
      const handle = makeReplay({ file, rate: 10 });
      const received = collect(handle);
      handle.write(Buffer.from('hello'));
      handle.write(Buffer.from('more\r'));
      t.mock.timers.tick(200);
      assert.deepEqual(received, ['i1\n', 'i2\n']); // 无回显、无输入引发的内容
    });
  });

  it('#13 reads the file at open time (new content picked up on reconnect)', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    withTempDir(dir => {
      const file = writeLines(dir, 'live.log', ['old\n']);
      const profile = new ReplayProfile(file, 10, false);
      fs.writeFileSync(file, 'new\n', 'utf8'); // 构造后、打开前更新内容
      const handle = new VirtualPortHandle(profile, 0);
      const received = collect(handle);
      t.mock.timers.tick(100);
      assert.deepEqual(received, ['new\n']);
    });
  });
});
