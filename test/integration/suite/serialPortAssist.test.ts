import assert from 'node:assert/strict';
import { after, describe, it } from 'mocha';
import * as vscode from 'vscode';

import { SerialPortAssist } from '../../../src/SerialPortConsumer/SerialPortAssist/SerialPortAssist';
import { SerialPortConsumerMode } from '../../../src/SerialPortConnection/SerialPortConnectionService';
import { RecordingConsumer, createHarness, findDevice, waitFor, type TestHarness } from './helpers';

// 串口助手连接模式契约（doc/ConsumerDesign/SerialPortAssist设计.md §3/§4/§12）：
// connect 第 4 参 mode 选型主 Consumer（缺省 terminal 向后兼容）；assist 模式下
// RX 经 AssistBuffer 可诊断（snapshotEntries，rx/tx 双向）；断开收尾后可重连
//（新实例、新缓冲）。面板 UI 交互（按钮/滚动/横幅）归人工验证，本文件只覆盖
// Consumer 生命周期与数据面；面板在 after 钩子统一关闭编辑器回收。
describe('串口助手连接模式（自装配）', () => {
  let harness: TestHarness;
  const instances: SerialPortAssist[] = [];
  const factoryModes: SerialPortConsumerMode[] = [];

  before(async () => {
    harness = createHarness(mode => {
      factoryModes.push(mode);
      if (mode === 'assist') {
        const assist = new SerialPortAssist();
        instances.push(assist);
        return assist;
      }
      // terminal 分支以记录型替身承载（真实 Terminal 的 UI 面归人工验证；
      // 默认模式的类型兼容性由替身工厂同样成立证明）。
      return new RecordingConsumer('terminal-stub');
    });
    await harness.detector.scan();
  });

  after(async () => {
    harness.detector.dispose();
    // 冻结保留的 Assist 面板（断开不销毁视图）统一回收，避免测试宿主标签页堆积。
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('#1 connects in assist mode and routes RX into the assist buffer', async () => {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device, undefined, undefined, 'assist');
    try {
      assert.equal(device.status, 'connected');
      assert.deepEqual(factoryModes.at(-1), 'assist');
      const connection = harness.service.getConnection('VCOM-ECHO');
      assert.ok(connection);
      assert.ok(connection.send(Buffer.from('ping')));
      const assist = instances.at(-1);
      assert.ok(assist);
      // 真实事件循环：Echo 回显经广播进入 Assist 缓冲（rx 方向，含发送内容）。
      await waitFor(
        'assist rx entry',
        () => assist.snapshotEntries().some(entry => entry.dir === 'rx' && entry.bytes.toString().includes('ping'))
      );
    } finally {
      await harness.service.disconnect(device);
    }
  });

  it('#2 defaults the mode argument to terminal (backward compatible)', async () => {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device);
    try {
      assert.equal(device.status, 'connected');
      assert.equal(factoryModes.at(-1), 'terminal');
      assert.ok(harness.service.getConnection('VCOM-ECHO'));
    } finally {
      await harness.service.disconnect(device);
    }
  });

  it('#3 reconnect in assist mode starts with a fresh buffer (old instance finalized)', async () => {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device, undefined, undefined, 'assist');
    const first = instances.at(-1);
    assert.ok(first);
    assert.ok(connectionSend(harness, 'VCOM-ECHO', 'round-1'));
    await waitFor(
      'first instance rx',
      () => first.snapshotEntries().some(entry => entry.bytes.toString().includes('round-1'))
    );
    await harness.service.disconnect(device);
    const frozenCount = first.snapshotEntries().length;
    assert.ok(frozenCount > 0);

    await harness.service.connect(device, undefined, undefined, 'assist');
    try {
      const second = instances.at(-1);
      assert.ok(second && second !== first);
      assert.equal(second.snapshotEntries().length, 0);
      assert.ok(connectionSend(harness, 'VCOM-ECHO', 'round-2'));
      await waitFor(
        'second instance rx',
        () => second.snapshotEntries().some(entry => entry.bytes.toString().includes('round-2'))
      );
      // 旧实例冻结：断开后不再增长
      assert.equal(first.snapshotEntries().length, frozenCount);
    } finally {
      await harness.service.disconnect(device);
    }
  });
});

function connectionSend(harness: TestHarness, path: string, text: string): boolean {
  const connection = harness.service.getConnection(path);
  return connection ? connection.send(Buffer.from(text)) : false;
}
