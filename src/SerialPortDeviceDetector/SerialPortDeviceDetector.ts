import * as vscode from 'vscode';
import { SerialPortHal } from '../hal/SerialPortHal';
import { SerialPortDeviceInterface } from './SerialPortDeviceInterface';
import { SerialPortDeviceImpl, computeDeviceIdentity } from './SerialPortDeviceImpl';

export interface SerialPortDevicesChangeEvent {
  added: SerialPortDeviceInterface[];
  removed: SerialPortDeviceInterface[];
}

export class SerialPortDeviceDetector implements vscode.Disposable {
  private _onDidChangeDevices = new vscode.EventEmitter<SerialPortDevicesChangeEvent>();
  readonly onDidChangeDevices = this._onDidChangeDevices.event;

  private devices = new Map<string, SerialPortDeviceImpl>();
  private pollingTimer: ReturnType<typeof setInterval> | undefined;
  private active = false;
  private scanFailureNotified = false;

  constructor(
    private readonly hal: SerialPortHal,
    private readonly context: vscode.ExtensionContext
  ) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        // 仅轮询相关设置变更才重启：粒度收窄到 pollingInterval / hotPlugEnabled，
        // 其余 serialPortTerminal.* 变更（agentBridge / log* 等）不打断现行节拍。
        if (
          this.active &&
          (event.affectsConfiguration('serialPortTerminal.pollingInterval') ||
            event.affectsConfiguration('serialPortTerminal.hotPlugEnabled'))
        ) {
          this.start();
        }
      })
    );
  }

  public getDevices(): SerialPortDeviceInterface[] {
    return [...this.devices.values()];
  }

  // isPolling = true 时为轮询扫描：失败提示按失败轮次去重——连续失败仅首次弹出
  // 错误提示（后续仅 console.error），扫描成功后复位、再遇失败重新提示，防止底层
  // 持续失败时按轮询周期（1–15 秒）弹窗轰炸；缺省（手动刷新 / 初始扫描 / 测试）
  // 始终提示。见设计文档 §6「扫描失败提示去重」。
  public async scan(isPolling = false): Promise<void> {
    try {
      const infos = await this.hal.listDevices();
      this.scanFailureNotified = false;

      const added: SerialPortDeviceImpl[] = [];
      const removed: SerialPortDeviceImpl[] = [];
      const seen = new Set<string>();

      for (const info of infos) {
        seen.add(info.path);
        const existing = this.devices.get(info.path);
        if (existing && existing.identity !== computeDeviceIdentity(info)) {
          this.devices.delete(info.path);
          removed.push(existing);
        }
        if (!this.devices.has(info.path)) {
          const device = new SerialPortDeviceImpl(info);
          this.devices.set(info.path, device);
          added.push(device);
        }
      }

      for (const [path, device] of this.devices) {
        if (!seen.has(path)) {
          this.devices.delete(path);
          removed.push(device);
        }
      }

      if (added.length > 0 || removed.length > 0) {
        this._onDidChangeDevices.fire({ added, removed });
      }
    } catch (error) {
      console.error('Device scan error:', error);
      if (!isPolling || !this.scanFailureNotified) {
        vscode.window.showErrorMessage(vscode.l10n.t('Failed to list serial ports: {0}', `${error}`));
      }
      this.scanFailureNotified = true;
    }
  }

  public start(): void {
    this.stop();
    this.active = true;
    if (!this.hotPlugEnabled) {
      return;
    }
    this.pollingTimer = setInterval(() => {
      void this.scan(true);
    }, this.pollingIntervalSeconds * 1000);
  }

  public stop(): void {
    this.active = false;
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  public dispose(): void {
    this.stop();
    this._onDidChangeDevices.dispose();
  }

  private get pollingIntervalSeconds(): number {
    const raw = vscode.workspace.getConfiguration('serialPortTerminal').get<number>('pollingInterval', 2);
    // 钳制到 schema 允许的 1–15 秒，防止手改 settings.json 越界。
    return Math.max(1, Math.min(15, raw));
  }

  private get hotPlugEnabled(): boolean {
    return vscode.workspace.getConfiguration('serialPortTerminal').get<boolean>('hotPlugEnabled', true);
  }
}
