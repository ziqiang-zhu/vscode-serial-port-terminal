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

  constructor(
    private readonly hal: SerialPortHal,
    private readonly context: vscode.ExtensionContext
  ) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('serialPortTerminal') && this.active) {
          this.start();
        }
      })
    );
  }

  public getDevices(): SerialPortDeviceInterface[] {
    return [...this.devices.values()];
  }

  public async scan(): Promise<void> {
    try {
      const infos = await this.hal.listDevices();

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
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to list serial ports: {0}', `${error}`));
    }
  }

  public start(): void {
    this.stop();
    this.active = true;
    if (!this.hotPlugEnabled) {
      return;
    }
    this.pollingTimer = setInterval(() => {
      void this.scan();
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
