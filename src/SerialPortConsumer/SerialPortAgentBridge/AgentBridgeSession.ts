import * as vscode from 'vscode';
import { SerialPortConsumer } from '../../SerialPortConnection/SerialPortConsumer';
import { AgentBridgeCancelledError, SerialPortAgentBridge } from './SerialPortAgentBridge';

// 桥启动会话（公共工厂——契约见 doc/ConsumerDesign/SerialPortAssist设计.md §7）：
// startBridge 全流程（读 agentBridge.* 配置 → 选端口 → 构造 → 注册 → listen →
// 呈现）在 Terminal 与 Assist 双消费方共用，呈现差异经 presenter 回调注入
//（Terminal = 状态栏拉模型 + toast；Assist = 页内推模型）。bridgeStarting 重入
// 守卫随会话走（A4 先例：选端口窗口持锁、listen 窗口由 bridge 置位后的守卫自然
// 拦截），防双开竞态。

export interface AgentBridgeOwner {
  addConsumer(consumer: SerialPortConsumer): void;
  removeConsumer(id: string): void;
}

export interface AgentBridgeSessionPresenter {
  /** 任意状态迁移后回调（注册/启动成功/计数变化/停止/失败回滚）——拉模型呈现（Terminal 状态栏） */
  onChange(): void;
  /** listen 成功（push 呈现：Terminal toast / Assist 页内地址行） */
  onStarted(address: string, readonlyMode: boolean): void;
  /** 启动失败（非取消错误——端口占用等，该类仍走 toast 路径） */
  onFailed(error: Error): void;
}

export class AgentBridgeSession {
  private bridge: SerialPortAgentBridge | undefined;
  private address: string | undefined;
  private readonlyMode = false;
  private clientCount = 0;
  private starting = false;

  constructor(
    private readonly owner: AgentBridgeOwner,
    private readonly presenter: AgentBridgeSessionPresenter,
    // ANSI 剥离开关（Terminal 终端语义 true / Assist 透传 false）
    private readonly stripAnsi: boolean,
    // 出站字节回调（Assist 接线 observeOutbound——桥客户端字节记录 + 面板回显；
    // Terminal 不传）
    private readonly onOutboundBytes?: (data: Buffer) => void
  ) {}

  get active(): boolean {
    return this.bridge !== undefined;
  }

  get bridgeAddress(): string | undefined {
    return this.address;
  }

  get isReadonly(): boolean {
    return this.readonlyMode;
  }

  get clients(): number {
    return this.clientCount;
  }

  async start(): Promise<void> {
    if (this.bridge || this.starting) {
      return;
    }
    this.starting = true;
    try {
      const port = await this.pickPort();
      if (port === undefined) {
        return;
      }
      const readonlyMode = this.getReadonly();
      const bridge = new SerialPortAgentBridge(
        this.getHost(),
        port,
        readonlyMode,
        this.stripAnsi,
        count => {
          this.clientCount = count;
          this.presenter.onChange();
        },
        this.onOutboundBytes
      );
      this.bridge = bridge;
      this.readonlyMode = readonlyMode;
      this.clientCount = 0;
      this.owner.addConsumer(bridge);
      this.presenter.onChange();
      try {
        const address = await bridge.listen();
        this.address = `${address.host}:${address.port}`;
        this.presenter.onChange();
        this.presenter.onStarted(this.address, readonlyMode);
      } catch (error) {
        if (error instanceof AgentBridgeCancelledError) {
          // 启动挂起被取消（启动期间点了停止 / 断开收尾）：清理已由取消方
          // （stop / onClosed）完成，静默返回。
          this.presenter.onChange();
          return;
        }
        this.bridge = undefined;
        this.readonlyMode = false;
        this.address = undefined;
        this.clientCount = 0;
        this.owner.removeConsumer(bridge.id);
        this.presenter.onChange();
        this.presenter.onFailed(error instanceof Error ? error : new Error(`${error}`));
      }
    } finally {
      this.starting = false;
    }
  }

  stop(): void {
    if (!this.bridge) {
      return;
    }
    const bridge = this.bridge;
    this.bridge = undefined;
    this.address = undefined;
    this.readonlyMode = false;
    this.clientCount = 0;
    this.owner.removeConsumer(bridge.id);
    this.presenter.onChange();
  }

  /** 断开收尾：桥随 Connection 关闭链自行清理（A11 取消路径含其中），托管方仅丢弃会话引用。 */
  detach(): void {
    this.bridge = undefined;
    this.address = undefined;
    this.readonlyMode = false;
    this.clientCount = 0;
  }

  private getHost(): string {
    const host = vscode.workspace.getConfiguration('serialPortTerminal').get<string>('agentBridge.host', '127.0.0.1');
    return host && host.trim() ? host : '127.0.0.1';
  }

  private getReadonly(): boolean {
    return vscode.workspace
      .getConfiguration('serialPortTerminal')
      .get<boolean>('agentBridge.readonly', false);
  }

  private async pickPort(): Promise<number | undefined> {
    const configured = vscode.workspace.getConfiguration('serialPortTerminal').get<number[]>('agentBridge.ports', [2000]);
    // 0 = 临时端口（OS 分配）：产品语义合法，自动化测试以 [0] 规避端口冲突。
    const ports = (configured ?? [])
      .map(p => Number(p))
      .filter(p => Number.isInteger(p) && p >= 0 && p <= 65535);
    if (ports.length === 0) {
      void vscode.window.showErrorMessage(vscode.l10n.t('No Agent Bridge port configured'));
      return undefined;
    }
    if (ports.length === 1) {
      return ports[0];
    }
    const picked = await vscode.window.showQuickPick(
      ports.map(p => ({ label: String(p) })),
      { placeHolder: vscode.l10n.t('Select Agent Bridge port') }
    );
    return picked ? Number(picked.label) : undefined;
  }
}
