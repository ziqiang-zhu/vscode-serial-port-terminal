import assert from 'node:assert/strict';
import { after, describe, it } from 'mocha';

import { SerialPortAgentBridge } from '../../../src/SerialPortConsumer/SerialPortAgentBridge/SerialPortAgentBridge';
import { createHarness, findDevice, sleep, TcpTestClient, waitFor, withTempDir, type TestHarness } from './helpers';

// AgentBridge TCP 契约（doc/Test/开发测试体系规划.md §6.10 #15–#19）：
// 实际端口解析、单/多客户端收流（ANSI 剥离后）、双向透传、半行空闲刷出
//（IDLE_FLUSH_MS ≈ 200ms）、断开时客户端 socket 被销毁。
describe('AgentBridge TCP（自装配）', () => {
  let harness: TestHarness;
  let temp: ReturnType<typeof withTempDir>;

  before(async () => {
    harness = createHarness();
    await harness.detector.scan();
    temp = withTempDir(); // 占位：套件级资源预留（当前用例无文件），统一 cleanup 通道
  });

  after(() => {
    temp.dispose();
    harness.detector.dispose();
  });

  async function connectEchoWithBridge(): Promise<{ bridge: SerialPortAgentBridge; port: number }> {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device);
    const connection = harness.service.getConnection('VCOM-ECHO');
    assert.ok(connection);
    const bridge = new SerialPortAgentBridge('127.0.0.1', 0); // 端口 0 → 系统分配
    const address = await bridge.listen();
    connection.addConsumer(bridge);
    return { bridge, port: address.port };
  }

  it('#15 streams device data to a connected TCP client', async () => {
    const { port } = await connectEchoWithBridge();
    const client = new TcpTestClient(port);
    try {
      await client.connected();
      harness.service.getConnection('VCOM-ECHO')?.send(Buffer.from('hello tcp\n'));
      await waitFor('device data on client', () => client.text.includes('hello tcp'));
    } finally {
      client.dispose();
      await harness.service.disconnect(findDevice(harness.detector, 'VCOM-ECHO'));
    }
  });

  it('#16 broadcasts to multiple clients at once', async () => {
    const { port } = await connectEchoWithBridge();
    const first = new TcpTestClient(port);
    const second = new TcpTestClient(port);
    try {
      await first.connected();
      await second.connected();
      harness.service.getConnection('VCOM-ECHO')?.send(Buffer.from('broadcast\n'));
      await waitFor('first client', () => first.text.includes('broadcast'));
      await waitFor('second client', () => second.text.includes('broadcast'), 5000, () =>
        `first=${JSON.stringify(first.text)} second=${JSON.stringify(second.text)}`
      );
    } finally {
      first.dispose();
      second.dispose();
      await harness.service.disconnect(findDevice(harness.detector, 'VCOM-ECHO'));
    }
  });

  it('#17 forwards client data to the device and back', async () => {
    const { port } = await connectEchoWithBridge();
    const client = new TcpTestClient(port);
    try {
      await client.connected();
      client.write('ping from tcp\n'); // → connection.send → Echo 回显 → broadcast 回客户端
      await waitFor('roundtrip on client', () => client.text.includes('ping from tcp'));
    } finally {
      client.dispose();
      await harness.service.disconnect(findDevice(harness.detector, 'VCOM-ECHO'));
    }
  });

  it('#18 flushes a held half-line after the idle timeout', async () => {
    const { port } = await connectEchoWithBridge();
    const client = new TcpTestClient(port);
    try {
      await client.connected();
      harness.service.getConnection('VCOM-ECHO')?.send(Buffer.from('no newline here')); // 无 \n：滞留剥离器
      await waitFor('idle-flushed half-line', () => client.text.includes('no newline here'), 5000, () =>
        `client=${JSON.stringify(client.text)}`
      );
    } finally {
      client.dispose();
      await harness.service.disconnect(findDevice(harness.detector, 'VCOM-ECHO'));
    }
  });

  it('#19 destroys client sockets on disconnect', async () => {
    const { port } = await connectEchoWithBridge();
    const client = new TcpTestClient(port);
    try {
      await client.connected();
      await harness.service.disconnect(findDevice(harness.detector, 'VCOM-ECHO')); // onClosed → destroy
      await client.closed();
      assert.ok(true); // close 事件即断言（超时则 waitFor 语义由 closed() 的 Promise 承担）
    } finally {
      client.dispose();
    }
  });

  it('#20 readonly mode still streams device data but discards client bytes', async () => {
    const device = findDevice(harness.detector, 'VCOM-ECHO');
    await harness.service.connect(device);
    const connection = harness.service.getConnection('VCOM-ECHO');
    assert.ok(connection);
    const bridge = new SerialPortAgentBridge('127.0.0.1', 0, true); // 只读模式
    assert.ok(bridge.isReadonly());
    const address = await bridge.listen();
    connection.addConsumer(bridge);
    const client = new TcpTestClient(address.port);
    try {
      await client.handshaken(); // 只读桥：探针（客户端→设备回显）不可用
      // 就绪信号改为重试式：handshaken 与服务端 accept 之间存在竞态窗口，
      // 竞态期内的广播会被桥按设计丢弃——反复发送直到首包到达（accept 完成后必收敛）。
      for (let attempt = 0; attempt < 20 && !client.text.includes('device says'); attempt++) {
        connection.send(Buffer.from('device says\n'));
        await sleep(100);
      }
      await waitFor('device data on readonly client', () => client.text.includes('device says'));
      client.write('injection attempt\n'); // 反向：客户端 → 设备被丢弃（无 data handler）
      await sleep(300);
      assert.ok(!client.text.includes('injection attempt')); // 不会被回显（Echo 设备未收到）
      assert.equal(connection.send(Buffer.from('still streaming\n')), true); // 桥本身仍活着
      await waitFor('bridge alive after discarded bytes', () => client.text.includes('still streaming'));
    } finally {
      client.dispose();
      await harness.service.disconnect(device);
    }
  });
});
