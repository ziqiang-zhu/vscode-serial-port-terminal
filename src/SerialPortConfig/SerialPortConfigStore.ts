import * as vscode from 'vscode';
import { SerialConfig, SerialPortQuickConfig } from './SerialPortQuickConfig';

const STORAGE_KEY = 'serialPortQuickConfigs';
const LAST_USED_KEY = 'serialPortLastUsedConfigs';
const VALID_DATA_BITS = [5, 6, 7, 8];
const VALID_STOP_BITS = [1, 1.5, 2];

export class SerialPortConfigStore {
  private _onDidChangeConfigs = new vscode.EventEmitter<string>();
  readonly onDidChangeConfigs = this._onDidChangeConfigs.event;

  private configs: Record<string, SerialPortQuickConfig[]> | undefined;

  constructor(private readonly storage: vscode.Memento) {}

  getConfigs(identity: string): SerialPortQuickConfig[] {
    return this.read()[identity] ?? [];
  }

  add(identity: string, name: string, config: SerialConfig): SerialPortQuickConfig {
    const trimmedName = this.assertValidName(identity, name);
    this.assertValidConfig(config);
    const quickConfig: SerialPortQuickConfig = { id: this.generateId(), name: trimmedName, config };
    const all = this.read();
    const deviceConfigs = all[identity] ?? [];
    deviceConfigs.push(quickConfig);
    all[identity] = deviceConfigs;
    void this.storage.update(STORAGE_KEY, all);
    this._onDidChangeConfigs.fire(identity);
    return quickConfig;
  }

  rename(identity: string, id: string, newName: string): void {
    const all = this.read();
    const deviceConfigs = all[identity] ?? [];
    const index = deviceConfigs.findIndex(c => c.id === id);
    if (index < 0) {
      return;
    }
    const current = deviceConfigs[index];
    if (!current) {
      return;
    }
    deviceConfigs[index] = {
      id: current.id,
      config: current.config,
      name: this.assertValidName(identity, newName, id)
    };
    void this.storage.update(STORAGE_KEY, all);
    this._onDidChangeConfigs.fire(identity);
  }

  remove(identity: string, id: string): void {
    const all = this.read();
    const deviceConfigs = all[identity] ?? [];
    const index = deviceConfigs.findIndex(c => c.id === id);
    if (index < 0) {
      return;
    }
    deviceConfigs.splice(index, 1);
    if (deviceConfigs.length === 0) {
      delete all[identity];
    }
    void this.storage.update(STORAGE_KEY, all);
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

  private read(): Record<string, SerialPortQuickConfig[]> {
    if (!this.configs) {
      this.configs = this.storage.get<Record<string, SerialPortQuickConfig[]>>(STORAGE_KEY) ?? {};
    }
    return this.configs;
  }

  private assertValidName(identity: string, name: string, excludeId?: string): string {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('配置名称不能为空');
    }
    const duplicated = this.getConfigs(identity).some(c => c.id !== excludeId && c.name === trimmed);
    if (duplicated) {
      throw new Error(`配置名称 "${trimmed}" 已存在`);
    }
    return trimmed;
  }

  private assertValidConfig(config: SerialConfig): void {
    if (!Number.isInteger(config.baudRate) || config.baudRate <= 0) {
      throw new Error(`无效的波特率: ${config.baudRate}`);
    }
    if (!VALID_DATA_BITS.includes(config.dataBits)) {
      throw new Error(`无效的数据位: ${config.dataBits}`);
    }
    if (!VALID_STOP_BITS.includes(config.stopBits)) {
      throw new Error(`无效的停止位: ${config.stopBits}`);
    }
  }

  private generateId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
