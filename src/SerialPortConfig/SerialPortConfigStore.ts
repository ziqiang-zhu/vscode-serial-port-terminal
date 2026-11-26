import * as vscode from 'vscode';
import { SerialConfig, SerialPortQuickConfig, serialConfigEquals } from './SerialPortQuickConfig';

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

  constructor(private readonly storage: vscode.Memento) {}

  // 存储结构 = 全局池 + 设备引用（refs）两层：池存全部条目，refs 按 identity 记录
  // 挂到各设备的条目 id。树显示与名称校验读 refs（identity 内），参数唯一性校验读
  // 全池（跨设备防相同参数）。旧版迁移已在 1.5.0 移除，不再读取旧键。
  getGlobalConfigs(identity: string): SerialPortQuickConfig[] {
    const ids = this.readRefs()[identity] ?? [];
    const pool = this.readPool();
    return ids
      .map(id => pool.find(c => c.id === id))
      .filter((c): c is SerialPortQuickConfig => c !== undefined);
  }

  getAllConfigs(): SerialPortQuickConfig[] {
    return [...this.readPool()];
  }

  getUnattachedConfigs(identity: string): SerialPortQuickConfig[] {
    const attached = new Set(this.readRefs()[identity] ?? []);
    return this.readPool().filter(c => !attached.has(c.id));
  }

  add(identity: string, name: string, config: SerialConfig): SerialPortQuickConfig {
    const trimmedName = this.assertValidName(
      identity,
      name,
      undefined,
      'A quick config with the same name already exists - right-click the device and choose "Add Quick Config" to reuse it'
    );
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
    // 移除统一走引用清理（未知 id 自然 no-op）。
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

  private writePool(pool: SerialPortQuickConfig[]): Thenable<void> {
    this.pool = pool;
    return this.storage.update(POOL_KEY, pool);
  }

  private readRefs(): Record<string, string[]> {
    if (!this.refs) {
      this.refs = this.storage.get<Record<string, string[]>>(REFS_KEY) ?? {};
    }
    return this.refs;
  }

  private writeRefs(refs: Record<string, string[]>): Thenable<void> {
    this.refs = refs;
    return this.storage.update(REFS_KEY, refs);
  }

  private assertValidName(identity: string, name: string, excludeId?: string, duplicatedMessage?: string): string {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error(vscode.l10n.t('Config name cannot be empty'));
    }
    const duplicated = this.getGlobalConfigs(identity).some(c => c.id !== excludeId && c.name === trimmed);
    if (duplicated) {
      throw new Error(vscode.l10n.t(duplicatedMessage ?? 'Config name "{0}" already exists', trimmed));
    }
    return trimmed;
  }

  private assertNoDuplicateParams(config: SerialConfig): void {
    // 全局池内同参数唯一（跨设备防相同参数）。
    const duplicated = this.readPool().some(c => serialConfigEquals(c.config, config));
    if (duplicated) {
      throw new Error(
        vscode.l10n.t(
          'A quick config with the same parameters already exists - right-click the device and choose "Add Quick Config" to reuse it'
        )
      );
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
