import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { USE_VIRTUAL_HAL, createVirtualHal } from '../../src/hal/halSelection';

// VDC 产品化门控（doc/Hal/SerialPortHalVirtual规划.md §5/§8）：createVirtualHal
// 改为参数门控——enabled=false 返回 undefined（调用方走纯真实 HAL），enabled=true
// 构造四画像虚拟 HAL（Echo / Linux / U-Boot / Replay，manufacturer=Virtual）；
// USE_VIRTUAL_HAL 导出字面量的发射形态（exports.USE_VIRTUAL_HAL = false）是
// build.js 产物注入的锚点（split 断言恰好 1 处）——单元测试编译不注入、恒为
// false，此处断言兼作字面量被手改的绊线。vscode 桩提供 testMode.* 默认配置
// （回放文件/应答目录为空 → 未配置态，不影响构造）。

describe('halSelection（VDC 生效门控）', () => {
  it('#1 returns undefined when disabled', () => {
    assert.equal(createVirtualHal(false), undefined);
  });

  it('#2 builds the four-profile virtual HAL when enabled', async () => {
    const hal = createVirtualHal(true);
    assert.ok(hal);
    const devices = await hal.listDevices();
    assert.equal(devices.length, 4);
    for (const device of devices) {
      assert.ok(device.path.startsWith('VCOM-'), `expected VCOM- prefix, got ${device.path}`);
    }
  });

  it('#3 keeps the build-injection anchor literal false in unit-test compilation', () => {
    assert.equal(USE_VIRTUAL_HAL, false);
  });
});
