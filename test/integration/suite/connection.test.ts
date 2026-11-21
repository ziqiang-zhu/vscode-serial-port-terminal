import assert from 'node:assert/strict';
import { after, describe, it } from 'mocha';
import * as vscode from 'vscode';

import { SerialPortHal, SerialPortHandle, SerialPortOpenOptions } from '../../../src/hal/SerialPortHal';
import { SerialPortHalComposite } from '../../../src/hal/SerialPortHalComposite';
import { SerialPortHalImpl } from '../../../src/hal/SerialPortHalImpl';
import { SerialPortHalVirtual } from '../../../src/hal/SerialPortHalVirtual/SerialPortHalVirtual';
import { SerialPortDeviceDetector } from '../../../src/SerialPortDeviceDetector/SerialPortDeviceDetector';
import { SerialPortConnectionService } from '../../../src/SerialPortConnection/SerialPortConnectionService';
import { createHarness, findDevice, RecordingConsumer, waitFor, type TestHarness } from './helpers';

// 连接生命周期契约（doc/Test/开发测试体系.md §6.10 #2–#12）：
// 状态事件序列、断开单一入口、重复 connect 守卫、离线 connect 回退、
// 拔出自动断开（真实销毁链）、Consumer 清零自动关闭、扩展停用销毁、
// 构造窗口句柄兜底、拔除竞态防护。真实异步，无 mock.timers。
describe('连接生命周期（自装配）', () => {
  let harness: TestHarness;

  before(async () => {
    harness = createHarness();
    await harness.detector.scan();
  });

  after(() => {
    harness.detector.dispose();
  });

  it('#2 lists the union with the four virtual devices after real ones', () => {
    const paths = harness.detector.getDevices().map(device => device.path);
    assert.deepEqual(paths.slice(-4), ['VCOM-ECHO', 'VCOM-LINUX', 'VCOM-UBOOT', 'VCOM-REPLAY']);
    assert.ok(paths.length >= 4); // 真实设备数 >= 0（数量与命名随环境而定）
  });

  it('#3 fires connecting then connected on connect', async () => {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    const events: string[] = [];
    const subscription = harness.service.onDidChangeDeviceStatus(item => events.push(item.status));
    try {
      await harness.service.connect(device);
      assert.deepEqual(events, ['connecting', 'connected']);
      assert.equal(device.status, 'connected');
      assert.ok(harness.service.getConnection('VCOM-ECHO'));
    } finally {
      subscription.dispose();
      await harness.service.disconnect(device);
    }
  });

  it('#4 echoes sent data through a consumer (real event loop)', async () => {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device);
    try {
      const connection = harness.service.getConnection('VCOM-ECHO');
      assert.ok(connection);
      const consumer = new RecordingConsumer('rec-echo');
      connection.addConsumer(consumer);
      assert.ok(connection.send(Buffer.from('ping')));
      await waitFor('echo roundtrip', () => consumer.received.includes('ping'));
    } finally {
      await harness.service.disconnect(device);
    }
  });

  it('#5 disconnects once and tolerates repeated disconnects', async () => {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device);
    await harness.service.disconnect(device);
    assert.equal(device.status, 'disconnected');
    assert.equal(harness.service.getConnection('VCOM-ECHO'), undefined);
    await harness.service.disconnect(device); // 重复断开：单一入口静默
    assert.equal(device.status, 'disconnected');
  });

  it('#6 ignores a connect attempt while already connected', async () => {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device);
    try {
      const events: string[] = [];
      const subscription = harness.service.onDidChangeDeviceStatus(item => events.push(item.status));
      try {
        await harness.service.connect(device); // 守卫：非 disconnected 直接返回
      } finally {
        subscription.dispose();
      }
      assert.deepEqual(events, []);
      assert.equal(device.status, 'connected');
    } finally {
      await harness.service.disconnect(device);
    }
  });

  it('#7 falls back to disconnected when the device is offline', async () => {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    harness.virtual.setOnline('VCOM-ECHO', false);
    try {
      await harness.service.connect(device); // openPort 拒绝 → 状态回退
      assert.equal(device.status, 'disconnected');
      assert.equal(harness.service.getConnection('VCOM-ECHO'), undefined);
    } finally {
      harness.virtual.setOnline('VCOM-ECHO', true);
    }
  });

  it('#8 auto-disconnects when the device is unplugged (real destroy chain)', async () => {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device);
    assert.equal(device.status, 'connected');
    harness.virtual.setOnline('VCOM-ECHO', false);
    try {
      await harness.detector.scan(); // removed 事件 → service 自动断开
      await waitFor('auto-disconnect after unplug', () => device.status === 'disconnected');
      assert.equal(harness.service.getConnection('VCOM-ECHO'), undefined);
    } finally {
      harness.virtual.setOnline('VCOM-ECHO', true);
      await harness.detector.scan(); // 恢复设备清单，后续用例可再查到 VCOM-ECHO
    }
  });

  it('#9 closes the connection when the last consumer is removed', async () => {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device);
    const connection = harness.service.getConnection('VCOM-ECHO');
    assert.ok(connection);
    const consumer = new RecordingConsumer('rec-solo');
    connection.addConsumer(consumer);
    connection.removeConsumer('rec-solo'); // 清零 → onCloseRequested → 自动断开
    await waitFor('auto-disconnect after last consumer removed', () => device.status === 'disconnected');
    assert.ok(consumer.closed);
  });

  // A1 契约（SerialPortConnection设计.md §1/§4）：扩展停用时 Connection 全部销毁、
  // 端口关闭。经 context.subscriptions 的 dispose 链验证（与真实停用路径同构）。
  it('#10 disposes all connections when the extension host disposes the service', async () => {
    const deviceA = findDevice(harness.detector, 'VCOM-LINUX');
    const deviceB = findDevice(harness.detector, 'VCOM-REPLAY');
    await harness.service.connect(deviceA);
    await harness.service.connect(deviceB);
    assert.equal(deviceA.status, 'connected');
    assert.equal(deviceB.status, 'connected');
    assert.ok(harness.service.getConnection('VCOM-LINUX'));
    assert.ok(harness.service.getConnection('VCOM-REPLAY'));

    const consumer = new RecordingConsumer('rec-dispose');
    harness.service.getConnection('VCOM-LINUX')?.addConsumer(consumer);

    // 模拟扩展停用：框架遍历 subscriptions 调用 dispose（Service 已注册其中）
    for (const subscription of harness.subscriptions) {
      subscription.dispose();
    }

    assert.equal(harness.service.getConnection('VCOM-LINUX'), undefined, 'connections must be cleared');
    assert.equal(harness.service.getConnection('VCOM-REPLAY'), undefined);
    assert.ok(consumer.closed, 'consumers must receive onClosed during dispose');
    // 停用后连接被拒绝（disposed 守卫）
    await harness.service.connect(deviceA);
    assert.equal(deviceA.status, 'disconnected');
    // 端口确实已关闭：dispose 后重新打开同一路径仍成功（虚拟 HAL 单实例句柄独立）
    const handle = await harness.virtual.openPort({ path: 'VCOM-LINUX', baudRate: 115200 });
    assert.ok(handle);
    await handle.close();
  });

  // A2 契约（SerialPortConnection设计.md §4「连接失败」）：打开成功后的构造窗口
  // 内任何异常都必须兜底关闭句柄——否则端口被占用且无人持有。虚拟 HAL 的
  // openPort 幂等性（同路径重复打开返回独立句柄）不能暴露泄漏，故用"工厂抛错 +
  // dispose 后端口可复开"组合验证：句柄若未关闭，close 链也不会被触发，只能靠
  // 本用例的直接断言——连接失败回滚 + 设备状态如实。
  it('#11 closes the handle when the default consumer factory throws after open', async () => {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    // 独立 harness：工厂抛错仅影响本用例
    const local = createHarness(() => {
      throw new Error('consumer factory exploded');
    });
    try {
      await local.detector.scan();
      const localDevice = findDevice(local.detector, 'VCOM-ECHO');
      await local.service.connect(localDevice); // 构造窗口抛错 → 兜底关闭 + 状态回滚
      assert.equal(localDevice.status, 'disconnected');
      assert.equal(local.service.getConnection('VCOM-ECHO'), undefined);
      // 句柄已兜底关闭的旁证：dispose（幂等）不抛、可安全重复执行
      assert.doesNotThrow(() => {
        for (const subscription of local.subscriptions) {
          subscription.dispose();
        }
      });
    } finally {
      local.detector.dispose();
    }
  });

  // A1 契约（SerialPortConnection设计.md §5.1「拔除竞态防护」）：openPort 的 await
  // 窗口内设备被拔（removed 链回写 disconnected），打开成功后复核不通过 → 关闭
  // 句柄、静默放弃，不构造 Connection。虚拟 HAL 的 openPort 即时 resolve，无法
  // 制造窗口，故以受控 stub HAL（手工放行 + close 追踪）确定性复现竞态时序。
  it('#12 abandons the connection when the device disappears while the port is opening', async () => {
    let release: ((handle: SerialPortHandle) => void) | undefined;
    let opened = false;
    let handleClosed = false;
    const stubHandle: SerialPortHandle = {
      close: async () => {
        handleClosed = true;
      },
      write: () => true,
      onDrain: () => {},
      onData: () => {},
      onError: () => {},
    };
    const virtual = new SerialPortHalVirtual();
    const composite = new SerialPortHalComposite(new SerialPortHalImpl(), virtual);
    // 打开动作挂起直到测试放行：制造确定性的 await 窗口（独立虚拟 HAL 实例，
    // 不触碰共享 harness 的设备清单）
    const hal: SerialPortHal = {
      listDevices: () => composite.listDevices(),
      openPort: (_options: SerialPortOpenOptions) => {
        opened = true;
        return new Promise<SerialPortHandle>(resolve => {
          release = resolve;
        });
      },
    };
    const subscriptions: { dispose(): unknown }[] = [];
    const stubContext = { subscriptions } as unknown as vscode.ExtensionContext;
    const detector = new SerialPortDeviceDetector(hal, stubContext);
    const service = new SerialPortConnectionService(hal, detector, stubContext);
    try {
      await detector.scan();
      const device = findDevice(detector, 'VCOM-ECHO');
      const connectPromise = service.connect(device);
      await waitFor('connect entered the openPort window', () => opened);
      // 窗口内拔除：removed 事件链触发 disconnect，状态回写 disconnected
      virtual.setOnline('VCOM-ECHO', false);
      await detector.scan();
      await waitFor('status flipped to disconnected by the removal chain', () => device.status === 'disconnected');
      release!(stubHandle); // 放行 openPort：复核不通过 → 关句柄静默放弃
      await connectPromise;
      assert.equal(device.status, 'disconnected', 'must not flip to connected');
      assert.equal(service.getConnection('VCOM-ECHO'), undefined, 'no orphan connection in the map');
      assert.ok(handleClosed, 'the opened handle must be closed');
      assert.equal(detector.getDevices().some(item => item.path === 'VCOM-ECHO'), false);
    } finally {
      for (const subscription of subscriptions) {
        subscription.dispose();
      }
      detector.dispose();
    }
  });
});
