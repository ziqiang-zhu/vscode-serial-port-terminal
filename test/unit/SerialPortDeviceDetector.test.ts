import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';

import { SerialPortHal, SerialPortInfo, SerialPortOpenOptions } from '../../src/hal/SerialPortHal';
import { SerialPortDeviceDetector } from '../../src/SerialPortDeviceDetector/SerialPortDeviceDetector';

// 契约（doc/Test/开发测试体系.md §6.11）：扫描失败提示去重——轮询扫描
// （scan(isPolling = true)）连续失败仅首次弹出错误提示，成功后复位、再遇失败
// 重新提示；手动刷新 / 初始扫描（缺省）始终提示。FakeHal 控制 listDevices 成败；
// 提示经模块桩的记录器（__shownErrorMessages）断言弹出次数（桩跨用例共享，
// 各用例以进入时快照做增量断言，不依赖执行顺序）。

const stub = vscode as unknown as {
  __shownErrorMessages(): string[];
};

function makeHal(listShouldFail: () => boolean): SerialPortHal {
  return {
    listDevices: () =>
      listShouldFail()
        ? Promise.reject(new Error('listing exploded'))
        : Promise.resolve<SerialPortInfo[]>([{ path: 'COM3' }]),
    openPort: (_options: SerialPortOpenOptions) => Promise.reject(new Error('not used')),
  };
}

function createDetector(hal: SerialPortHal): SerialPortDeviceDetector {
  return new SerialPortDeviceDetector(hal, { subscriptions: [] } as unknown as vscode.ExtensionContext);
}

describe('SerialPortDeviceDetector（扫描失败提示去重）', () => {
  it('#1 notifies once on the first polling scan failure', async () => {
    const before = stub.__shownErrorMessages().length;
    const detector = createDetector(makeHal(() => true));
    await detector.scan(true);
    assert.equal(stub.__shownErrorMessages().length, before + 1);
    detector.dispose();
  });

  it('#2 keeps notifying exactly once across consecutive polling failures', async () => {
    const before = stub.__shownErrorMessages().length;
    const detector = createDetector(makeHal(() => true));
    await detector.scan(true);
    await detector.scan(true);
    await detector.scan(true);
    assert.equal(stub.__shownErrorMessages().length, before + 1);
    detector.dispose();
  });

  it('#3 resets the dedupe after a successful scan', async () => {
    let fail = true;
    const before = stub.__shownErrorMessages().length;
    const detector = createDetector(makeHal(() => fail));
    await detector.scan(true); // 首次失败 → 提示
    fail = false;
    await detector.scan(true); // 成功 → 复位
    fail = true;
    await detector.scan(true); // 再失败 → 重新提示
    assert.equal(stub.__shownErrorMessages().length, before + 2);
    detector.dispose();
  });

  it('#4 still notifies on a manual scan within a failing episode', async () => {
    const before = stub.__shownErrorMessages().length;
    const detector = createDetector(makeHal(() => true));
    await detector.scan(true); // 轮询首次失败 → 提示（进入去重轮次）
    await detector.scan(true); // 轮询连续失败 → 去重
    await detector.scan(); // 手动扫描失败 → 始终提示
    assert.equal(stub.__shownErrorMessages().length, before + 2);
    detector.dispose();
  });

  it('#5 always notifies on a manual scan failure (baseline)', async () => {
    const before = stub.__shownErrorMessages().length;
    const detector = createDetector(makeHal(() => true));
    await detector.scan();
    await detector.scan();
    assert.equal(stub.__shownErrorMessages().length, before + 2);
    detector.dispose();
  });
});
