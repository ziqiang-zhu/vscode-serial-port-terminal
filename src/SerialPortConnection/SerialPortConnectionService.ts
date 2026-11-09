import * as vscode from 'vscode';
import { SerialPortHal, SerialPortOpenOptions } from '../hal/SerialPortHal';
import { SerialPortDeviceDetector } from '../SerialPortDeviceDetector/SerialPortDeviceDetector';
import { SerialPortDeviceInterface } from '../SerialPortDeviceDetector/SerialPortDeviceInterface';
import { SerialConfig } from '../SerialPortConfig/SerialPortQuickConfig';
import { SerialPortConsumer } from './SerialPortConsumer';
import { SerialPortConnection } from './SerialPortConnection';

const DEFAULT_CONFIG: SerialConfig = {
  baudRate: 115200,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  flowControl: 'none'
};

export class SerialPortConnectionService implements vscode.Disposable {
  private _onDidChangeDeviceStatus = new vscode.EventEmitter<SerialPortDeviceInterface>();
  readonly onDidChangeDeviceStatus = this._onDidChangeDeviceStatus.event;

  private connections = new Map<string, SerialPortConnection>();
  private disposed = false;

  constructor(
    private readonly hal: SerialPortHal,
    private readonly detector: SerialPortDeviceDetector,
    context: vscode.ExtensionContext,
    private readonly defaultConsumerFactory?: () => SerialPortConsumer
  ) {
    // Service 自身入订阅列表：扩展停用时框架调用 dispose()，统一销毁全部
    // 连接并关闭端口（履行"Connection 随扩展停用销毁"的契约，见设计文档 §1/§4）。
    context.subscriptions.push(
      this,
      detector.onDidChangeDevices(event => {
        for (const device of event.removed) {
          void this.disconnect(device);
        }
      })
    );
  }

  // 扩展停用入口：逐个断开（关闭端口句柄、注销 Consumer）并把设备状态回写为
  // disconnected（端口已关闭，状态须如实；停用路径 fire 状态事件无意义——无监听者
  // 存活，只做资源回收与状态归位）。destroyConnection 级幂等，重复 dispose 安全。
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const [path, connection] of this.connections) {
      void connection.close().catch(() => {});
      this.connections.delete(path);
      const device = this.detector.getDevices().find(item => item.path === path);
      device?.setStatus('disconnected');
    }
    this._onDidChangeDeviceStatus.dispose();
  }

  public async connect(device: SerialPortDeviceInterface, config: SerialConfig = DEFAULT_CONFIG, label?: string): Promise<void> {
    if (!device || device.status !== 'disconnected' || this.disposed) {
      return;
    }
    device.setStatus('connecting');
    this._onDidChangeDeviceStatus.fire(device);
    try {
      const handle = await this.hal.openPort(this.toOpenOptions(device.path, config));
      const connection = new SerialPortConnection(
        device,
        handle,
        config,
        label,
        () => {
          void this.disconnectByPath(device.path);
        },
        this.defaultConsumerFactory?.()
      );
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

  public getConnection(path: string): SerialPortConnection | undefined {
    return this.connections.get(path);
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
