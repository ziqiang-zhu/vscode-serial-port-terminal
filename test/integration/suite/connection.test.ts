import assert from 'node:assert/strict';
import { after, describe, it } from 'mocha';

import { createHarness, findDevice, RecordingConsumer, waitFor, type TestHarness } from './helpers';

// 连接生命周期契约（doc/Test/开发测试体系规划.md §6.10 #2–#9）：
// 状态事件序列、断开单一入口、重复 connect 守卫、离线 connect 回退、
// 拔出自动断开（真实销毁链）、Consumer 清零自动关闭。真实异步，无 mock.timers。
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
});
