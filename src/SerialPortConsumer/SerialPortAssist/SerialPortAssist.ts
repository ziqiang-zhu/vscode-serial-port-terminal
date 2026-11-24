import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SerialPortConsumer, SerialPortConsumerHost } from '../../SerialPortConnection/SerialPortConsumer';
import { AgentBridgeSession } from '../SerialPortAgentBridge/AgentBridgeSession';
import { buildLogFilePath } from '../SerialPortLogFiles';
import { AssistBridgeStatusBarInfo, refreshAgentBridgeStatus } from '../SerialPortTerminal/SerialPortTerminal';
import { ASSIST_BUFFER_LIMIT, SerialPortAssistBuffer } from './SerialPortAssistBuffer';

// 最近可见的 Assist 面板（状态栏确定性解析的数据源——设计 §7）：面板可见性翻转
// 时更新（visible → 记录、hidden → 若指向自己则清除）。状态栏解析与事件顺序无关：
// 每次刷新都从「活动终端桥 → 最近可见面板桥 → 隐藏」重算，双事件竞态天然收敛。
let lastVisibleAssist: SerialPortAssist | undefined;
import { SerialPortDataRecorder } from './SerialPortDataRecorder';
import {
  AssistLineEnding,
  DEFAULT_LINE_ENDING,
  applyLineEnding,
  interpretEscapes,
  isLineEnding,
  parseHexInput,
} from './assistFormat';

// 宿主 → 页下行消息（契约见 doc/ConsumerDesign/SerialPortAssist设计.md §8）。
interface AppendMessage {
  type: 'append';
  entries: { seq: number; ts: number; dir: 'rx' | 'tx'; bytes: number[] }[];
}

interface StateMessage {
  type: 'state';
  connection: 'connected' | 'closed';
  truncated: number;
  recording: boolean;
  interval: boolean;
  file: { name: string; total: number; index: number; active: boolean; paused: boolean } | undefined;
  bridge: { active: boolean; address: string | undefined; readonly: boolean; clients: number };
}

interface SendErrorMessage {
  type: 'sendError';
  reason: 'odd-length' | 'invalid-char';
}

interface InitMessage {
  type: 'init';
  path: string;
}

// 页 → 宿主上行消息：发送 / 记录开关 / 桥控制 / 定时发送（发送历史为页内行为，
// 不经协议——设计 §5.1/§8；显示模式 / 清屏 / 暂停滚动同为页内行为）。
interface ReadyMessage {
  type: 'ready';
}

interface SendTextMessage {
  type: 'sendText';
  text?: unknown;
  lineEnding?: unknown;
}

interface SendHexMessage {
  type: 'sendHex';
  text?: unknown;
}

interface RecordToggleMessage {
  type: 'recordStart' | 'recordStop';
}

interface BridgeMessage {
  type: 'bridgeStart' | 'bridgeStop' | 'copyBridgeAddress';
}

interface IntervalStartMessage {
  type: 'startIntervalSend';
  mode?: unknown;
  text?: unknown;
  lineEnding?: unknown;
  interval?: unknown;
}

interface IntervalStopMessage {
  type: 'stopIntervalSend';
}

// 文件发送（P2-c）：选文件（宿主对话框）→ 装载（按行拆分 + 原始字节缓存）→
// 一次性原发 / 逐行播放（暂停/继续/停止状态机；循环 = 文件周期发送）；
// 行尾符沿用页面行尾符设置（决策 3）。
interface FileMessage {
  type: 'pickSendFile' | 'sendFileOnce' | 'startFileSend' | 'stopFileSend' | 'pauseFileSend' | 'resumeFileSend';
  lineEnding?: unknown;
  interval?: unknown;
  loop?: unknown;
}

// 槽发送面板（P2-b）：8 个输入槽各自独立——单发 / 循环开关；槽内容驻留页面，
// 宿主只收构建参数并按槽号管理循环定时器（多槽并发 = 字节交织，如实呈现）。
interface SlotMessage {
  type: 'slotSend' | 'slotIntervalStart' | 'slotIntervalStop';
  index?: unknown;
  mode?: unknown;
  text?: unknown;
  lineEnding?: unknown;
  interval?: unknown;
}

export interface IntervalSendOptions {
  mode: 'text' | 'hex';
  text: string;
  lineEnding: AssistLineEnding;
  interval: number;
}

export interface SlotSendOptions {
  mode: 'text' | 'hex';
  text: string;
  lineEnding: AssistLineEnding;
}

const FLUSH_INTERVAL_MS = 100;

export interface AssistBridgeStatus {
  address: string;
  readonly: boolean;
  clients: number;
}

/** 最近可见面板的运行中桥（状态栏解析第 2 步的数据源；无则 undefined → 隐藏）。 */
export function collectVisibleAssistBridge(): AssistBridgeStatus | undefined {
  const assist = lastVisibleAssist;
  if (!assist || !assist.isVisible || !assist.isBridgeActive()) {
    return undefined;
  }
  const address = assist.getBridgeAddress();
  if (!address) {
    return undefined;
  }
  return { address, readonly: assist.getBridgeReadonly(), clients: assist.getBridgeClients() };
}

export class SerialPortAssist extends SerialPortConsumer {
  readonly id = 'serialPortAssist';
  readonly displayName = 'Serial Port Assist';

  private panel: vscode.WebviewPanel | undefined;
  private readonly buffer = new SerialPortAssistBuffer();
  private dataRecorder: SerialPortDataRecorder | undefined;
  private bridgeSession: AgentBridgeSession | undefined;
  // 定时发送：启动时捕获字节，循环 transmit 直至停止/断开（设计 §5.2——内容以
  // 开关时刻为准，运行中的输入编辑不影响已捕获内容，重新开关以更新）。
  private intervalTimer: ReturnType<typeof setInterval> | undefined;
  private intervalBytes: Buffer | undefined;
  // 槽循环定时器表（P2-b）：槽号 → 循环定时器；多槽并发 = 字节交织如实呈现。
  private readonly slotTimers = new Map<number, ReturnType<typeof setInterval>>();
  private readonly slotBytes = new Map<number, Buffer>();
  // 文件发送（P2-c）：loadSendFile 时按行拆分（utf-8、过滤空行）并缓存原始字节
  // ——一次性发送用原始字节（二进制安全），逐行发送用拆分行（按行尾符设置补行尾）。
  // 播放状态机：playing（定时器在跑）/ paused（暂停——停表保留进度）/ 停止（复位
  // 重头）；断开自动停（复位）。
  private sendFileRaw: Buffer | undefined;
  private sendFileName = '';
  private sendFileLines: Buffer[] = [];
  private sendFileIndex = 0;
  private sendFileTimer: ReturnType<typeof setInterval> | undefined;
  private sendFileLoop = false;
  private sendFilePaused = false;
  // 暂停/继续沿用启动时的间隔（记忆于启动时刻）。
  private sendFileIntervalMs = 100;
  private hostPath = '';
  // 面板可见性（onDidChangeViewState 维护）——状态栏确定性解析的第 2 步依据。
  private panelVisible = false;

  public get isVisible(): boolean {
    return this.panelVisible;
  }
  private disconnected = false;
  // 100ms 批刷：seq 已推送水位 + 变更检测（无增量且状态未变时零 postMessage）。
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private pushedSeq = 0;
  private lastTruncated = -1;
  private lastConnection: 'connected' | 'closed' | undefined;
  private lastRecording = false;
  private lastInterval = false;
  private lastFileIndex = -1;

  public get devicePath(): string {
    return this.hostPath;
  }

  public attach(host: SerialPortConsumerHost): void {
    super.attach(host);
    this.hostPath = host.path;
    const title = `${host.path} · ${host.label ?? String(host.config.baudRate)}`;
    // retainContextWhenHidden：宿主缓冲是事实源，但页内已渲染内容与显示模式等
    // 会话态不应随标签页隐藏而丢失（对齐虚拟设备控制台先例）。
    const panel = vscode.window.createWebviewPanel('serialPortAssist', title, { viewColumn: vscode.ViewColumn.Active }, {
      enableScripts: true,
      retainContextWhenHidden: true
    });
    this.panel = panel;
    this.panelVisible = true;
    lastVisibleAssist = this;
    // 用户关页 = 断开（对齐 Terminal「关闭面板即断开」）；断开后的关页走下方
    // disconnected 守卫自然短路，不产生二次销毁请求。
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.stopFlushTimer();
      if (!this.disconnected) {
        this.requestDisconnect();
      }
    });
    panel.webview.onDidReceiveMessage(message => this.onPageMessage(message));
    // 面板可见性翻转 = 焦点面信号：可见 → 记录为最近可见面板；隐藏 → 清除指向。
    // 两种翻转都触发状态栏重算（确定性解析，与事件先后顺序无关——设计 §7）。
    panel.onDidChangeViewState(({ webviewPanel }) => {
      this.panelVisible = webviewPanel.visible;
      if (webviewPanel.visible) {
        lastVisibleAssist = this;
      } else if (lastVisibleAssist === this) {
        lastVisibleAssist = undefined;
      }
      refreshAgentBridgeStatus();
    });
    panel.webview.html = this.buildHtml();
    // init 不在此刻下发——页脚本就绪前 postMessage 会丢；页加载完成后经 ready
    // 握手拉取（onPageMessage 'ready'，页重载后同样适用）。
    this.startFlushTimer();
  }

  public onData(data: Buffer): void {
    if (this.disconnected) {
      return;
    }
    this.buffer.push(data, 'rx');
  }

  public onClosed(): void {
    this.disconnected = true;
    // 依附 Consumer（记录器/桥）随 Connection 收尾链拿到 onClosed，此处仅清
    // 引用；把缓冲内尚未推送的条目与「已断开」状态推完（面板保留可回看——
    // 对齐 Terminal 断开不销毁视图的关闭行为约定），随后停批刷。
    this.dataRecorder = undefined;
    this.bridgeSession?.detach();
    this.bridgeSession = undefined;
    this.stopIntervalSend();
    this.stopAllSlotIntervals();
    this.stopFileSend();
    this.flush();
    this.postState(true);
    this.stopFlushTimer();
    // 最近可见面板清除 + 全局桥状态栏刷新（若状态栏正显示本会话的桥，随断开清除）。
    if (lastVisibleAssist === this) {
      lastVisibleAssist = undefined;
    }
    refreshAgentBridgeStatus();
  }

  /** 开始数据记录（页内「记录」开关 / 集成断言入口）：懒建文件由记录器自管。 */
  public startDataRecording(): void {
    if (this.dataRecorder) {
      return;
    }
    try {
      this.dataRecorder = new SerialPortDataRecorder(buildLogFilePath(this.hostPath, 'dat'));
      this.addConsumer(this.dataRecorder);
      this.postState(true);
    } catch (error) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to start log: {0}', `${error}`));
    }
  }

  public stopDataRecording(): void {
    if (!this.dataRecorder) {
      return;
    }
    const recorder = this.dataRecorder;
    this.dataRecorder = undefined;
    // removeConsumer 触发记录器 onClosed（关流 + 「已保存」提示）。
    this.removeConsumer(recorder.id);
    this.postState(true);
  }

  public isRecording(): boolean {
    return this.dataRecorder !== undefined;
  }

  /**
   * 定时发送（页内开关 / 集成入口）：按启动时捕获的字节循环 transmit，断开自动
   * 停。interval 下限 20ms；字节构建失败（HEX 非法/空内容）返回 false 并对 HEX
   * 错误推送 sendError。
   */
  public startIntervalSend(options: IntervalSendOptions): boolean {
    if (this.disconnected || this.intervalTimer) {
      return false;
    }
    const built = this.buildOutbound(options.mode, options.text, options.lineEnding);
    if ('error' in built) {
      if (built.error !== 'empty') {
        const error: SendErrorMessage = { type: 'sendError', reason: built.error };
        void this.panel?.webview.postMessage(error);
      }
      return false;
    }
    this.intervalBytes = built.bytes;
    this.intervalTimer = setInterval(() => {
      if (this.disconnected) {
        this.stopIntervalSend();
        this.postState(true);
        return;
      }
      if (this.intervalBytes) {
        this.transmit(this.intervalBytes);
      }
    }, Math.max(20, options.interval));
    this.postState(true);
    return true;
  }

  public stopIntervalSend(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
      this.intervalBytes = undefined;
      this.postState(true);
    }
  }

  public isIntervalActive(): boolean {
    return this.intervalTimer !== undefined;
  }

  /** 槽单发（P2-b）：按槽构建字节立即发送（不清槽内容）；HEX 非法推送 sendError。 */
  public sendSlot(index: number, options: SlotSendOptions): boolean {
    if (this.disconnected) {
      return false;
    }
    const built = this.buildOutbound(options.mode, options.text, options.lineEnding);
    if ('error' in built) {
      if (built.error !== 'empty') {
        const error: SendErrorMessage = { type: 'sendError', reason: built.error };
        void this.panel?.webview.postMessage(error);
      }
      return false;
    }
    this.transmit(built.bytes);
    return true;
  }

  /** 槽循环启动：捕获槽字节按共享间隔循环 transmit；同槽重复启动幂等拒绝。 */
  public startSlotInterval(index: number, options: SlotSendOptions & { interval: number }): boolean {
    if (this.disconnected || this.slotTimers.has(index)) {
      return false;
    }
    const built = this.buildOutbound(options.mode, options.text, options.lineEnding);
    if ('error' in built) {
      if (built.error !== 'empty') {
        const error: SendErrorMessage = { type: 'sendError', reason: built.error };
        void this.panel?.webview.postMessage(error);
      }
      return false;
    }
    this.slotBytes.set(index, built.bytes);
    this.slotTimers.set(
      index,
      setInterval(() => {
        if (this.disconnected) {
          this.stopSlotInterval(index);
          return;
        }
        const bytes = this.slotBytes.get(index);
        if (bytes) {
          this.transmit(bytes);
        }
      }, Math.max(20, options.interval))
    );
    return true;
  }

  public stopSlotInterval(index: number): void {
    const timer = this.slotTimers.get(index);
    if (timer) {
      clearInterval(timer);
      this.slotTimers.delete(index);
      this.slotBytes.delete(index);
    }
  }

  private stopAllSlotIntervals(): void {
    for (const timer of this.slotTimers.values()) {
      clearInterval(timer);
    }
    this.slotTimers.clear();
    this.slotBytes.clear();
  }

  public isSlotIntervalActive(index: number): boolean {
    return this.slotTimers.has(index);
  }

  /** 选择发送文件（宿主对话框，不 经 页面传内容）；返回路径或取消。 */
  public async pickSendFile(): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: vscode.l10n.t('Select file')
    });
    return picked?.[0]?.fsPath;
  }

  /** 装载发送文件：按行拆分（\r?\n、过滤空行）并缓存原始字节；返回总行数。 */
  public loadSendFile(filePath: string, lineEnding: AssistLineEnding): number {
    const raw = fs.readFileSync(filePath);
    this.sendFileRaw = raw;
    this.sendFileName = path.basename(filePath);
    const ending = lineEnding === 'none' ? '' : lineEnding === 'cr' ? '\r' : lineEnding === 'lf' ? '\n' : '\r\n';
    this.sendFileLines = raw
      .toString('utf-8')
      .split(/\r?\n/)
      .filter(line => line.length > 0)
      .map(line => Buffer.from(line + ending, 'utf-8'));
    this.sendFileIndex = 0;
    return this.sendFileLines.length;
  }

  /** 文件一次性发送：装载后的原始字节原样发送（二进制安全，不补行尾）。 */
  public async sendFileOnce(): Promise<boolean> {
    if (this.disconnected || !this.sendFileRaw || this.sendFileRaw.length === 0) {
      return false;
    }
    this.transmit(this.sendFileRaw);
    return true;
  }

  /** 文件逐行发送（loop = EOF 后循环，即文件周期发送）；断开自动停。 */
  public startFileSend(interval: number, loop: boolean): boolean {
    if (this.disconnected || this.sendFileTimer || this.sendFileLines.length === 0) {
      return false;
    }
    this.sendFileIndex = 0;
    this.sendFileLoop = loop;
    this.sendFilePaused = false;
    this.sendFileIntervalMs = Math.max(20, interval);
    this.sendFileTimer = setInterval(() => {
      if (this.disconnected) {
        this.stopFileSend();
        this.postState(true);
        return;
      }
      const line = this.sendFileLines[this.sendFileIndex];
      if (!line) {
        // EOF（循环关闭时理论上已被下面的末行急停覆盖，防御性保留）：停止
        if (this.sendFileLoop) {
          this.sendFileIndex = 0;
          return;
        }
        this.stopFileSend();
        this.postState(true);
        return;
      }
      this.transmit(line);
      this.sendFileIndex += 1;
      // 末行急停（无循环）：发出最后一行即停止，指示与状态立即翻转
      if (this.sendFileIndex >= this.sendFileLines.length && !this.sendFileLoop) {
        this.stopFileSend();
        this.postState(true);
      }
    }, this.sendFileIntervalMs);
    this.postState(true);
    return true;
  }

  /** 暂停逐行播放：停表保留进度（sendFileIndex 不变），继续时从当前行恢复。 */
  public pauseFileSend(): void {
    if (this.sendFileTimer) {
      clearInterval(this.sendFileTimer);
      this.sendFileTimer = undefined;
      this.sendFilePaused = true;
      this.postState(true);
    }
  }

  /** 继续逐行播放：从暂停位置恢复（进度保留，间隔沿用启动值）；无暂停/已发完则拒绝。 */
  public resumeFileSend(): boolean {
    if (this.disconnected || this.sendFileTimer || !this.sendFilePaused || this.sendFileLines.length === 0) {
      return false;
    }
    this.sendFilePaused = false;
    this.sendFileTimer = setInterval(() => {
      if (this.disconnected) {
        this.stopFileSend();
        this.postState(true);
        return;
      }
      const line = this.sendFileLines[this.sendFileIndex];
      if (!line) {
        if (this.sendFileLoop) {
          this.sendFileIndex = 0;
          return;
        }
        this.stopFileSend();
        this.postState(true);
        return;
      }
      this.transmit(line);
      this.sendFileIndex += 1;
      if (this.sendFileIndex >= this.sendFileLines.length && !this.sendFileLoop) {
        this.stopFileSend();
        this.postState(true);
      }
    }, this.sendFileIntervalMs);
    this.postState(true);
    return true;
  }

  /** 停止逐行播放：清定时器（真正停止发送）并复位进度（重新开始从首行播放）。 */
  public stopFileSend(): void {
    if (this.sendFileTimer) {
      clearInterval(this.sendFileTimer);
    }
    this.sendFileTimer = undefined;
    this.sendFilePaused = false;
    this.sendFileIndex = 0;
    // 停止即推送状态（file.active=false）——页面按钮文案与进度随之翻转；
    // 漏推会让页面停在「停止逐行」态（P1-c 同类推送先例：stopIntervalSend 有）。
    this.postState(true);
  }

  public isFileSendActive(): boolean {
    return this.sendFileTimer !== undefined;
  }

  public isFileSendPaused(): boolean {
    return this.sendFilePaused && !this.sendFileTimer;
  }

  public getSendFileProgress(): { name: string; total: number; index: number; active: boolean; paused: boolean } | undefined {
    if (!this.sendFileLines.length) {
      return undefined;
    }
    return {
      name: this.sendFileName,
      total: this.sendFileLines.length,
      index: Math.min(this.sendFileIndex, this.sendFileLines.length),
      active: this.sendFileTimer !== undefined,
      paused: this.sendFilePaused
    };
  }

  /** 开始桥（页内开关 / 集成入口）：透传模式，出站字节经 observeOutbound 记录回显。 */
  public async startBridge(): Promise<void> {
    if (this.disconnected) {
      return;
    }
    await this.ensureBridgeSession().start();
    this.postState(true);
  }

  public stopBridge(): void {
    this.bridgeSession?.stop();
    this.postState(true);
  }

  public isBridgeActive(): boolean {
    return this.bridgeSession?.active ?? false;
  }

  public getBridgeAddress(): string | undefined {
    return this.bridgeSession?.bridgeAddress;
  }

  public getBridgeReadonly(): boolean {
    return this.bridgeSession?.isReadonly ?? false;
  }

  public getBridgeClients(): number {
    return this.bridgeSession?.clients ?? 0;
  }

  /** 桥客户端字节（即将写入串口）：记录 + 面板回显——桥已自行 send，不再重复。 */
  public observeOutbound(bytes: Buffer): void {
    this.dataRecorder?.recordTx(bytes);
    this.buffer.push(bytes, 'tx');
  }

  public copyBridgeAddress(): void {
    const address = this.getBridgeAddress();
    if (address) {
      void vscode.env.clipboard.writeText(address);
      void vscode.window.showInformationMessage(vscode.l10n.t('Agent Bridge address copied: {0}', address));
    }
  }

  // 桥会话懒建（公共工厂，AgentBridge设计 §4 / Assist设计 §7）：stripAnsi 恒
  // 透传 false；出站回调接线 observeOutbound（桥客户端字节 → 记录 + 面板回显）；
  // 页内推模型呈现——任意桥状态迁移即强制推送 state。
  private ensureBridgeSession(): AgentBridgeSession {
    if (!this.bridgeSession) {
      this.bridgeSession = new AgentBridgeSession(
        {
          addConsumer: consumer => this.addConsumer(consumer),
          removeConsumer: id => this.removeConsumer(id)
        },
        {
          // 页内推模型（postState）+ 全局状态栏刷新（状态栏解析为确定性重算，
          // 无需事件携带面板身份）。
          onChange: () => {
            this.postState(true);
            refreshAgentBridgeStatus();
          },
          onStarted: () => {
            this.postState(true);
            refreshAgentBridgeStatus();
          },
          onFailed: error => {
            refreshAgentBridgeStatus();
            void vscode.window.showErrorMessage(vscode.l10n.t('Failed to start Agent Bridge: {0}', `${error}`));
          }
        },
        false,
        bytes => this.observeOutbound(bytes)
      );
    }
    return this.bridgeSession;
  }

  /** 诊断/集成断言用：当前缓冲快照（含 rx/tx 双向条目）。 */
  public snapshotEntries() {
    return this.buffer.snapshot();
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  private flush(): void {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    const entries = this.buffer.drain(this.pushedSeq);
    const last = entries.at(-1);
    if (last) {
      this.pushedSeq = last.seq;
      const message: AppendMessage = {
        type: 'append',
        entries: entries.map(entry => ({
          seq: entry.seq,
          ts: entry.ts,
          dir: entry.dir,
          bytes: Array.from(entry.bytes)
        }))
      };
      void panel.webview.postMessage(message);
    }
    this.postState(false);
  }

  private postState(force: boolean): void {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    const connection = this.disconnected ? 'closed' : 'connected';
    const truncated = this.buffer.truncated;
    const recording = this.dataRecorder !== undefined;
    const interval = this.intervalTimer !== undefined;
    const file = this.getSendFileProgress();
    const fileIndex = file?.index ?? -1;
    const changed =
      force ||
      connection !== this.lastConnection ||
      truncated !== this.lastTruncated ||
      recording !== this.lastRecording ||
      interval !== this.lastInterval ||
      fileIndex !== this.lastFileIndex;
    if (!changed) {
      return;
    }
    this.lastConnection = connection;
    this.lastTruncated = truncated;
    this.lastRecording = recording;
    this.lastInterval = interval;
    this.lastFileIndex = fileIndex;
    const message: StateMessage = {
      type: 'state',
      connection,
      truncated,
      recording,
      interval,
      file,
      bridge: {
        active: this.isBridgeActive(),
        address: this.getBridgeAddress(),
        readonly: this.getBridgeReadonly(),
        clients: this.getBridgeClients()
      }
    };
    void panel.webview.postMessage(message);
  }

  private onPageMessage(message: unknown): void {
    const msg = message as { type?: string };
    if (!msg || typeof msg.type !== 'string') {
      return;
    }
    if (msg.type === 'ready') {
      // 页（重）加载后重置推送水位：把宿主缓冲现存量整体重发，恢复回看内容。
      this.pushedSeq = 0;
      const init: InitMessage = { type: 'init', path: this.hostPath };
      void this.panel?.webview.postMessage(init);
      this.flush();
      this.postState(true);
      return;
    }
    // 冻结态（已断开）忽略一切发送；ready 握手不涉及发送不受此限。
    if (this.disconnected) {
      return;
    }
    if (msg.type === 'sendText' || msg.type === 'sendHex') {
      const { text, lineEnding } = msg as SendTextMessage;
      if (typeof text !== 'string' || text.length === 0) {
        return;
      }
      const ending: AssistLineEnding = isLineEnding(lineEnding) ? lineEnding : DEFAULT_LINE_ENDING;
      const mode = msg.type === 'sendHex' ? 'hex' : 'text';
      const built = this.buildOutbound(mode, text, ending);
      if ('error' in built) {
        if (built.error !== 'empty') {
          const error: SendErrorMessage = { type: 'sendError', reason: built.error };
          void this.panel?.webview.postMessage(error);
        }
        return;
      }
      this.transmit(built.bytes);
      return;
    }
    if (msg.type === 'recordStop') {
      this.stopDataRecording();
      return;
    }
    if (msg.type === 'bridgeStart') {
      void this.startBridge();
      return;
    }
    if (msg.type === 'bridgeStop') {
      this.stopBridge();
      return;
    }
    if (msg.type === 'copyBridgeAddress') {
      this.copyBridgeAddress();
      return;
    }
    if (msg.type === 'slotSend' || msg.type === 'slotIntervalStart' || msg.type === 'slotIntervalStop') {
      const m = msg as SlotMessage;
      const index = Number(m.index);
      if (!Number.isInteger(index) || index < 1 || index > 8) {
        return;
      }
      const mode = m.mode === 'hex' ? 'hex' : 'text';
      const text = typeof m.text === 'string' ? m.text : '';
      const lineEnding = isLineEnding(m.lineEnding) ? m.lineEnding : DEFAULT_LINE_ENDING;
      if (msg.type === 'slotSend') {
        this.sendSlot(index, { mode, text, lineEnding });
      } else if (msg.type === 'slotIntervalStart') {
        this.startSlotInterval(index, { mode, text, lineEnding, interval: Number(m.interval) || 0 });
      } else {
        this.stopSlotInterval(index);
      }
      return;
    }
    if (msg.type === 'startIntervalSend') {
      const m = msg as IntervalStartMessage;
      this.startIntervalSend({
        mode: m.mode === 'hex' ? 'hex' : 'text',
        text: typeof m.text === 'string' ? m.text : '',
        lineEnding: isLineEnding(m.lineEnding) ? m.lineEnding : DEFAULT_LINE_ENDING,
        interval: Number(m.interval) || 0
      });
      return;
    }
    if (msg.type === 'stopIntervalSend') {
      this.stopIntervalSend();
      return;
    }
    if (msg.type === 'pickSendFile' || msg.type === 'sendFileOnce' || msg.type === 'startFileSend' || msg.type === 'stopFileSend') {
      const m = msg as FileMessage;
      const ending = isLineEnding(m.lineEnding) ? m.lineEnding : DEFAULT_LINE_ENDING;
      if (msg.type === 'pickSendFile') {
        void (async () => {
          const picked = await this.pickSendFile();
          if (!picked) {
            return;
          }
          this.loadSendFile(picked, ending);
          this.postState(true);
        })();
      } else if (msg.type === 'sendFileOnce') {
        void this.sendFileOnce();
      } else if (msg.type === 'startFileSend') {
        this.startFileSend(Number(m.interval) || 0, m.loop === true);
      } else {
        this.stopFileSend();
      }
      return;
    }
    if (msg.type === 'pauseFileSend') {
      this.pauseFileSend();
      return;
    }
    if (msg.type === 'resumeFileSend') {
      this.resumeFileSend();
    }
  }

  /** 发送字节构建：文本模式 = 转义解释 + 行尾符 + UTF-8；HEX 模式 = 解析校验。 */
  private buildOutbound(
    mode: 'text' | 'hex',
    text: string,
    lineEnding: AssistLineEnding
  ): { bytes: Buffer } | { error: 'odd-length' | 'invalid-char' | 'empty' } {
    if (mode === 'hex') {
      const result = parseHexInput(text);
      if (!result.ok) {
        return { error: result.reason };
      }
      if (result.bytes.length === 0) {
        return { error: 'empty' };
      }
      return { bytes: result.bytes };
    }
    const prepared = applyLineEnding(interpretEscapes(text), lineEnding);
    if (prepared.length === 0) {
      return { error: 'empty' };
    }
    return { bytes: Buffer.from(prepared, 'utf-8') };
  }

  private transmit(bytes: Buffer): void {
    // 先记录后发送（TX 时间戳即发送时刻——设计 §5.2）；P1-b 桥客户端字节经
    // 桥回调进入同一漏斗。
    this.dataRecorder?.recordTx(bytes);
    this.buffer.push(bytes, 'tx');
    this.send(bytes);
  }

  private buildHtml(): string {
    const nonce = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    // 界面文案集中在宿主侧 l10n 定值后注入模板（webview 内无 l10n 运行时——
    // 对齐虚拟设备控制台先例；键名见 bundle 双语包）。truncated 模板不带实参
    // 下发，{0} 占位由页内替换。
    const L = {
      connected: vscode.l10n.t('Connected'),
      disconnected: vscode.l10n.t('Disconnected: {0}', this.hostPath),
      displayMode: vscode.l10n.t('Display'),
      modeHex: vscode.l10n.t('HEX'),
      modeAscii: vscode.l10n.t('ASCII'),
      modeMixed: vscode.l10n.t('Mixed'),
      pauseScroll: vscode.l10n.t('Pause scroll'),
      resumeScroll: vscode.l10n.t('Resume scroll'),
      clear: vscode.l10n.t('Clear'),
      startRecording: vscode.l10n.t('Start recording'),
      stopRecording: vscode.l10n.t('Stop recording'),
      startBridge: vscode.l10n.t('Start Agent Bridge'),
      stopBridge: vscode.l10n.t('Stop Agent Bridge'),
      clients: vscode.l10n.t('Clients: {0}'),
      copyHint: vscode.l10n.t('Click to copy the bridge address'),
      sendControl: vscode.l10n.t('Send Control'),
      fileSend: vscode.l10n.t('File send'),
      pickFile: vscode.l10n.t('Pick file'),
      sendFile: vscode.l10n.t('Send file'),
      sendLines: vscode.l10n.t('Send lines'),
      stopLines: vscode.l10n.t('Stop lines'),
      pauseLines: vscode.l10n.t('Pause lines'),
      resumeLines: vscode.l10n.t('Resume lines'),
      sendKey: vscode.l10n.t('Send key'),
      loop: vscode.l10n.t('Loop'),
      stop: vscode.l10n.t('Stop'),
      history: vscode.l10n.t('History'),
      interval: vscode.l10n.t('Interval (ms)'),
      startInterval: vscode.l10n.t('Start interval send'),
      stopInterval: vscode.l10n.t('Stop interval send'),
      empty: vscode.l10n.t('No data yet. Device output and sent bytes will appear here.'),
      truncated: vscode.l10n.t('{0} older entries hidden'),
      sendModeText: vscode.l10n.t('Text'),
      sendModeHex: vscode.l10n.t('HEX'),
      textPlaceholder: vscode.l10n.t('Text to send (supports \\r \\n \\t escapes), Ctrl+Enter to send'),
      hexPlaceholder: vscode.l10n.t('Hex bytes to send, e.g. 55 85 11 94'),
      lineEnding: vscode.l10n.t('Line ending'),
      endingNone: vscode.l10n.t('None'),
      endingCR: vscode.l10n.t('CR'),
      endingLF: vscode.l10n.t('LF'),
      endingCRLF: vscode.l10n.t('CRLF'),
      send: vscode.l10n.t('Send'),
      errOddLength: vscode.l10n.t('Hex input must contain an even number of digits.'),
      errInvalidChar: vscode.l10n.t('Hex input contains invalid characters.'),
    };
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; padding: 8px; gap: 6px; font-size: var(--vscode-font-size); }
#banner { display: none; padding: 6px 10px; border-radius: 6px; background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); }
#banner.show { display: block; }
#toolbar, #bridgebar { display: flex; gap: 6px; align-items: center; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 4px 12px; cursor: pointer; transition: background 0.1s ease, transform 0.05s ease, filter 0.08s ease; }
button:hover { background: var(--vscode-button-hoverBackground); }
button:active { transform: translateY(1px); filter: brightness(0.85); }
button:disabled { opacity: 0.45; cursor: default; transform: none; filter: none; }
select, input, textarea { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 3px 6px; box-sizing: border-box; font-family: inherit; }
select:disabled, input:disabled, textarea:disabled { opacity: 0.45; }
#status.rx { color: var(--vscode-charts-green); }
#status.offline { color: var(--vscode-errorForeground); }
#truncatedNotice { color: var(--vscode-descriptionForeground); margin-left: auto; }
#layout { flex: 1; display: flex; gap: 6px; min-height: 0; }
#leftCol { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.block { border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-editor-background); }
#data { flex: 1; overflow-y: auto; margin: 0; padding: 6px 10px; font-family: var(--vscode-editor-font-family); white-space: pre; line-height: 1.5; min-height: 60px; }
#data .row:hover { background: var(--vscode-list-hoverBackground); }
.row .ts { color: var(--vscode-descriptionForeground); margin-right: 8px; }
.row .dir { font-weight: 600; margin-right: 8px; }
.row.rx .dir { color: var(--vscode-charts-green); }
.row.tx .dir { color: var(--vscode-charts-orange); }
#splitter { flex: none; height: 5px; margin: 2px 0; cursor: row-resize; border-radius: 2px; }
#splitter:hover, #splitter.dragging { background: var(--vscode-focusBorder); }
#sendbar { flex: none; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; padding: 6px 8px; }
#sendInput { flex: 1; padding: 4px 6px; resize: none; min-height: 40px; }
#sendError { color: var(--vscode-errorForeground); }
#ctrlPanel { flex: none; width: 300px; display: flex; flex-direction: column; gap: 8px; padding: 8px; overflow-y: auto; }
#ctrlPanel .panelTitle { font-weight: 600; }
#ctrlPanel .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
#ctrlPanel input[type="number"] { width: 90px; }
#slots { display: flex; flex-direction: column; gap: 6px; }
.slotRow { display: flex; gap: 4px; align-items: center; }
.slotRow input[type="text"] { flex: 1; min-width: 0; padding: 3px 6px; }
.slotRow button { padding: 3px 8px; }
.slotHex { display: flex; align-items: center; gap: 2px; flex: none; }
.slotRow input.invalid, #sendInput.invalid { border-color: var(--vscode-errorForeground); }
.muted { color: var(--vscode-descriptionForeground); }
#bridgeInfo.clickable { cursor: pointer; }
</style>
</head>
<body>
<div id="banner"></div>
<div id="toolbar">
  <span id="status"></span>
  <span class="muted">${L.displayMode}</span>
  <select id="displayMode">
    <option value="mixed">${L.modeMixed}</option>
    <option value="hex">${L.modeHex}</option>
    <option value="ascii">${L.modeAscii}</option>
  </select>
  <button id="btnPause">${L.pauseScroll}</button>
  <button id="btnClear">${L.clear}</button>
  <button id="btnRecord">${L.startRecording}</button>
  <span id="truncatedNotice" class="muted"></span>
</div>
<div id="bridgebar">
  <button id="btnBridge">${L.startBridge}</button>
  <span id="bridgeInfo" class="muted"></span>
</div>
<div id="layout">
  <div id="leftCol">
    <div id="data" class="block"><div class="muted">${L.empty}</div></div>
    <div id="splitter"></div>
    <div id="sendbar" class="block">
      <select id="sendHistory"></select>
      <select id="sendMode">
        <option value="text">${L.sendModeText}</option>
        <option value="hex">${L.sendModeHex}</option>
      </select>
      <textarea id="sendInput" rows="1"></textarea>
      <span class="muted">${L.lineEnding}</span>
      <select id="lineEnding">
        <option value="cr" selected>${L.endingCR}</option>
        <option value="lf">${L.endingLF}</option>
        <option value="crlf">${L.endingCRLF}</option>
        <option value="none">${L.endingNone}</option>
      </select>
      <span class="muted">${L.sendKey}</span>
      <select id="sendKey">
        <option value="enter" selected>Enter</option>
        <option value="shiftEnter">Shift+Enter</option>
      </select>
      <button id="btnSend">${L.send}</button>
      <span id="sendError"></span>
    </div>
  </div>
  <div id="ctrlPanel" class="block">
    <div class="panelTitle">${L.sendControl}</div>
    <div class="panelTitle">${L.fileSend}</div>
    <div class="row">
      <button id="btnPickFile">${L.pickFile}</button>
      <span id="fileName" class="muted"></span>
    </div>
    <div class="row">
      <button id="btnFileOnce">${L.sendFile}</button>
      <button id="btnFileLines">${L.sendLines}</button>
      <button id="btnFileStop">${L.stopLines}</button>
      <label class="slotHex muted"><input type="checkbox" id="fileLoop">${L.loop}</label>
    </div>
    <div id="fileProgress" class="muted"></div>
    <div class="row">
      <span class="muted">${L.interval}</span>
      <input type="number" id="intervalMs" value="1000" min="20" step="100">
      <button id="btnInterval">${L.startInterval}</button>
    </div>
    <div id="slots"></div>
  </div>
</div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const L = ${JSON.stringify(L)};
  const dataEl = document.getElementById('data');
  const bannerEl = document.getElementById('banner');
  const statusEl = document.getElementById('status');
  const noticeEl = document.getElementById('truncatedNotice');
  const sendInput = document.getElementById('sendInput');
  const sendModeEl = document.getElementById('sendMode');
  const lineEndingEl = document.getElementById('lineEnding');
  const sendErrorEl = document.getElementById('sendError');
  const RENDER_LIMIT = ${ASSIST_BUFFER_LIMIT};

  let entries = [];      // { seq, ts, dir, bytes:number[] }——与 DOM 同步裁剪
  let hidden = 0;        // 本地裁剪掉的最旧条数（展示为「已隐藏 N 条」）
  let mode = 'mixed';
  let paused = false;
  let closed = false;
  let recording = false;
  let intervalActive = false;
  let bridge = { active: false, address: undefined, readonly: false, clients: 0 };
  const history = [];   // { mode, text, lineEnding }——发送历史（页内会话态，点击回填）

  const toHex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
  const toAscii = (bytes) => bytes.map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join('');
  const formatBytes = (bytes) => {
    if (mode === 'hex') { return toHex(bytes); }
    if (mode === 'ascii') { return toAscii(bytes); }
    return toHex(bytes) + '  ' + toAscii(bytes);
  };
  const formatTs = (ts) => {
    const d = new Date(ts);
    const pad = (n, w) => String(n).padStart(w || 2, '0');
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
  };

  const makeRow = (entry) => {
    const row = document.createElement('div');
    row.className = 'row ' + entry.dir;
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = formatTs(entry.ts);
    const dir = document.createElement('span');
    dir.className = 'dir';
    dir.textContent = entry.dir.toUpperCase();
    const data = document.createElement('span');
    data.className = 'data';
    data.textContent = entry.bytes.length > 0 ? formatBytes(entry.bytes) : '(no bytes)';
    row.append(ts, dir, data);
    return row;
  };

  const updateNotice = () => {
    noticeEl.textContent = hidden > 0 ? L.truncated.replace('{0}', String(hidden)) : '';
  };

  const refreshRows = () => {
    dataEl.textContent = '';
    for (const entry of entries) {
      dataEl.append(makeRow(entry));
    }
    updateNotice();
  };

  const appendEntries = (list) => {
    if (entries.length === 0) { dataEl.textContent = ''; }
    for (const entry of list) {
      entries.push(entry);
      dataEl.append(makeRow(entry));
    }
    if (entries.length > RENDER_LIMIT) {
      const drop = entries.length - RENDER_LIMIT;
      entries.splice(0, drop);
      hidden += drop;
      refreshRows();
    }
    updateNotice();
    if (!paused) { dataEl.scrollTop = dataEl.scrollHeight; }
  };

  const setStatus = () => {
    if (closed) {
      statusEl.textContent = L.disconnected;
      statusEl.className = 'offline';
      bannerEl.textContent = L.disconnected;
      bannerEl.classList.add('show');
    } else {
      statusEl.textContent = L.connected;
      statusEl.className = 'rx';
    }
  };

  const applyClosed = () => {
    closed = true;
    setStatus();
    sendInput.disabled = true;
    document.getElementById('btnSend').disabled = true;
    document.getElementById('btnRecord').disabled = true;
    document.getElementById('btnBridge').disabled = true;
    document.getElementById('btnInterval').disabled = true;
    document.getElementById('intervalMs').disabled = true;
    document.getElementById('btnPickFile').disabled = true;
    document.getElementById('btnFileOnce').disabled = true;
    document.getElementById('btnFileLines').disabled = true;
    sendModeEl.disabled = true;
    lineEndingEl.disabled = true;
    // 槽面板：全部禁用；循环中的槽按钮文案复位（宿主断开已自动停全部循环）。
    for (let i = 1; i <= SLOT_COUNT; i++) {
      const el = slotEls[i - 1];
      el.input.disabled = true;
      el.hex.disabled = true;
      el.sendBtn.disabled = true;
      el.loopBtn.disabled = true;
      el.loopBtn.textContent = L.loop;
    }
    slotLooping.clear();
  };

  const sendHistoryEl = document.getElementById('sendHistory');
  const sendKeyEl = document.getElementById('sendKey');
  const fileNameEl = document.getElementById('fileName');
  const fileProgressEl = document.getElementById('fileProgress');
  const fileLoopEl = document.getElementById('fileLoop');
  const btnPickFile = document.getElementById('btnPickFile');
  const btnFileOnce = document.getElementById('btnFileOnce');
  const btnFileLines = document.getElementById('btnFileLines');
  const btnFileStop = document.getElementById('btnFileStop');
  let fileLoaded = false;
  let fileActive = false;
  let filePaused = false;
  const pushHistory = (entry) => {
    const last = history[history.length - 1];
    if (last && last.text === entry.text && last.mode === entry.mode) { return; }
    history.push(entry);
    if (history.length > 20) { history.shift(); }
    refreshHistory();
  };
  const refreshHistory = () => {
    sendHistoryEl.textContent = '';
    const label = document.createElement('option');
    label.value = '';
    label.textContent = L.history + ' (' + history.length + ')';
    sendHistoryEl.append(label);
    history.forEach((h, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = (h.mode === 'hex' ? '[HEX] ' : '') + h.text.slice(0, 40);
      sendHistoryEl.append(opt);
    });
  };
  refreshHistory();
  sendHistoryEl.addEventListener('change', () => {
    const index = Number(sendHistoryEl.value);
    const picked = history[index];
    if (!picked) { return; }
    sendModeEl.value = picked.mode === 'hex' ? 'hex' : 'text';
    sendModeEl.dispatchEvent(new Event('change'));
    sendInput.value = picked.text;
    lineEndingEl.value = picked.lineEnding || 'cr';
    sendHistoryEl.value = '';
  });

  const doSend = () => {
    const text = sendInput.value;
    if (!text || closed) { return; }
    const hex = sendModeEl.value === 'hex';
    if (hex) {
      // HEX 客户端预校验（与宿主 parseHexInput 同规则）：合法才发送并计入历史，
      // 非法标红输入框且不入历史。
      const clean = text.replace(/\s+/g, '');
      if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
        sendInput.classList.add('invalid');
        return;
      }
    }
    const entry = { mode: hex ? 'hex' : 'text', text, lineEnding: lineEndingEl.value };
    vscode.postMessage(hex ? { type: 'sendHex', text } : { type: 'sendText', text, lineEnding: lineEndingEl.value });
    pushHistory(entry);
    sendInput.value = '';
    sendInput.classList.remove('invalid');
  };
  document.getElementById('btnSend').addEventListener('click', doSend);
  // 发送快捷键可选（Enter 或 Shift+Enter——另一组合插入换行）；Ctrl+Enter 恒发送。
  sendInput.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.key === 'Enter') {
      doSend();
      return;
    }
    if (ev.key === 'Enter') {
      const shiftSends = sendKeyEl.value === 'shiftEnter';
      if (ev.shiftKey === shiftSends) {
        ev.preventDefault();
        doSend();
      }
      // 另一组合保持默认行为（textarea 插入换行）
    }
  });
  sendModeEl.addEventListener('change', () => {
    const hex = sendModeEl.value === 'hex';
    sendInput.placeholder = hex ? L.hexPlaceholder : L.textPlaceholder;
    lineEndingEl.disabled = hex || closed;
    sendErrorEl.textContent = '';
  });
  sendInput.placeholder = L.textPlaceholder;
  document.getElementById('displayMode').addEventListener('change', (ev) => {
    mode = ev.target.value;
    refreshRows();
    if (!paused) { dataEl.scrollTop = dataEl.scrollHeight; }
  });
  document.getElementById('btnPause').addEventListener('click', (ev) => {
    paused = !paused;
    ev.target.textContent = paused ? L.resumeScroll : L.pauseScroll;
  });
  document.getElementById('btnClear').addEventListener('click', () => {
    entries = [];
    hidden = 0;
    dataEl.textContent = '';
    updateNotice();
  });
  const recordBtn = document.getElementById('btnRecord');
  recordBtn.addEventListener('click', () => {
    if (closed) { return; }
    vscode.postMessage({ type: recording ? 'recordStop' : 'recordStart' });
  });
  const applyRecording = (value) => {
    recording = value;
    recordBtn.textContent = recording ? L.stopRecording : L.startRecording;
  };

  const intervalBtn = document.getElementById('btnInterval');
  const intervalInput = document.getElementById('intervalMs');
  const applyInterval = (value) => {
    intervalActive = value === true;
    intervalBtn.textContent = intervalActive ? L.stopInterval : L.startInterval;
    intervalInput.disabled = intervalActive || closed;
  };

  // 文件发送（P2-c）：文件内容驻留宿主（装载后的行表），页面只显示文件名与
  // 进度；循环勾选 = 逐行 EOF 后循环（文件周期发送）。逐行三态按钮：
  // 空闲 → 开始；播放中 → 暂停；暂停中 → 继续；停止按钮 = 复位重头。
  const applyFile = (info) => {
    fileLoaded = !!info;
    fileActive = fileLoaded && info.active === true;
    filePaused = fileLoaded && info.paused === true;
    fileNameEl.textContent = info ? info.name : '';
    btnFileOnce.disabled = closed || !fileLoaded;
    const playing = fileActive || filePaused;
    btnFileLines.disabled = closed || !fileLoaded;
    btnFileStop.disabled = closed || !playing;
    btnFileLines.textContent = fileActive ? L.pauseLines : filePaused ? L.resumeLines : L.sendLines;
    fileProgressEl.textContent = info && info.total > 0 ? info.index + '/' + info.total : '';
  };
  btnPickFile.addEventListener('click', () => {
    if (closed) { return; }
    vscode.postMessage({ type: 'pickSendFile', lineEnding: lineEndingEl.value });
  });
  btnFileOnce.addEventListener('click', () => {
    if (!closed && fileLoaded) { vscode.postMessage({ type: 'sendFileOnce' }); }
  });
  btnFileLines.addEventListener('click', () => {
    if (closed || !fileLoaded) { return; }
    if (fileActive) {
      vscode.postMessage({ type: 'pauseFileSend' });
    } else if (filePaused) {
      vscode.postMessage({ type: 'resumeFileSend' });
    } else {
      vscode.postMessage({
        type: 'startFileSend',
        interval: Number(intervalInput.value) || 0,
        loop: fileLoopEl.checked
      });
    }
  });
  btnFileStop.addEventListener('click', () => {
    if (closed || !fileLoaded) { return; }
    vscode.postMessage({ type: 'stopFileSend' });
  });

  // 推拉分隔条：拖拽分配回显区与发送栏的高度（控制面板宽度不受影响）；
  // Pointer Capture 保证拖出边界不丢 move/up 事件。
  const splitter = document.getElementById('splitter');
  const sendbarEl = document.getElementById('sendbar');
  splitter.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    const startY = ev.clientY;
    const startHeight = sendbarEl.getBoundingClientRect().height;
    splitter.classList.add('dragging');
    splitter.setPointerCapture(ev.pointerId);
    const onMove = (e) => {
      const height = Math.max(44, Math.min(window.innerHeight - 220, startHeight + (startY - e.clientY)));
      sendbarEl.style.height = height + 'px';
      sendbarEl.style.flex = 'none';
    };
    const onUp = () => {
      splitter.classList.remove('dragging');
      splitter.removeEventListener('pointermove', onMove);
      splitter.removeEventListener('pointerup', onUp);
    };
    splitter.addEventListener('pointermove', onMove);
    splitter.addEventListener('pointerup', onUp);
  });

  // 槽发送面板（P2-b）：8 槽——HEX 勾选 + 输入 + 单发（不清框）+ 循环开关
  //（共享间隔 = 顶部 Interval 输入）；槽内容驻留页面（会话态，刷新即失）。
  const SLOT_COUNT = 8;
  const slotsEl = document.getElementById('slots');
  const slotEls = [];
  const slotLooping = new Set();
  const markSlotInvalid = (i) => {
    slotEls[i - 1].input.classList.add('invalid');
  };
  const buildSlotPost = (i) => {
    const el = slotEls[i - 1];
    const text = el.input.value;
    if (!text) { return undefined; }
    const hex = el.hex.checked;
    if (hex) {
      const clean = text.replace(/\s+/g, '');
      if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
        return undefined;
      }
    }
    return { mode: hex ? 'hex' : 'text', text, lineEnding: lineEndingEl.value };
  };
  const sendSlot = (i) => {
    const post = buildSlotPost(i);
    if (!post) { markSlotInvalid(i); return; }
    vscode.postMessage({ type: 'slotSend', index: i, ...post });
  };
  const toggleSlotLoop = (i) => {
    if (closed) { return; }
    if (slotLooping.has(i)) {
      slotLooping.delete(i);
      slotEls[i - 1].loopBtn.textContent = L.loop;
      vscode.postMessage({ type: 'slotIntervalStop', index: i });
      return;
    }
    const post = buildSlotPost(i);
    if (!post) { markSlotInvalid(i); return; }
    slotLooping.add(i);
    slotEls[i - 1].loopBtn.textContent = L.stop;
    vscode.postMessage({ type: 'slotIntervalStart', index: i, interval: Number(intervalInput.value) || 0, ...post });
  };
  for (let i = 1; i <= SLOT_COUNT; i++) {
    const row = document.createElement('div');
    row.className = 'slotRow';
    const hexWrap = document.createElement('label');
    hexWrap.className = 'slotHex muted';
    hexWrap.title = L.modeHex;
    const hex = document.createElement('input');
    hex.type = 'checkbox';
    hexWrap.append(hex, document.createTextNode('HEX'));
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '#' + i;
    const sendBtn = document.createElement('button');
    sendBtn.textContent = L.send;
    const loopBtn = document.createElement('button');
    loopBtn.className = 'secondary';
    loopBtn.textContent = L.loop;
    loopBtn.title = L.interval;
    row.append(hexWrap, input, sendBtn, loopBtn);
    slotsEl.append(row);
    slotEls.push({ input, hex, loopBtn });
    const doSend = () => { if (!closed) { sendSlot(i); } };
    sendBtn.addEventListener('click', doSend);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { doSend(); }
    });
    input.addEventListener('input', () => input.classList.remove('invalid'));
    loopBtn.addEventListener('click', () => toggleSlotLoop(i));
  }

  const bridgeBtn = document.getElementById('btnBridge');
  const bridgeInfo = document.getElementById('bridgeInfo');
  const renderBridge = () => {
    bridgeBtn.textContent = bridge.active ? L.stopBridge : L.startBridge;
    if (!bridge.active) {
      bridgeInfo.textContent = '';
      bridgeInfo.title = '';
      bridgeInfo.classList.remove('clickable');
      return;
    }
    const ro = bridge.readonly ? ' (read-only)' : '';
    const clients = bridge.clients > 0 ? ' · ' + L.clients.replace('{0}', String(bridge.clients)) : '';
    bridgeInfo.textContent = 'AgentBridge ' + bridge.address + ro + clients;
    bridgeInfo.title = L.copyHint;
    bridgeInfo.classList.add('clickable');
  };
  bridgeBtn.addEventListener('click', () => {
    if (closed) { return; }
    vscode.postMessage({ type: bridge.active ? 'bridgeStop' : 'bridgeStart' });
  });
  bridgeInfo.addEventListener('click', () => {
    if (bridge.active) { vscode.postMessage({ type: 'copyBridgeAddress' }); }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || !message.type) { return; }
    if (message.type === 'append') {
      appendEntries(message.entries);
    } else if (message.type === 'state') {
      applyRecording(message.recording === true);
      applyInterval(message.interval === true);
      applyFile(message.file);
      if (message.bridge && typeof message.bridge === 'object') {
        bridge = message.bridge;
        renderBridge();
      }
      if (message.connection === 'closed' && !closed) {
        applyClosed();
      } else if (!closed) {
        setStatus();
      }
    } else if (message.type === 'sendError') {
      sendErrorEl.textContent = message.reason === 'odd-length' ? L.errOddLength : L.errInvalidChar;
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
  }
}

