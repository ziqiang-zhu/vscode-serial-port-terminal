import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SerialPortHalVirtual } from '../../src/hal/SerialPortHalVirtual/SerialPortHalVirtual';
import { VirtualPortHandle } from '../../src/hal/SerialPortHalVirtual/VirtualPortHandle';
import { EchoProfile } from '../../src/hal/SerialPortHalVirtual/EchoProfile';
import { SerialPortOpenOptions } from '../../src/hal/SerialPortHal';

// 虚拟 HAL 契约（doc/Test/开发测试体系规划.md §6.5 / doc/Hal/SerialPortHalVirtual规划.md §7、§10.1）：
// 设备枚举、参数忽略、Echo 回显与保序、responseDelay 延迟管线、close 语义、订阅口完整性。
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

describe('SerialPortHalVirtual 设备枚举与打开', () => {
  it('#1 lists exactly the registered profiles (P0: VCOM-ECHO, Virtual)', async () => {
    const hal = new SerialPortHalVirtual();
    const devices = await hal.listDevices();
    assert.equal(devices.length, 1);
    assert.equal(devices[0]?.path, 'VCOM-ECHO');
    assert.equal(devices[0]?.manufacturer, 'Virtual');
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
    const handle = new VirtualPortHandle(new EchoProfile(), 0);
    const received = collect(handle);
    handle.write(Buffer.from('now'));
    assert.deepEqual(received, ['now']);
  });

  it('#8 delivers only after the delay elapses (mock timers)', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const handle = new VirtualPortHandle(new EchoProfile(), 100);
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
    const handle = new VirtualPortHandle(new EchoProfile(), 200);
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
