import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SerialPortHal, SerialPortHandle, SerialPortInfo, SerialPortOpenOptions } from '../../src/hal/SerialPortHal';
import { SerialPortHalComposite } from '../../src/hal/SerialPortHalComposite';
import { SerialPortHalVirtual } from '../../src/hal/SerialPortHalVirtual/SerialPortHalVirtual';
import { VirtualPortHandle } from '../../src/hal/SerialPortHalVirtual/VirtualPortHandle';

// 混排路由契约（doc/Test/开发测试体系规划.md §6.9 / doc/Hal/SerialPortHalVirtual规划.md §5、§10.5）：
// listDevices 并集（真实在前、虚拟在后）；openPort 按 VCOM- 前缀路由——前缀命中走虚拟
// （含离线拒绝），其余透传真实 HAL（未知设备的明确报错由真实侧给出）；VCOMX（无连字符）
// 不命中前缀。真实侧以桩注入（构造注入接口，不依赖 serialport），虚拟侧用真实虚拟 HAL。
const realInfo = (path: string): SerialPortInfo => ({ path, manufacturer: 'RealHardware' });

// 真实 HAL 桩：枚举返回预置清单，打开仅接受清单内路径（报错语义同 SerialPortHalImpl）。
class StubRealHal implements SerialPortHal {
  constructor(private readonly devices: SerialPortInfo[]) {}

  listDevices(): Promise<SerialPortInfo[]> {
    return Promise.resolve(this.devices);
  }

  openPort(options: SerialPortOpenOptions): Promise<SerialPortHandle> {
    if (!this.devices.some(device => device.path === options.path)) {
      return Promise.reject(new Error(`Real port not found: ${options.path}`));
    }
    return Promise.resolve(new StubRealHandle());
  }
}

class StubRealHandle implements SerialPortHandle {
  close(): Promise<void> {
    return Promise.resolve();
  }

  write(_data: Buffer): boolean {
    return true;
  }

  onDrain(_listener: () => void): void {}

  onData(_listener: (data: Buffer) => void): void {}

  onError(_listener: (error: Error) => void): void {}
}

const openOptions = (path: string): SerialPortOpenOptions => ({ path, baudRate: 115200 });

const makeComposite = (): { composite: SerialPortHalComposite; virtual: SerialPortHalVirtual } => {
  const virtual = new SerialPortHalVirtual();
  const composite = new SerialPortHalComposite(new StubRealHal([realInfo('COM3'), realInfo('COM4')]), virtual);
  return { composite, virtual };
};

// noUncheckedIndexedAccess 下取第 i 次输出（附带存在性断言）。
const at = (received: string[], index: number): string => {
  const value = received[index];
  assert.ok(value !== undefined, `missing emission at index ${index}`);
  return value;
};

describe('SerialPortHalComposite 混排路由（P4）', () => {
  it('#13 lists the union of real and virtual devices, real first', async () => {
    const { composite } = makeComposite();
    const devices = await composite.listDevices();
    assert.deepEqual(devices.map(d => d.path), [
      'COM3',
      'COM4',
      'VCOM-ECHO',
      'VCOM-LINUX',
      'VCOM-UBOOT',
      'VCOM-REPLAY',
    ]);
  });

  it('#14 routes VCOM- paths to the virtual HAL', async () => {
    const { composite } = makeComposite();
    const handle = (await composite.openPort(openOptions('VCOM-ECHO'))) as VirtualPortHandle;
    assert.ok(handle instanceof VirtualPortHandle);
    const received: string[] = [];
    handle.onData(data => received.push(data.toString('utf8')));
    handle.write(Buffer.from('ping'));
    assert.equal(at(received, 0), 'ping'); // 虚拟 Echo 正常回显
  });

  it('#15 routes non-prefixed paths to the real HAL', async () => {
    const { composite } = makeComposite();
    const handle = await composite.openPort(openOptions('COM3'));
    assert.ok(handle instanceof StubRealHandle);
  });

  it('#16 rejects an offline virtual path with the virtual-side reason', async () => {
    const { composite, virtual } = makeComposite();
    virtual.setOnline('VCOM-ECHO', false);
    await assert.rejects(() => composite.openPort(openOptions('VCOM-ECHO')), /Virtual port offline/);
  });

  it('#17 passes unknown real paths through so the real side reports the reason', async () => {
    const { composite } = makeComposite();
    await assert.rejects(() => composite.openPort(openOptions('COM9')), /Real port not found: COM9/);
  });

  it('#18 keeps the prefix boundary strict: VCOMX is not a virtual path', async () => {
    const { composite } = makeComposite();
    await assert.rejects(() => composite.openPort(openOptions('VCOMX')), /Real port not found: VCOMX/);
  });
});
