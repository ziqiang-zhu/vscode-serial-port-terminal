import * as vscode from 'vscode';
import { SerialConfig, SerialPortQuickConfig, serialConfigEquals } from './SerialPortQuickConfig';

// 旧版本数据键：v1.2.0 及更早为「按设备分区对象」，v1.2.1/1.2.2 迁移后为「全局数组」。
// 1.4.3 起构造时自动迁移并入池与引用并删除旧键（见 migrateLegacyData 与设计文档 §4.1/§9）；
// getLegacyConfigs 仅作迁移失败兜底，迁移成功后自然为空。
const LEGACY_KEY = 'serialPortQuickConfigs';
// 新全局快捷配置池与每设备引用。
const POOL_KEY = 'serialPortQuickConfigPool';
const REFS_KEY = 'serialPortDeviceConfigRefs';
const LAST_USED_KEY = 'serialPortLastUsedConfigs';
const VALID_DATA_BITS = [5, 6, 7, 8];
const VALID_STOP_BITS = [1, 1.5, 2];
const VALID_PARITIES: SerialConfig['parity'][] = ['none', 'even', 'odd', 'mark', 'space'];
const VALID_FLOW_CONTROLS: SerialConfig['flowControl'][] = ['none', 'rtscts'];

export class SerialPortConfigStore {
  private _onDidChangeConfigs = new vscode.EventEmitter<string>();
  readonly onDidChangeConfigs = this._onDidChangeConfigs.event;

  private pool: SerialPortQuickConfig[] | undefined;
  private refs: Record<string, string[]> | undefined;

  constructor(private readonly storage: vscode.Memento) {
    this.migrateLegacyData();
  }

  // 一次性数据迁移（1.4.3，约定见 doc/SerialPortQuickConfig设计.md §4.1/§9）：
  // 旧键 serialPortQuickConfigs 的两种形态并入全局池与引用，随后删除旧键作为
  // 迁移完成标记——写入失败时旧键保留，下次构造幂等重跑自愈。
  // 对象形态（v1.2.0-）：分区配置逐条并入池，并为分区 identity 建立引用；
  // 数组形态（v1.2.1/1.2.2）：内容并入池（引用已在 refs，无需重建）。
  // 合并按 id 去重：旧条目 id 已在池中则跳过（refs 引用落到池内同 id 条目）。
  // 迁移保真：不触发名称/参数校验，不做重命名。
  private migrateLegacyData(): void {
    const raw = this.storage.get<unknown>(LEGACY_KEY);
    if (raw === undefined) {
      return;
    }
    const incoming: { identity: string; config: SerialPortQuickConfig }[] = [];
    if (Array.isArray(raw)) {
      for (const config of raw as SerialPortQuickConfig[]) {
        incoming.push({ identity: '', config }); // 数组形态：引用已在 refs
      }
    } else if (raw && typeof raw === 'object') {
      for (const [identity, configs] of Object.entries(raw as Record<string, SerialPortQuickConfig[]>)) {
        for (const config of configs ?? []) {
          incoming.push({ identity, config });
        }
      }
    } else {
      return; // 未知形态：不认识的数据不破坏，保留原样
    }
    const pool = this.readPool();
    const refs = this.readRefs();
    let changed = false;
    for (const { identity, config } of incoming) {
      if (!config || typeof config !== 'object' || !config.id) {
        continue; // 条目残缺：跳过
      }
      // id 去重：池内已有同 id 时不重复入池，但引用照常建立——旧设备对该配置的
      // 归属语义保留，落到池内同 id 条目。
      if (!pool.some(c => c.id === config.id)) {
        pool.push(config);
        changed = true;
      }
      if (identity) {
        const ids = refs[identity] ?? [];
        if (!ids.includes(config.id)) {
          ids.push(config.id);
          refs[identity] = ids;
          changed = true;
        }
      }
    }
    if (changed) {
      this.writePool(pool);
      this.writeRefs(refs);
    }
    void this.storage.update(LEGACY_KEY, undefined);
  }

  // 可见配置 = 新全局（引用）+ 旧按设备（原样）。
  getConfigs(identity: string): SerialPortQuickConfig[] {
    return [...this.getGlobalConfigs(identity), ...this.getLegacyConfigs(identity)];
  }

  getGlobalConfigs(identity: string): SerialPortQuickConfig[] {
    const ids = this.readRefs()[identity] ?? [];
    const pool = this.readPool();
    return ids
      .map(id => pool.find(c => c.id === id))
      .filter((c): c is SerialPortQuickConfig => c !== undefined);
  }

  getLegacyConfigs(identity: string): SerialPortQuickConfig[] {
    const raw = this.storage.get<unknown>(LEGACY_KEY);
    if (Array.isArray(raw)) {
      // v1.2.1/1.2.2 已把旧对象迁移成数组：配置在数组里，引用在 REFS_KEY。
      const pool = raw as SerialPortQuickConfig[];
      const ids = this.readRefs()[identity] ?? [];
      return ids
        .map(id => pool.find(c => c.id === id))
        .filter((c): c is SerialPortQuickConfig => c !== undefined);
    }
    if (raw && typeof raw === 'object') {
      // 旧版本（v1.2.0 及更早）：按设备分区对象，原样读取。
      return (raw as Record<string, SerialPortQuickConfig[]>)[identity] ?? [];
    }
    return [];
  }

  getAllConfigs(): SerialPortQuickConfig[] {
    return [...this.readPool()];
  }

  getUnattachedConfigs(identity: string): SerialPortQuickConfig[] {
    const attached = new Set(this.readRefs()[identity] ?? []);
    return this.readPool().filter(c => !attached.has(c.id));
  }

  add(identity: string, name: string, config: SerialConfig): SerialPortQuickConfig {
    const trimmedName = this.assertValidName(identity, name);
    this.assertValidConfig(config);
    this.assertNoDuplicateParams(config);
    const quickConfig: SerialPortQuickConfig = { id: this.generateId(), name: trimmedName, config };
    this.writePool([...this.readPool(), quickConfig]);
    this.attachRef(identity, quickConfig.id);
    this._onDidChangeConfigs.fire(identity);
    return quickConfig;
  }

  attach(identity: string, configId: string): void {
    if (!this.readPool().some(c => c.id === configId)) {
      throw new Error(vscode.l10n.t('Config not found'));
    }
    this.attachRef(identity, configId);
    this._onDidChangeConfigs.fire(identity);
  }

  rename(identity: string, id: string, newName: string): void {
    const pool = this.readPool();
    const index = pool.findIndex(c => c.id === id);
    if (index < 0) {
      return;
    }
    const current = pool[index];
    if (!current) {
      return;
    }
    pool[index] = { id: current.id, config: current.config, name: this.assertValidName(identity, newName, id) };
    this.writePool(pool);
    this._onDidChangeConfigs.fire(identity);
  }

  remove(identity: string, id: string): void {
    // 1.4.3 起旧键在构造时迁移并删除：移除统一走引用清理（未知 id 自然 no-op）。
    this.detachRef(identity, id);
    this._onDidChangeConfigs.fire(identity);
  }

  getLastUsedConfig(identity: string): SerialConfig | undefined {
    return this.storage.get<Record<string, SerialConfig>>(LAST_USED_KEY)?.[identity];
  }

  setLastUsedConfig(identity: string, config: SerialConfig): void {
    const all = this.storage.get<Record<string, SerialConfig>>(LAST_USED_KEY) ?? {};
    all[identity] = config;
    void this.storage.update(LAST_USED_KEY, all);
  }

  dispose(): void {
    this._onDidChangeConfigs.dispose();
  }

  private attachRef(identity: string, id: string): void {
    const refs = this.readRefs();
    const ids = refs[identity] ?? [];
    if (!ids.includes(id)) {
      ids.push(id);
      refs[identity] = ids;
      this.writeRefs(refs);
    }
  }

  private detachRef(identity: string, id: string): void {
    const refs = this.readRefs();
    const ids = refs[identity];
    if (!ids) {
      return;
    }
    const next = ids.filter(x => x !== id);
    if (next.length === 0) {
      delete refs[identity];
    } else {
      refs[identity] = next;
    }
    this.writeRefs(refs);
    const stillReferenced = Object.values(refs).some(list => list.includes(id));
    if (!stillReferenced) {
      this.writePool(this.readPool().filter(c => c.id !== id));
    }
  }

  private readPool(): SerialPortQuickConfig[] {
    if (!this.pool) {
      const raw = this.storage.get<unknown>(POOL_KEY);
      this.pool = Array.isArray(raw) ? (raw as SerialPortQuickConfig[]) : [];
    }
    return this.pool;
  }

  private writePool(pool: SerialPortQuickConfig[]): void {
    this.pool = pool;
    void this.storage.update(POOL_KEY, pool);
  }

  private readRefs(): Record<string, string[]> {
    if (!this.refs) {
      this.refs = this.storage.get<Record<string, string[]>>(REFS_KEY) ?? {};
    }
    return this.refs;
  }

  private writeRefs(refs: Record<string, string[]>): void {
    this.refs = refs;
    void this.storage.update(REFS_KEY, refs);
  }

  private assertValidName(identity: string, name: string, excludeId?: string): string {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error(vscode.l10n.t('Config name cannot be empty'));
    }
    const duplicated = this.getGlobalConfigs(identity).some(c => c.id !== excludeId && c.name === trimmed);
    if (duplicated) {
      throw new Error(vscode.l10n.t('Config name "{0}" already exists', trimmed));
    }
    return trimmed;
  }

  private assertNoDuplicateParams(config: SerialConfig): void {
    // 全局池内同参数唯一；旧数据不参与、不冲突。
    const duplicated = this.readPool().some(c => serialConfigEquals(c.config, config));
    if (duplicated) {
      throw new Error(vscode.l10n.t('A quick config with the same parameters already exists'));
    }
  }

  private assertValidConfig(config: SerialConfig): void {
    if (!Number.isInteger(config.baudRate) || config.baudRate <= 0) {
      throw new Error(vscode.l10n.t('Invalid baud rate: {0}', config.baudRate));
    }
    if (!VALID_DATA_BITS.includes(config.dataBits)) {
      throw new Error(vscode.l10n.t('Invalid data bits: {0}', config.dataBits));
    }
    if (!VALID_STOP_BITS.includes(config.stopBits)) {
      throw new Error(vscode.l10n.t('Invalid stop bits: {0}', config.stopBits));
    }
    if (!VALID_PARITIES.includes(config.parity)) {
      throw new Error(vscode.l10n.t('Invalid parity: {0}', config.parity));
    }
    if (!VALID_FLOW_CONTROLS.includes(config.flowControl)) {
      throw new Error(vscode.l10n.t('Invalid flow control: {0}', config.flowControl));
    }
  }

  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
