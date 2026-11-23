import assert from 'node:assert/strict';
import { after, describe, it } from 'mocha';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { SerialPortAssist } from '../../../src/SerialPortConsumer/SerialPortAssist/SerialPortAssist';
import { SerialPortConsumerMode } from '../../../src/SerialPortConnection/SerialPortConnectionService';
import { RecordingConsumer, TcpTestClient, createHarness, findDevice, waitFor, withTempDir, type TestHarness } from './helpers';

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

  it('#4 records rx traffic into a .dat file with fixed-format hex lines', async () => {
    const temp = withTempDir();
    const config = vscode.workspace.getConfiguration('serialPortTerminal');
    await config.update('logDirectory', temp.dir, vscode.ConfigurationTarget.Global);
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device, undefined, undefined, 'assist');
    const assist = instances.at(-1);
    assert.ok(assist);
    try {
      assist.startDataRecording();
      assert.ok(assist.isRecording());
      assert.ok(connectionSend(harness, 'VCOM-ECHO', 'ping'));
      // 'ping' 的小写十六进制 = 70 69 6e 67（固定机器行格式）
      await waitFor(
        'dat file with rx hex line',
        () => {
          try {
            const datFile = fs.readdirSync(temp.dir).find(name => name.endsWith('.dat'));
            return datFile !== undefined && fs.readFileSync(path.join(temp.dir, datFile), 'utf8').includes(' RX 70 69 6e 67');
          } catch {
            return false;
          }
        },
        2000
      );
      assist.stopDataRecording();
      assert.equal(assist.isRecording(), false);
    } finally {
      await harness.service.disconnect(device);
      await config.update('logDirectory', undefined, vscode.ConfigurationTarget.Global);
      temp.dispose();
    }
  });

  it('#5 skips empty chunks (no file created, no lines)', async () => {
    const temp = withTempDir();
    const config = vscode.workspace.getConfiguration('serialPortTerminal');
    await config.update('logDirectory', temp.dir, vscode.ConfigurationTarget.Global);
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device, undefined, undefined, 'assist');
    const assist = instances.at(-1);
    assert.ok(assist);
    try {
      assist.startDataRecording();
      assert.ok(connectionSend(harness, 'VCOM-ECHO', ''));
      // 空 chunk：Echo 无可回显内容 → 记录器跳过 → 收尾不建文件不弹「已保存」
      await harness.service.disconnect(device);
      await waitFor('finalize settled', () => harness.service.getConnection('VCOM-ECHO') === undefined, 2000);
      assert.equal(fs.readdirSync(temp.dir).filter(name => name.endsWith('.dat')).length, 0);
    } finally {
      await config.update('logDirectory', undefined, vscode.ConfigurationTarget.Global);
      temp.dispose();
    }
  });

  it('#6 forwards bridge client bytes into the panel (tx) and the recorder', async () => {
    const temp = withTempDir();
    const config = vscode.workspace.getConfiguration('serialPortTerminal');
    await config.update('logDirectory', temp.dir, vscode.ConfigurationTarget.Global);
    // 端口 [0] = 临时端口（OS 分配），规避测试环境端口冲突；单值跳过选择器。
    await config.update('agentBridge.ports', [0], vscode.ConfigurationTarget.Global);
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device, undefined, undefined, 'assist');
    const assist = instances.at(-1);
    assert.ok(assist);
    let client: TcpTestClient | undefined;
    try {
      assist.startDataRecording();
      await assist.startBridge();
      assert.ok(assist.isBridgeActive());
      const address = assist.getBridgeAddress();
      assert.ok(address && address.startsWith('127.0.0.1:'));
      const port = Number(address.split(':')[1]);
      assert.ok(port > 0);

      client = new TcpTestClient(port);
      await client.handshaken();
      client.write('bridge-ping');
      // 出站回调 → 面板 TX 行；Echo 回显 → RX 行（双向如实，不抑制回显）
      await waitFor(
        'tx entry from bridge bytes',
        () => assist.snapshotEntries().some(entry => entry.dir === 'tx' && entry.bytes.toString().includes('bridge-ping')),
        2000
      );
      await waitFor(
        'rx echo entry in buffer',
        () => assist.snapshotEntries().some(entry => entry.dir === 'rx' && entry.bytes.toString().includes('bridge-ping')),
        2000
      );
      // 'bridge-ping' 的小写十六进制
      const hex = '62 72 69 64 67 65 2d 70 69 6e 67';
      assist.stopDataRecording();
      await waitFor(
        'dat file has tx and rx lines for the bridge bytes',
        () => {
          try {
            const datFile = fs.readdirSync(temp.dir).find(name => name.endsWith('.dat'));
            if (!datFile) {
              return false;
            }
            const text = fs.readFileSync(path.join(temp.dir, datFile), 'utf8');
            return text.includes(` TX ${hex}`) && text.includes(` RX ${hex}`);
          } catch {
            return false;
          }
        },
        2000
      );
    } finally {
      client?.dispose();
      assist.stopBridge();
      assist.stopDataRecording();
      await harness.service.disconnect(device);
      await config.update('logDirectory', undefined, vscode.ConfigurationTarget.Global);
      await config.update('agentBridge.ports', undefined, vscode.ConfigurationTarget.Global);
      temp.dispose();
    }
  });

  it('#7 interval send repeats the captured bytes and stops on disconnect', async () => {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device, undefined, undefined, 'assist');
    const assist = instances.at(-1);
    assert.ok(assist);
    try {
      // 60ms 间隔发送 'tick'（捕获于启动时刻），真实定时器循环
      assert.equal(
        assist.startIntervalSend({ mode: 'text', text: 'tick', lineEnding: 'cr', interval: 60 }),
        true
      );
      assert.ok(assist.isIntervalActive());
      await waitFor(
        'at least three tx tick entries',
        () => assist.snapshotEntries().filter(entry => entry.dir === 'tx' && entry.bytes.toString() === 'tick\r').length >= 3,
        2000
      );
      const ticksBefore = assist.snapshotEntries().filter(entry => entry.dir === 'tx').length;
      await harness.service.disconnect(device);
      // 断开自动停：冻结后 tx 计数不再增长
      await new Promise(resolve => setTimeout(resolve, 200));
      assert.equal(assist.snapshotEntries().filter(entry => entry.dir === 'tx').length, ticksBefore);
      assert.equal(assist.isIntervalActive(), false);
    } finally {
      await harness.service.disconnect(device);
    }
  });
});

function connectionSend(harness: TestHarness, path: string, text: string): boolean {
  const connection = harness.service.getConnection(path);
  return connection ? connection.send(Buffer.from(text)) : false;
}
