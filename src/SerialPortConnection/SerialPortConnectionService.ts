import * as vscode from 'vscode';
import { SerialPortHal } from '../hal/SerialPortHal';
import { SerialPortDeviceDetector } from '../SerialPortDeviceDetector/SerialPortDeviceDetector';
import { SerialPortDeviceInterface } from '../SerialPortDeviceDetector/SerialPortDeviceInterface';
import { SerialPortConnection } from './SerialPortConnection';

export class SerialPortConnectionService {
  private _onDidChangeDeviceStatus = new vscode.EventEmitter<SerialPortDeviceInterface>();
  readonly onDidChangeDeviceStatus = this._onDidChangeDeviceStatus.event;

  private connections = new Map<string, SerialPortConnection>();

  constructor(
    private readonly hal: SerialPortHal,
    detector: SerialPortDeviceDetector,
    context: vscode.ExtensionContext
  ) {
    context.subscriptions.push(
      detector.onDidChangeDevices(event => {
        for (const device of event.removed) {
          void this.destroyConnection(device.path);
        }
      })
    );
  }

  public async connect(device: SerialPortDeviceInterface): Promise<void> {
    if (!device || device.status !== 'disconnected') {
      return;
    }
    device.setStatus('connecting');
    this._onDidChangeDeviceStatus.fire(device);
    try {
      // TODO: 按设备身份（device.identity）载入配置，当前使用默认参数
      const handle = await this.hal.openPort({ path: device.path, baudRate: 115200 });
      this.connections.set(device.path, new SerialPortConnection(device, handle));
      device.setStatus('connected');
    } catch (error) {
      device.setStatus('disconnected');
      vscode.window.showErrorMessage(`连接失败: ${error}`);
    }
    this._onDidChangeDeviceStatus.fire(device);
  }

  public async disconnect(device: SerialPortDeviceInterface): Promise<void> {
    if (!device) {
      return;
    }
    await this.destroyConnection(device.path);
    device.setStatus('disconnected');
    this._onDidChangeDeviceStatus.fire(device);
  }

  private async destroyConnection(path: string): Promise<void> {
    const connection = this.connections.get(path);
    if (connection) {
      await connection.close().catch(() => {});
      this.connections.delete(path);
    }
  }
}
