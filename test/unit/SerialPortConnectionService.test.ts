import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';

import { SerialPortHal, SerialPortHandle, SerialPortInfo, SerialPortOpenOptions } from '../../src/hal/SerialPortHal';
import { SerialPortDeviceDetector } from '../../src/SerialPortDeviceDetector/SerialPortDeviceDetector';
import { SerialPortConnectionService } from '../../src/SerialPortConnection/SerialPortConnectionService';

// 契约（doc/Test/开发测试体系.md §6.13）：打开挂起超时——定时器先到即回滚
// disconnected 并提示「连接超时」恰一次，迟到的打开结果被兜底关闭（无人持有），
// 超时后可重连。受控 FakeHal（openPort 挂起 / 放行可控）+ 注入短超时做确定性验证；
// 提示经模块桩记录器（__shownErrorMessages）断言（快照增量）。

const stub = vscode as unknown as {
  __shownErrorMessages(): string[];
};

interface DeferredHandle extends SerialPortHandle {
  closed: boolean;
}

const makeTrackedHandle = (): DeferredHandle => {
  const handle: DeferredHandle = {
    closed: false,
    close: async () => {
      handle.closed = true;
    },
    write: () => true,
    onDrain: () => {},
    onData: () => {},
    onError: () => {},
  };
  return handle;
};

// openPort 挂起直到 release：release(handle) 以调用方句柄放行（供迟到兜底断言）。
function makeDeferredHal(): {
  hal: SerialPortHal;
  release: (handle?: SerialPortHandle) => void;
} {
  let release: ((handle?: SerialPortHandle) => void) | undefined;
  const hal: SerialPortHal = {
    listDevices: () => Promise.resolve<SerialPortInfo[]>([{ path: 'COM3' }]),
    openPort: (_options: SerialPortOpenOptions) =>
      new Promise<SerialPortHandle>(resolve => {
        release = (handle?: SerialPortHandle) => resolve(handle ?? makeTrackedHandle());
      }),
  };
  return { hal, release: (handle?: SerialPortHandle) => release?.(handle) };
}

async function waitForHandleClosed(handle: DeferredHandle): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!handle.closed) {
    if (Date.now() > deadline) {
      throw new Error('waitFor timeout: handle closed');
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function createService(hal: SerialPortHal, connectTimeoutMs: number) {
  const subscriptions: { dispose(): unknown }[] = [];
  const context = { subscriptions } as unknown as vscode.ExtensionContext;
  const detector = new SerialPortDeviceDetector(hal, context);
  const service = new SerialPortConnectionService(hal, detector, context, undefined, connectTimeoutMs);
  const dispose = () => {
    detector.dispose();
    for (const subscription of subscriptions) {
      subscription.dispose();
    }
  };
  return { detector, service, dispose };
}

function findDevice(detector: SerialPortDeviceDetector) {
  const device = detector.getDevices().find(item => item.path === 'COM3');
  if (!device) {
    throw new Error('device not found after scan: COM3');
  }
  return device;
}

describe('SerialPortConnectionService（打开挂起超时）', () => {
  it('#1 rolls back to disconnected and notifies the timeout once', async () => {
    const errorBefore = stub.__shownErrorMessages().length;
    const { hal, release } = makeDeferredHal();
    const { detector, service, dispose } = createService(hal, 50);
    try {
      await detector.scan();
      const device = findDevice(detector);
      await service.connect(device);
      assert.equal(device.status, 'disconnected');
      assert.equal(service.getConnection('COM3'), undefined);
      const errors = stub.__shownErrorMessages();
      assert.equal(errors.length, errorBefore + 1);
      assert.match(errors[errors.length - 1] ?? '', /Connection timed out/);
    } finally {
      release?.(); // 放行悬挂的 openPort，避免遗留 pending promise
      dispose();
    }
  });

  it('#2 closes a late-resolving handle after the timeout has won', async () => {
    const { hal, release } = makeDeferredHal();
    const { detector, service, dispose } = createService(hal, 50);
    try {
      await detector.scan();
      const device = findDevice(detector);
      await service.connect(device); // 超时：状态已回滚
      assert.equal(device.status, 'disconnected');
      const late = makeTrackedHandle();
      release(late); // 迟到的打开成功 → 无人持有 → 兜底关闭
      await waitForHandleClosed(late);
      assert.equal(service.getConnection('COM3'), undefined);
    } finally {
      dispose();
    }
  });

  it('#3 allows a retry after the timeout', async () => {
    let hang = true;
    const hal: SerialPortHal = {
      listDevices: () => Promise.resolve<SerialPortInfo[]>([{ path: 'COM3' }]),
      openPort: (_options: SerialPortOpenOptions) =>
        hang ? new Promise<SerialPortHandle>(() => {}) : Promise.resolve(makeTrackedHandle()),
    };
    const { detector, service, dispose } = createService(hal, 50);
    try {
      await detector.scan();
      const device = findDevice(detector);
      await service.connect(device); // 挂起 → 超时回滚
      assert.equal(device.status, 'disconnected');
      hang = false;
      await service.connect(device); // 重试 → connected
      assert.equal(device.status, 'connected');
      assert.ok(service.getConnection('COM3'));
    } finally {
      dispose();
    }
  });
});
