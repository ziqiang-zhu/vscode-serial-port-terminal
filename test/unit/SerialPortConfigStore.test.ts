import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';

import { SerialPortConfigStore } from '../../src/SerialPortConfig/SerialPortConfigStore';
import { SerialConfig } from '../../src/SerialPortConfig/SerialPortQuickConfig';

// ConfigStore 契约（doc/Test/开发测试体系规划.md §6.4）：三键存储（池/引用/legacy 迁移源）、
// 引用计数归零删除、权威校验、1.4.3 构造期自动迁移（两形态并入池与引用并删旧键）、
// 变更事件按 identity 触发。
// 'vscode' 运行期由模块桩提供（EventEmitter / l10n）；Memento 经 FakeMemento 鸭子类型注入。
const KEYS = {
  legacy: 'serialPortQuickConfigs',
  pool: 'serialPortQuickConfigPool',
  refs: 'serialPortDeviceConfigRefs',
  lastUsed: 'serialPortLastUsedConfigs',
};

class FakeMemento implements vscode.Memento {
  private readonly map = new Map<string, unknown>();

  keys(): readonly string[] {
    return [...this.map.keys()];
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.map.has(key) ? (this.map.get(key) as T) : defaultValue;
  }

  async update<T>(key: string, value: T): Promise<void> {
    if (value === undefined) {
      this.map.delete(key);
    } else {
      this.map.set(key, value);
    }
  }
}

const cfg = (overrides: Partial<SerialConfig> = {}): SerialConfig => ({
  baudRate: 115200,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  flowControl: 'none',
  ...overrides,
});

const legacyConfig = (id: string, name: string): { id: string; name: string; config: SerialConfig } => ({
  id,
  name,
  config: cfg(),
});

const make = (memento: FakeMemento = new FakeMemento()) => {
  const store = new SerialPortConfigStore(memento);
  const events: string[] = [];
  store.onDidChangeConfigs(id => events.push(id));
  return { store, memento, events };
};

describe('SerialPortConfigStore 参数校验', () => {
  it('#1 rejects a non-positive or non-integer baudRate', () => {
    const { store } = make();
    assert.throws(() => store.add('dev', 'A', cfg({ baudRate: 0 })), /Invalid baud rate/);
    assert.throws(() => store.add('dev', 'B', cfg({ baudRate: -115200 })), /Invalid baud rate/);
    assert.throws(() => store.add('dev', 'C', cfg({ baudRate: 9600.5 })), /Invalid baud rate/);
  });

  it('#2 rejects dataBits outside 5/6/7/8', () => {
    const { store } = make();
    assert.throws(() => store.add('dev', 'A', cfg({ dataBits: 3 })), /Invalid data bits/);
  });

  it('#3 rejects stopBits outside 1/1.5/2', () => {
    const { store } = make();
    assert.throws(() => store.add('dev', 'A', cfg({ stopBits: 1.25 })), /Invalid stop bits/);
  });

  it('#4 rejects an unknown parity', () => {
    const { store } = make();
    assert.throws(
      () => store.add('dev', 'A', cfg({ parity: 'weird' as SerialConfig['parity'] })),
      /Invalid parity/
    );
  });

  it('#5 rejects an unknown flowControl', () => {
    const { store } = make();
    assert.throws(
      () => store.add('dev', 'A', cfg({ flowControl: 'dtr' as SerialConfig['flowControl'] })),
      /Invalid flow control/
    );
  });

  it('#6 accepts a fully valid config into the pool', () => {
    const { store } = make();
    const added = store.add('dev', 'A', cfg());
    assert.ok(added.id.length > 0);
    assert.equal(store.getGlobalConfigs('dev').length, 1);
    assert.equal(store.getAllConfigs().length, 1);
  });
});

describe('SerialPortConfigStore 名称校验', () => {
  it('#7 rejects an empty name', () => {
    const { store } = make();
    assert.throws(() => store.add('dev', '', cfg()), /cannot be empty/);
  });

  it('#8 rejects a whitespace-only name', () => {
    const { store } = make();
    assert.throws(() => store.add('dev', '   ', cfg()), /cannot be empty/);
  });

  it('#9 rejects a duplicate name on the same device', () => {
    const { store } = make();
    store.add('dev', 'A', cfg());
    assert.throws(() => store.add('dev', 'A', cfg({ baudRate: 9600 })), /already exists/);
  });

  it('#10 allows the same name on a different device', () => {
    const { store } = make();
    store.add('dev1', 'A', cfg());
    const added = store.add('dev2', 'A', cfg({ baudRate: 9600 }));
    assert.ok(added.id.length > 0);
    assert.equal(store.getGlobalConfigs('dev2').length, 1);
  });

  it('#11 excludes the renamed config itself from the name-conflict check', () => {
    const { store } = make();
    const a = store.add('dev', 'A', cfg());
    store.add('dev', 'B', cfg({ baudRate: 9600 }));
    assert.doesNotThrow(() => store.rename('dev', a.id, 'A'));
    assert.throws(() => store.rename('dev', a.id, 'B'), /already exists/);
  });
});

describe('SerialPortConfigStore 参数判重', () => {
  it('#12 rejects a second config with identical parameters', () => {
    const { store } = make();
    store.add('dev', 'A', cfg());
    assert.throws(() => store.add('dev', 'B', cfg()), /same parameters/);
  });

  it('#13 accepts different parameters', () => {
    const { store } = make();
    store.add('dev', 'A', cfg());
    store.add('dev', 'B', cfg({ baudRate: 9600 }));
    assert.equal(store.getAllConfigs().length, 2);
  });

  // 1.4.3 起 legacy 数据构造时自动并入池（迁移保真）并参与查重——同名/同参数与池内一致。
});

describe('SerialPortConfigStore 引用计数', () => {
  it('#15 detaches the reference and fires the identity event on remove', () => {
    const { store, events } = make();
    const added = store.add('dev', 'A', cfg());
    events.length = 0;
    store.remove('dev', added.id);
    assert.equal(store.getGlobalConfigs('dev').length, 0);
    assert.deepEqual(events, ['dev']);
  });

  it('#16 removes the config from the pool when the last reference goes away', () => {
    const { store } = make();
    const added = store.add('dev', 'A', cfg());
    store.remove('dev', added.id);
    assert.equal(store.getAllConfigs().length, 0);
  });

  it('#17 keeps a shared config visible for the other device after one remove', () => {
    const { store } = make();
    const added = store.add('dev1', 'A', cfg());
    store.attach('dev2', added.id);
    store.remove('dev1', added.id);
    assert.equal(store.getGlobalConfigs('dev2').length, 1);
    assert.equal(store.getAllConfigs().length, 1);
  });
});

describe('SerialPortConfigStore 生命周期', () => {
  it('#18 writes pool and refs, fires identity, and returns an id-bearing config on add', () => {
    const { store, events } = make();
    const added = store.add('dev', 'A', cfg({ baudRate: 9600 }));
    assert.equal(added.name, 'A');
    assert.equal(added.config.baudRate, 9600);
    assert.ok(added.id.length > 0);
    assert.deepEqual(events, ['dev']);
    assert.equal(store.getGlobalConfigs('dev')[0]?.id, added.id);
  });

  it('#19 attaches an existing pool config and rejects an unknown id', () => {
    const { store, events } = make();
    const added = store.add('dev1', 'A', cfg());
    events.length = 0;
    assert.throws(() => store.attach('dev2', 'nope'), /Config not found/);
    assert.doesNotThrow(() => store.attach('dev2', added.id));
    assert.equal(store.getGlobalConfigs('dev2').length, 1);
    assert.deepEqual(events, ['dev2']);
  });

  it('#20 renames silently for an unknown id and keeps id/config when renaming', () => {
    const { store, events } = make();
    store.rename('dev', 'ghost', 'X');
    assert.deepEqual(events, []);
    const added = store.add('dev', 'A', cfg());
    events.length = 0;
    store.rename('dev', added.id, 'Renamed');
    assert.deepEqual(events, ['dev']);
    const view = store.getGlobalConfigs('dev')[0];
    assert.equal(view?.id, added.id);
    assert.equal(view?.name, 'Renamed');
    assert.deepEqual(view?.config, cfg());
  });
});

describe('SerialPortConfigStore 1.4.3 自动迁移', () => {
  it('#21 migrates the legacy object form into pool and refs, then removes the old key', () => {
    const memento = new FakeMemento();
    void memento.update(KEYS.legacy, {
      dev: [legacyConfig('L1', 'Old'), legacyConfig('L2', 'Older')],
      other: [legacyConfig('L3', 'Elsewhere')],
    });
    const { store } = make(memento);
    assert.equal(store.getAllConfigs().length, 3); // 全部并入池
    assert.equal(store.getGlobalConfigs('dev').length, 2); // 分区引用已建立
    assert.equal(store.getGlobalConfigs('other').length, 1);
    assert.equal(store.getLegacyConfigs('dev').length, 0); // 旧键已删，兜底读取为空
    assert.equal(memento.get(KEYS.legacy), undefined);
    // 幂等：同存储再建 Store（模拟再次激活）不重复迁移
    const again = new SerialPortConfigStore(memento);
    assert.equal(again.getAllConfigs().length, 3);
  });

  it('#22 migrates the legacy array form via the existing refs', () => {
    const memento = new FakeMemento();
    void memento.update(KEYS.legacy, [legacyConfig('L1', 'Old')]);
    void memento.update(KEYS.refs, { dev: ['L1'] });
    const { store } = make(memento);
    assert.equal(store.getAllConfigs().length, 1);
    assert.equal(store.getGlobalConfigs('dev').length, 1); // 原引用继续生效
    assert.equal(memento.get(KEYS.legacy), undefined);
  });

  it('#23 skips pool id collisions and still removes the old key', () => {
    const memento = new FakeMemento();
    void memento.update(KEYS.pool, [legacyConfig('L1', 'Existing')]);
    void memento.update(KEYS.legacy, { dev: [legacyConfig('L1', 'Old'), legacyConfig('L2', 'New')] });
    const { store } = make(memento);
    assert.equal(store.getAllConfigs().length, 2); // L1 去重跳过，L2 并入
    assert.equal(store.getGlobalConfigs('dev').length, 2); // 引用落到池内同 id 条目
    assert.equal(memento.get(KEYS.legacy), undefined);
  });

  it('#24 leaves storage untouched when no legacy key exists', () => {
    const memento = new FakeMemento();
    void memento.update(KEYS.pool, [legacyConfig('C1', 'Kept')]);
    const { store } = make(memento);
    assert.equal(store.getAllConfigs().length, 1);
    assert.deepEqual(memento.get(KEYS.refs), undefined); // 无迁移写入
  });
});

describe('SerialPortConfigStore 其他', () => {
  it('#25 filters dirty refs and round-trips the last-used config without events', () => {
    const memento = new FakeMemento();
    void memento.update(KEYS.pool, [{ id: 'C1', name: 'C1', config: cfg() }]);
    void memento.update(KEYS.refs, { dev: ['C1', 'GHOST'] });
    const { store, events } = make(memento);
    assert.equal(store.getGlobalConfigs('dev').length, 1);
    const last = cfg({ baudRate: 9600 });
    store.setLastUsedConfig('dev', last);
    assert.deepEqual(store.getLastUsedConfig('dev'), last);
    assert.deepEqual(events, []);
  });
});
