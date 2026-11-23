import * as vscode from 'vscode';
import { SerialPortHal, SerialPortHandle, SerialPortOpenOptions } from '../hal/SerialPortHal';
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

const CONNECT_TIMEOUT_MS = 5_000;

// 打开挂起超时的专属错误类型：catch 路径据此区分提示文案（连接超时 vs 连接失败）。
export class PortOpenTimeoutError extends Error {}

// 连接模式：主 Consumer 的选型依据（串口助手设计 §3——主 Consumer 由连接模式
// 决定；同设备互斥由"每设备单连接 + status 守卫"天然保证）。缺省 terminal，
// 全部既有调用方零改动。
export type SerialPortConsumerMode = 'terminal' | 'assist';

export class SerialPortConnectionService implements vscode.Disposable {
  private _onDidChangeDeviceStatus = new vscode.EventEmitter<SerialPortDeviceInterface>();
  readonly onDidChangeDeviceStatus = this._onDidChangeDeviceStatus.event;

  private connections = new Map<string, SerialPortConnection>();
  private disposed = false;

  constructor(
    private readonly hal: SerialPortHal,
    private readonly detector: SerialPortDeviceDetector,
    context: vscode.ExtensionContext,
    private readonly defaultConsumerFactory?: (mode: SerialPortConsumerMode) => SerialPortConsumer,
    // 打开挂起超时（毫秒）：驱动假死时 openPort 永不返回，设备将永久停在
    // connecting（UI 无重试入口）。缺省 5 秒；测试注入更短值做确定性验证。
    private readonly connectTimeoutMs: number = CONNECT_TIMEOUT_MS,
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

  public async connect(
    device: SerialPortDeviceInterface,
    config: SerialConfig = DEFAULT_CONFIG,
    label?: string,
    mode: SerialPortConsumerMode = 'terminal'
  ): Promise<void> {
    if (!device || device.status !== 'disconnected' || this.disposed) {
      return;
    }
    device.setStatus('connecting');
    this._onDidChangeDeviceStatus.fire(device);
    try {
      const handle = await this.openPortWithTimeout(device.path, config, this.connectTimeoutMs);
      // 拔除竞态防护：openPort 的 await 窗口内设备可能被拔（removed 事件链触发
      // disconnect、状态回写 disconnected），恢复执行后复核——同路径仍为同一设备
      // 模型且仍处 connecting 才继续，否则关闭句柄静默放弃（设备拔除不是连接
      // 失败，不弹错误提示）。无此复核将产生孤儿连接：销毁请求经 disconnectByPath
      // 永久短路，连接持续整个会话，依附 Consumer 不收尾。
      const current = this.detector.getDevices().find(item => item.path === device.path);
      if (this.disposed || current !== device || current.status !== 'connecting') {
        await handle.close().catch(() => {});
        return;
      }
      // 打开成功后进入构造窗口：此后任何异常（工厂/构造器抛错）都必须兜底关闭
      // 句柄，否则端口被占用且无人持有（A2 契约，见设计文档 §4「连接失败」）。
      try {
        const connection = new SerialPortConnection(
          device,
          handle,
          config,
          label,
          () => {
            void this.disconnectByPath(device.path);
          },
          this.defaultConsumerFactory?.(mode)
        );
        this.connections.set(device.path, connection);
      } catch (error) {
        await handle.close().catch(() => {});
        throw error;
      }
      device.setStatus('connected');
    } catch (error) {
      device.setStatus('disconnected');
      if (error instanceof PortOpenTimeoutError) {
        vscode.window.showErrorMessage(vscode.l10n.t('Connection timed out: {0}', device.path));
      } else {
        vscode.window.showErrorMessage(vscode.l10n.t('Connection failed: {0}', `${error}`));
      }
    }
    this._onDidChangeDeviceStatus.fire(device);
  }

  // 打开挂起超时：定时器先到即按超时失败回滚，底层 openPort 迟到成功时其句柄已
  // 无人持有，竞速内直接关闭（防幽灵句柄占用端口）；openPort 先失败则原样透传。
  private async openPortWithTimeout(path: string, config: SerialConfig, timeoutMs: number): Promise<SerialPortHandle> {
    return new Promise<SerialPortHandle>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        reject(new PortOpenTimeoutError());
      }, timeoutMs);
      this.hal.openPort(this.toOpenOptions(path, config)).then(
        handle => {
          clearTimeout(timer);
          if (settled) {
            void handle.close().catch(() => {});
          } else {
            settled = true;
            resolve(handle);
          }
        },
        error => {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            reject(error);
          }
        }
      );
    });
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
