import * as vscode from 'vscode';
import { SerialPortHal, SerialPortOpenOptions } from '../hal/SerialPortHal';
import { SerialPortDeviceDetector } from '../SerialPortDeviceDetector/SerialPortDeviceDetector';
import { SerialPortDeviceInterface } from '../SerialPortDeviceDetector/SerialPortDeviceInterface';
import { SerialConfig } from '../SerialPortConfig/SerialPortQuickConfig';
import { SerialPortConsumer } from './SerialPortConsumer';
import { SerialPortConnection } from './SerialPortConnection';

const DEFAULT_CONFIG: SerialConfig = {
  schemaVersion: 1,
  baudRate: 115200,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  flowControl: 'none'
};

export class SerialPortConnectionService {
  private _onDidChangeDeviceStatus = new vscode.EventEmitter<SerialPortDeviceInterface>();
  readonly onDidChangeDeviceStatus = this._onDidChangeDeviceStatus.event;

  private connections = new Map<string, SerialPortConnection>();

  constructor(
    private readonly hal: SerialPortHal,
    private readonly detector: SerialPortDeviceDetector,
    context: vscode.ExtensionContext,
    private readonly defaultConsumerFactory?: () => SerialPortConsumer
  ) {
    context.subscriptions.push(
      detector.onDidChangeDevices(event => {
        for (const device of event.removed) {
          void this.destroyConnection(device.path);
        }
      })
    );
  }

  public async connect(device: SerialPortDeviceInterface, config: SerialConfig = DEFAULT_CONFIG, label?: string): Promise<void> {
    if (!device || device.status !== 'disconnected') {
      return;
    }
    device.setStatus('connecting');
    this._onDidChangeDeviceStatus.fire(device);
    try {
      const handle = await this.hal.openPort(this.toOpenOptions(device.path, config));
      const connection = new SerialPortConnection(device, handle, config, label, () => {
        void this.disconnectByPath(device.path);
      });
      if (this.defaultConsumerFactory) {
        connection.addConsumer(this.defaultConsumerFactory());
      }
      this.connections.set(device.path, connection);
      device.setStatus('connected');
    } catch (error) {
      device.setStatus('disconnected');
      vscode.window.showErrorMessage(vscode.l10n.t('Connection failed: {0}', `${error}`));
    }
    this._onDidChangeDeviceStatus.fire(device);
  }

  public getConnectionConfig(path: string): SerialConfig | undefined {
    return this.connections.get(path)?.config;
  }

  private toOpenOptions(path: string, config: SerialConfig): SerialPortOpenOptions {
    return {
      path,
      baudRate: config.baudRate,
      dataBits: config.dataBits,
      parity: config.parity,
      stopBits: config.stopBits,
      rtscts: config.flowControl === 'rtscts'
    };
  }

  public async disconnect(device: SerialPortDeviceInterface): Promise<void> {
    if (!device) {
      return;
    }
    await this.destroyConnection(device.path);
    device.setStatus('disconnected');
    this._onDidChangeDeviceStatus.fire(device);
  }

  private async disconnectByPath(path: string): Promise<void> {
    const device = this.detector.getDevices().find(device => device.path === path);
    if (device) {
      await this.disconnect(device);
    }
  }

  private async destroyConnection(path: string): Promise<void> {
    const connection = this.connections.get(path);
    if (connection) {
      await connection.close().catch(() => {});
      this.connections.delete(path);
    }
  }
}
