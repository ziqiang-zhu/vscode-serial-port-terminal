import assert from 'node:assert/strict';
import { after, describe, it } from 'mocha';

import { createHarness, findDevice, RecordingConsumer, waitFor, type TestHarness } from './helpers';

// 开机链路端到端（doc/Test/开发测试体系规划.md §6.10 #20）：
// 经 ConnectionService 连接 VCOM-UBOOT（默认 Consumer 经工厂在构造时注入——产品路径，
// 横幅经 onOpen 同步送达首个 Consumer），真实异步下验证横幅 + 倒计时到达、任意键
// 中断收束到 U-Boot 提示符（单测以 mock.timers 覆盖的链路在真实时钟下复验）。
describe('开机链路端到端（自装配）', () => {
  let harness: TestHarness;
  let consumer: RecordingConsumer | undefined;

  before(async () => {
    harness = createHarness(() => {
      const recording = new RecordingConsumer('rec-uboot');
      consumer = recording;
      return recording;
    });
    await harness.detector.scan();
  });

  after(() => {
    harness.detector.dispose();
  });

  it('#20 interrupts the autoboot countdown over a live connection', async () => {
    const device = findDevice(harness.detector, 'VCOM-UBOOT');
    await harness.service.connect(device);
    try {
      const connection = harness.service.getConnection('VCOM-UBOOT');
      assert.ok(connection);
      assert.ok(consumer, 'default consumer factory did not run');
      await waitFor(
        'banner and countdown',
        () => (consumer?.received.join('') ?? '').includes('Hit any key to stop autoboot: 2'),
        5000,
        () => `received=${JSON.stringify(consumer?.received)}`
      );
      connection.send(Buffer.from('\r')); // 任意键中断（整块消费）
      await waitFor(
        'uboot prompt after interrupt',
        () => (consumer?.received.join('') ?? '').includes('\r\n=> '),
        5000,
        () => `received=${JSON.stringify(consumer?.received)}`
      );
      // 中断后倒计时已停：不应再出现 Linux 横幅（未开机）
      assert.ok(!consumer.received.join('').includes('Welcome to Virtual Linux'));
    } finally {
      await harness.service.disconnect(device);
    }
  });
});
