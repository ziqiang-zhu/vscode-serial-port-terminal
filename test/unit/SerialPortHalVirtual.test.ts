import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SerialPortHalVirtual } from '../../src/hal/SerialPortHalVirtual/SerialPortHalVirtual';
import { VirtualPortHandle } from '../../src/hal/SerialPortHalVirtual/VirtualPortHandle';
import { EchoProfile } from '../../src/hal/SerialPortHalVirtual/EchoProfile';
import { LinuxShellProfile } from '../../src/hal/SerialPortHalVirtual/LinuxShellProfile';
import { ReplayProfile } from '../../src/hal/SerialPortHalVirtual/ReplayProfile';
import { SerialPortOpenOptions } from '../../src/hal/SerialPortHal';

// 虚拟 HAL 契约（doc/Test/开发测试体系规划.md §6.5 / doc/Hal/SerialPortHalVirtual规划.md §7、§10.1）：
// 设备枚举、参数忽略、Echo 回显与保序、responseDelay 延迟管线、close 语义、订阅口完整性。
// 控制面契约（§6.8 / 规划 §7.2、§8、§10.4）：inject / 在线拔出 / 背压排队与 drain / live 调整。
// 纯逻辑模块（无 vscode / 第三方依赖），延迟经 node:test 的 mock.timers 控时。
const openOptions = (overrides: Partial<SerialPortOpenOptions> = {}): SerialPortOpenOptions => ({
  path: 'VCOM-ECHO',
  baudRate: 115200,
  ...overrides,
});

const collect = (handle: VirtualPortHandle): string[] => {
  const received: string[] = [];
  handle.onData(data => received.push(data.toString('utf-8')));
  return received;
};

// noUncheckedIndexedAccess 下取第 i 次输出（附带存在性断言）。
const at = (received: string[], index: number): string => {
  const value = received[index];
  assert.ok(value !== undefined, `missing emission at index ${index}`);
  return value;
};

// 控制面用例的临时目录：用后整删。回调可为异步，必须等待其完成后再清理——
// 否则 finally 在回调首个 await 挂起点即执行，提前删除应答文件，测试体内的读取必然 ENOENT。
const withTempDir = async (run: (dir: string) => Promise<void> | void): Promise<void> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'halvirtual-p3-'));
  try {
    await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('SerialPortHalVirtual 设备枚举与打开', () => {
  it('#1 lists exactly the registered profiles (all four, Virtual)', async () => {
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

  it('#2 opens with minimal and full parameter sets', async () => {
    const hal = new SerialPortHalVirtual();
    const minimal = (await hal.openPort(openOptions())) as VirtualPortHandle;
    const full = (await hal.openPort(
      openOptions({ dataBits: 8, parity: 'even', stopBits: 2, rtscts: true })
    )) as VirtualPortHandle;
    assert.ok(minimal instanceof VirtualPortHandle);
    assert.ok(full instanceof VirtualPortHandle);
  });

  it('#3 ignores parameters and rejects unknown paths with a clear reason', async () => {
    const hal = new SerialPortHalVirtual();
    const handle = (await hal.openPort(openOptions({ baudRate: 9600 }))) as VirtualPortHandle;
    const received = collect(handle);
    handle.write(Buffer.from('x'));
    assert.deepEqual(received, ['x']); // 波特率不同，行为无差
    await assert.rejects(
      () => hal.openPort(openOptions({ path: 'VCOM-MISSING' })),
      /Virtual port not found/
    );
  });
});

describe('VirtualPortHandle 回显与延迟管线', () => {
  it('#4 write always returns true (P0 backpressure always open)', async () => {
    const hal = new SerialPortHalVirtual();
    const handle = (await hal.openPort(openOptions())) as VirtualPortHandle;
    assert.equal(handle.write(Buffer.from('a')), true);
  });

  it('#5 echoes input back with zero delay (synchronous)', async () => {
    const hal = new SerialPortHalVirtual();
    const handle = (await hal.openPort(openOptions())) as VirtualPortHandle;
    const received = collect(handle);
    handle.write(Buffer.from('abc'));
    assert.deepEqual(received, ['abc']);
  });

  it('#6 preserves write order across multiple writes', async () => {
    const hal = new SerialPortHalVirtual();
    const handle = (await hal.openPort(openOptions())) as VirtualPortHandle;
    const received = collect(handle);
    handle.write(Buffer.from('a'));
    handle.write(Buffer.from('b'));
    handle.write(Buffer.from('c'));
    assert.deepEqual(received, ['a', 'b', 'c']);
  });

  it('#7 delivers synchronously when responseDelay is zero', () => {
    const handle = new VirtualPortHandle(new EchoProfile(), { online: true, delayMs: 0, backpressure: false });
    const received = collect(handle);
    handle.write(Buffer.from('now'));
    assert.deepEqual(received, ['now']);
  });

  it('#8 delivers only after the delay elapses (mock timers)', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const handle = new VirtualPortHandle(new EchoProfile(), { online: true, delayMs: 100, backpressure: false });
    const received = collect(handle);
    handle.write(Buffer.from('late'));
    assert.deepEqual(received, []);
    t.mock.timers.tick(50);
    assert.deepEqual(received, []);
    t.mock.timers.tick(50);
    assert.deepEqual(received, ['late']);
  });

  it('#9 stays silent after close (write produces no echo)', async () => {
    const hal = new SerialPortHalVirtual();
    const handle = (await hal.openPort(openOptions())) as VirtualPortHandle;
    const received = collect(handle);
    await handle.close();
    assert.equal(handle.write(Buffer.from('gone')), true);
    assert.deepEqual(received, []);
  });

  it('#10 clears pending delay timers on close; close is repeatable', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const handle = new VirtualPortHandle(new EchoProfile(), { online: true, delayMs: 200, backpressure: false });
    const received = collect(handle);
    handle.write(Buffer.from('dropped'));
    await handle.close();
    t.mock.timers.tick(300); // 定时器已被清理：推进时钟不产生输出
    assert.deepEqual(received, []);
    await handle.close(); // 重复 close 安全
  });

  it('#11 exposes the full subscription surface (onData/onError/onDrain)', async () => {
    const hal = new SerialPortHalVirtual();
    const handle = (await hal.openPort(openOptions())) as VirtualPortHandle;
    assert.doesNotThrow(() => handle.onData(() => {}));
    assert.doesNotThrow(() => handle.onError(() => {}));
    assert.doesNotThrow(() => handle.onDrain(() => {}));
    await handle.close();
  });
});

// 控制面契约（doc/Test/开发测试体系规划.md §6.8 / doc/Hal/SerialPortHalVirtual规划.md §7.2、§8、§10.4）：
// inject / 在线拔出 / 背压排队与 drain / live 调整。注意拔出仅影响 listDevices 可见性
// 与 openPort 可达性——连接销毁经 Detector removed 事件链，属上层职责。
describe('SerialPortHalVirtual 控制面（P3）', () => {
  it('#12 inject delivers device-side data to open-port subscribers', async () => {
    const hal = new SerialPortHalVirtual();
    const handle = (await hal.openPort(openOptions())) as VirtualPortHandle;
    const received = collect(handle);
    hal.inject('VCOM-ECHO', Buffer.from('device says hi'));
    assert.deepEqual(received, ['device says hi']);
  });

  it('#13 inject without an open port is a silent drop', () => {
    const hal = new SerialPortHalVirtual();
    assert.doesNotThrow(() => hal.inject('VCOM-ECHO', Buffer.from('nobody listening')));
  });

  it('#14 setOnline(false) removes the device from listDevices', async () => {
    const hal = new SerialPortHalVirtual();
    hal.setOnline('VCOM-ECHO', false);
    const devices = await hal.listDevices();
    assert.deepEqual(devices.map(d => d.path), ['VCOM-LINUX', 'VCOM-UBOOT', 'VCOM-REPLAY']);
  });

  it('#15 openPort rejects an offline device with a clear reason', async () => {
    const hal = new SerialPortHalVirtual();
    hal.setOnline('VCOM-ECHO', false);
    await assert.rejects(() => hal.openPort(openOptions()), /Virtual port offline/);
  });

  it('#16 setOnline(true) restores the device to listDevices', async () => {
    const hal = new SerialPortHalVirtual();
    hal.setOnline('VCOM-ECHO', false);
    hal.setOnline('VCOM-ECHO', true);
    const devices = await hal.listDevices();
    assert.ok(devices.some(d => d.path === 'VCOM-ECHO'));
  });

  it('#17 backpressure: blocked writes return false and do not echo', async () => {
    const hal = new SerialPortHalVirtual();
    const handle = (await hal.openPort(openOptions())) as VirtualPortHandle;
    const received = collect(handle);
    hal.setBackpressure('VCOM-ECHO', true);
    assert.equal(handle.write(Buffer.from('held')), false);
    assert.deepEqual(received, []);
  });

  it('#18 contract: writes queued during backpressure are delivered in order on release', async () => {
    const hal = new SerialPortHalVirtual();
    const handle = (await hal.openPort(openOptions())) as VirtualPortHandle;
    const received = collect(handle);
    hal.setBackpressure('VCOM-ECHO', true);
    handle.write(Buffer.from('a'));
    handle.write(Buffer.from('b'));
    assert.deepEqual(received, []); // 阻塞中：排队不回显
    hal.setBackpressure('VCOM-ECHO', false);
    assert.deepEqual(received, ['a', 'b']); // 放行：按序送达
  });

  it('#19 releasing backpressure fires onDrain exactly once', async () => {
    const hal = new SerialPortHalVirtual();
    const handle = (await hal.openPort(openOptions())) as VirtualPortHandle;
    let drains = 0;
    handle.onDrain(() => {
      drains += 1;
    });
    hal.setBackpressure('VCOM-ECHO', true);
    handle.write(Buffer.from('x'));
    assert.equal(drains, 0);
    hal.setBackpressure('VCOM-ECHO', false);
    assert.equal(drains, 1);
  });

  it('#20 setBackpressure for an unknown path is a silent no-op', () => {
    const hal = new SerialPortHalVirtual();
    assert.doesNotThrow(() => hal.setBackpressure('VCOM-MISSING', true));
  });

  it('#21 contract: setDelay changes latency live (mock timers)', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const hal = new SerialPortHalVirtual();
    const handle = (await hal.openPort(openOptions())) as VirtualPortHandle;
    const received = collect(handle);
    hal.setDelay('VCOM-ECHO', 100);
    handle.write(Buffer.from('late'));
    t.mock.timers.tick(50);
    assert.deepEqual(received, []);
    t.mock.timers.tick(50);
    assert.deepEqual(received, ['late']);
  });

  it('#22 contract: setRate changes lines per tick live (mock timers)', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'halvirtual-console-'));
    try {
      const file = path.join(dir, 'rate.log');
      fs.writeFileSync(file, ['r1', 'r2', 'r3', 'r4'].join('\n') + '\n', 'utf8');
      const hal = new SerialPortHalVirtual([{ profile: new ReplayProfile(file, 10, false) }]);
      const handle = (await hal.openPort({ path: 'VCOM-REPLAY', baudRate: 115200 })) as VirtualPortHandle;
      const received = collect(handle);
      t.mock.timers.tick(100);
      assert.deepEqual(received, ['r1\n']);
      hal.setRate('VCOM-REPLAY', 20);
      t.mock.timers.tick(100);
      // rate=20：每 100ms 节拍批发 2 行（单次发射，契约 §4.4 批发语义）
      assert.deepEqual(received, ['r1\n', 'r2\nr3\n']);
      t.mock.timers.tick(100);
      assert.deepEqual(received, ['r1\n', 'r2\nr3\n', 'r4\n']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('#23 contract: setLoop resumes playback after EOF (mock timers)', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'halvirtual-console-'));
    try {
      const file = path.join(dir, 'loop.log');
      fs.writeFileSync(file, ['l1', 'l2'].join('\n') + '\n', 'utf8');
      const hal = new SerialPortHalVirtual([{ profile: new ReplayProfile(file, 10, false) }]);
      const handle = (await hal.openPort({ path: 'VCOM-REPLAY', baudRate: 115200 })) as VirtualPortHandle;
      const received = collect(handle);
      t.mock.timers.tick(300);
      assert.deepEqual(received, ['l1\n', 'l2\n']); // EOF 停止
      t.mock.timers.tick(300);
      assert.equal(received.length, 2);
      hal.setLoop('VCOM-REPLAY', true);
      // setLoop(true) 从 EOF 重启；重启后第一拍把 l1/l2 合并为一次批发发射
      t.mock.timers.tick(100);
      assert.deepEqual(received, ['l1\n', 'l2\n', 'l1\nl2\n']);
      t.mock.timers.tick(200);
      assert.deepEqual(received, ['l1\n', 'l2\n', 'l1\nl2\n', 'l1\n', 'l2\n']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('#24 contract: setInteractionDir takes effect on the next command', async () => {
    await withTempDir(async dir => {
      fs.mkdirSync(path.join(dir, 'linux'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'linux', 'pwd.txt'), 'CUSTOM_ROOT\n', 'utf8');
      const hal = new SerialPortHalVirtual([{ profile: new LinuxShellProfile() }]);
      const handle = (await hal.openPort({ path: 'VCOM-LINUX', baudRate: 115200 })) as VirtualPortHandle;
      const received = collect(handle);
      handle.write(Buffer.from('pwd\r'));
      assert.match(at(received, received.length - 1), /\/root/); // 内置表
      hal.setInteractionDir('VCOM-LINUX', dir);
      handle.write(Buffer.from('pwd\r'));
      assert.match(at(received, received.length - 1), /CUSTOM_ROOT/); // 覆盖即时生效
    });
  });

  it('#25 contract: setFile arms the replay (explicit play starts it)', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'halvirtual-console-'));
    try {
      const file = path.join(dir, 'late.log');
      fs.writeFileSync(file, 'l1\nl2\n', 'utf8');
      const hal = new SerialPortHalVirtual([{ profile: new ReplayProfile() }]); // 构造不带文件
      const handle = (await hal.openPort({ path: 'VCOM-REPLAY', baudRate: 115200 })) as VirtualPortHandle;
      const received = collect(handle);
      hal.setReplayFile('VCOM-REPLAY', file); // 连接中选文件 → armed 待开始（不自动播）
      t.mock.timers.tick(500);
      assert.deepEqual(received, []);
      hal.play('VCOM-REPLAY'); // 显式开始
      t.mock.timers.tick(100);
      // rate=100：每 100ms 节拍批发 10 行 → 2 行单次发射
      assert.deepEqual(received, ['l1\nl2\n']);
      hal.setReplayFile('VCOM-REPLAY', ''); // 取消选择 → idle
      t.mock.timers.tick(300);
      assert.equal(received.length, 1);
      assert.equal(hal.getConsoleEntries().find(e => e.path === 'VCOM-REPLAY')?.file, '');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('#26 contract: pause/resume keeps position; stop returns to armed', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'halvirtual-console-'));
    try {
      const file = path.join(dir, 'five.log');
      fs.writeFileSync(file, ['p1', 'p2', 'p3', 'p4', 'p5'].join('\n') + '\n', 'utf8');
      const hal = new SerialPortHalVirtual([{ profile: new ReplayProfile(file, 10, false) }]);
      const handle = (await hal.openPort({ path: 'VCOM-REPLAY', baudRate: 115200 })) as VirtualPortHandle;
      const received = collect(handle);
      t.mock.timers.tick(300); // rate=10：每 100ms 1 行 → 前 3 行
      assert.deepEqual(received, ['p1\n', 'p2\n', 'p3\n']);
      hal.pause('VCOM-REPLAY'); // 暂停：停发但进度保留
      t.mock.timers.tick(500);
      assert.equal(received.length, 3);
      hal.play('VCOM-REPLAY'); // 继续（play 兼容 paused → 续播）
      t.mock.timers.tick(100);
      assert.deepEqual(received, ['p1\n', 'p2\n', 'p3\n', 'p4\n']);
      hal.stop('VCOM-REPLAY'); // 停止：回 armed、进度清零
      t.mock.timers.tick(500);
      assert.equal(received.length, 4);
      hal.play('VCOM-REPLAY'); // 再开始：重读文件从头播
      t.mock.timers.tick(100);
      assert.deepEqual(received.slice(4), ['p1\n']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
