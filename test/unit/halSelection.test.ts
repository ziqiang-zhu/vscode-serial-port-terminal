import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { USE_VIRTUAL_HAL, createVirtualHal } from '../../src/hal/halSelection';

// VDC 产品化门控（doc/Hal/SerialPortHalVirtual规划.md §5/§8）：createVirtualHal
// 为参数门控——enabled=false 返回 undefined（调用方走纯真实 HAL），enabled=true
// 构造四画像虚拟 HAL（Echo / Linux / U-Boot / Replay，`VCOM-` 前缀）；运行参数取
// 固定默认（0ms / 100 行每秒 / 不循环 / 无回放文件）——无长期存储，控制台运行期
// 调节、重启回归默认（选择器去设置化契约）。USE_VIRTUAL_HAL 导出字面量的发射
// 形态（exports.USE_VIRTUAL_HAL = false）是 build.js 产物注入的锚点（split 断言
// 恰好 1 处）——单元测试编译不注入、恒为 false，此处断言兼作字面量被手改的绊线。
// 本模块不 import vscode（纯逻辑零桩）。

describe('halSelection（VDC 生效门控）', () => {
  it('#1 returns undefined when disabled', () => {
    assert.equal(createVirtualHal(false), undefined);
  });

  it('#2 builds the four-profile virtual HAL with default runtime parameters when enabled', async () => {
    const hal = createVirtualHal(true);
    assert.ok(hal);
    const entries = hal.getConsoleEntries();
    assert.equal(entries.length, 4);
    for (const entry of entries) {
      assert.ok(entry.path.startsWith('VCOM-'), `expected VCOM- prefix, got ${entry.path}`);
    }
    const replay = entries.find(item => item.kind === 'replay');
    assert.ok(replay);
    assert.ok(!replay.file, 'replay must start without a file (restart resets to defaults)');
  });

  it('#3 keeps the build-injection anchor literal false in unit-test compilation', () => {
    assert.equal(USE_VIRTUAL_HAL, false);
  });
});
