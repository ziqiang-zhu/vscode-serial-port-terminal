import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';

import {
  AgentBridgeCancelledError,
  SerialPortAgentBridge,
} from '../../src/SerialPortConsumer/SerialPortAgentBridge/SerialPortAgentBridge';

// 契约（doc/Test/开发测试体系.md §6.15 / AgentBridge设计 §5）：
// listen 挂起被取消（listening 送达前 onClosed → server 'close' 事件）→ reject
// AgentBridgeCancelledError（无永久 pending、无实例泄漏）；正常 listen 解析实际端口，
// settled 后的 close 事件被忽略（无 unhandled rejection）；端口占用 reject 非取消
// 错误（该类仍走 startBridge 的 toast 路径）。AgentBridge 及其依赖链不调用任何
// vscode API——真实 net 即可确定性验证；port 0 用临时端口避冲突。

describe('SerialPortAgentBridge（listen 取消）', () => {
  it('#1 resolves the actual port on a normal listen', async () => {
    const bridge = new SerialPortAgentBridge('127.0.0.1', 0);
    const address = await bridge.listen();
    assert.equal(address.host, '127.0.0.1');
    assert.ok(address.port > 0);
    // settled 后再 onClosed（stopBridge 路径）：'close' 事件被忽略，无 unhandled rejection
    bridge.onClosed();
    await new Promise(resolve => setTimeout(resolve, 20));
  });

  it('#2 rejects with the cancellation error when closed before listening', async () => {
    const bridge = new SerialPortAgentBridge('127.0.0.1', 0);
    const pending = bridge.listen();
    bridge.onClosed(); // listening 送达前关闭（启动期间点了停止 / 断开收尾）
    await assert.rejects(() => pending, error => error instanceof AgentBridgeCancelledError);
  });

  it('#3 rejects a non-cancellation error when the port is taken', async () => {
    const first = new SerialPortAgentBridge('127.0.0.1', 0);
    const address = await first.listen();
    const second = new SerialPortAgentBridge('127.0.0.1', address.port); // 占用同一端口
    try {
      await assert.rejects(() => second.listen(), error => !(error instanceof AgentBridgeCancelledError));
    } finally {
      first.onClosed();
    }
  });
});

// 客户端数回调契约（AgentBridge设计 §4/§7）：接入/断开后以当前在线数触发；
// 构造不传回调时事件静默（可选参兼容）；onClosed 收尾销毁 socket 不触发
// （destroy 后迟到的 'close' 事件不回调）。客户端 'connect' 事件可能早于服务端
// accept 被处理（Windows IOCP 时序坑，同集成 helpers 教训）——轮询等待回调事件，
// 不做事件循环顺序假设。
describe('SerialPortAgentBridge（客户端数回调）', () => {
  const makeBridge = () => {
    const counts: number[] = [];
    const bridge = new SerialPortAgentBridge('127.0.0.1', 0, false, true, count => counts.push(count));
    const waitFor = (want: number): Promise<number> =>
      new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          const hit = counts.length >= want ? counts[want - 1] : undefined;
          if (hit !== undefined) {
            resolve(hit);
            return;
          }
          if (Date.now() - start > 2000) {
            reject(new Error(`timeout waiting for ${want} client-count events, got ${counts.length}`));
            return;
          }
          setTimeout(tick, 10);
        };
        tick();
      });
    return { bridge, counts, waitFor };
  };

  const connectClient = (port: number): Promise<net.Socket> =>
    new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => resolve(socket));
      socket.once('error', reject);
    });

  it('#4 reports the client count on connect and disconnect', async () => {
    const { bridge, waitFor } = makeBridge();
    try {
      const address = await bridge.listen();
      const socket = await connectClient(address.port);
      assert.equal(await waitFor(1), 1);
      socket.end();
      assert.equal(await waitFor(2), 0);
    } finally {
      bridge.onClosed();
    }
  });

  it('#5 counts multiple clients accurately', async () => {
    const { bridge, waitFor } = makeBridge();
    try {
      const address = await bridge.listen();
      const first = await connectClient(address.port);
      const second = await connectClient(address.port);
      assert.equal(await waitFor(2), 2);
      first.destroy();
      assert.equal(await waitFor(3), 1);
      second.destroy();
      assert.equal(await waitFor(4), 0);
    } finally {
      bridge.onClosed();
    }
  });

  it('#6 stays silent when no callback is provided', async () => {
    const bridge = new SerialPortAgentBridge('127.0.0.1', 0);
    try {
      const address = await bridge.listen();
      const socket = await connectClient(address.port);
      await new Promise(resolve => setTimeout(resolve, 30));
      socket.destroy();
      await new Promise(resolve => setTimeout(resolve, 30));
    } finally {
      bridge.onClosed();
    }
  });

  it('#7 stays silent during teardown (late close events do not notify)', async () => {
    const { bridge, counts, waitFor } = makeBridge();
    const address = await bridge.listen();
    const socket = await connectClient(address.port);
    await waitFor(1); // 接入事件已到达
    bridge.onClosed(); // 收尾销毁 socket → 各 socket 'close' 事件迟到
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(counts.length, 1, 'teardown must not emit extra client-count events');
    socket.destroy();
  });
});
