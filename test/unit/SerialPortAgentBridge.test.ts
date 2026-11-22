import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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
