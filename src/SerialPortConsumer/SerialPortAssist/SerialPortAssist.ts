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

export interface IntervalSendOptions {
  mode: 'text' | 'hex';
  text: string;
  lineEnding: AssistLineEnding;
  interval: number;
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
    const changed =
      force ||
      connection !== this.lastConnection ||
      truncated !== this.lastTruncated ||
      recording !== this.lastRecording ||
      interval !== this.lastInterval;
    if (!changed) {
      return;
    }
    this.lastConnection = connection;
    this.lastTruncated = truncated;
    this.lastRecording = recording;
    this.lastInterval = interval;
    const message: StateMessage = {
      type: 'state',
      connection,
      truncated,
      recording,
      interval,
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
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; display: flex; flex-direction: column; height: 100vh; font-size: var(--vscode-font-size); }
#banner { display: none; padding: 6px 10px; background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-inputValidation-errorForeground); }
#banner.show { display: block; }
#toolbar { display: flex; gap: 6px; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
#status.rx { color: var(--vscode-charts-green); }
#status.offline { color: var(--vscode-errorForeground); }
#truncatedNotice { color: var(--vscode-descriptionForeground); }
#data { flex: 1; overflow-y: auto; margin: 0; padding: 6px 10px; font-family: var(--vscode-editor-font-family); white-space: pre; line-height: 1.5; }
.row .ts { color: var(--vscode-descriptionForeground); margin-right: 8px; }
.row .dir { font-weight: 600; margin-right: 8px; }
.row.rx .dir { color: var(--vscode-charts-green); }
.row.tx .dir { color: var(--vscode-charts-orange); }
#sendbar { display: flex; gap: 6px; align-items: center; padding: 6px 8px; border-top: 1px solid var(--vscode-panel-border); }
#sendInput { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 6px; }
#sendbar button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 14px; cursor: pointer; }
#sendbar button:hover { background: var(--vscode-button-hoverBackground); }
#sendbar button:disabled { opacity: 0.5; cursor: default; }
select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-input-border); padding: 3px 5px; }
select:disabled { opacity: 0.5; }
.muted { color: var(--vscode-descriptionForeground); }
#sendError { color: var(--vscode-errorForeground); }
#bridgebar { display: flex; gap: 6px; align-items: center; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
#bridgeInfo.clickable { cursor: pointer; }
#intervalbar { display: flex; gap: 6px; align-items: center; padding: 4px 8px; border-top: 1px solid var(--vscode-panel-border); }
#intervalMs { width: 90px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 3px 5px; }
label { margin-left: 4px; }
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
<div id="data"><div class="muted">${L.empty}</div></div>
<div id="sendbar">
  <select id="sendHistory"></select>
  <select id="sendMode">
    <option value="text">${L.sendModeText}</option>
    <option value="hex">${L.sendModeHex}</option>
  </select>
  <input id="sendInput">
  <span class="muted">${L.lineEnding}</span>
  <select id="lineEnding">
    <option value="cr" selected>${L.endingCR}</option>
    <option value="lf">${L.endingLF}</option>
    <option value="crlf">${L.endingCRLF}</option>
    <option value="none">${L.endingNone}</option>
  </select>
  <button id="btnSend">${L.send}</button>
  <span id="sendError"></span>
</div>
<div id="intervalbar">
  <span class="muted">${L.interval}</span>
  <input type="number" id="intervalMs" value="1000" min="20" step="100">
  <button id="btnInterval">${L.startInterval}</button>
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
    sendModeEl.disabled = true;
    lineEndingEl.disabled = true;
  };

  const sendHistoryEl = document.getElementById('sendHistory');
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

  document.getElementById('btnSend').addEventListener('click', () => {
    const text = sendInput.value;
    if (!text || closed) { return; }
    const hex = sendModeEl.value === 'hex';
    if (hex) {
      // HEX 客户端预校验（与宿主 parseHexInput 同规则）：合法才发送并计入历史，
      // 非法交由宿主 sendError 提示且不入历史。
      const clean = text.replace(/\s+/g, '');
      if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
        return;
      }
    }
    const entry = { mode: hex ? 'hex' : 'text', text, lineEnding: lineEndingEl.value };
    vscode.postMessage(hex ? { type: 'sendHex', text } : { type: 'sendText', text, lineEnding: lineEndingEl.value });
    pushHistory(entry);
    sendInput.value = '';
  });
  sendInput.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.key === 'Enter') {
      document.getElementById('btnSend').click();
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
  intervalBtn.addEventListener('click', () => {
    if (closed) { return; }
    if (intervalActive) {
      vscode.postMessage({ type: 'stopIntervalSend' });
      return;
    }
    const text = sendInput.value;
    if (!text) { return; }
    vscode.postMessage({
      type: 'startIntervalSend',
      mode: sendModeEl.value === 'hex' ? 'hex' : 'text',
      text,
      lineEnding: lineEndingEl.value,
      interval: Number(intervalInput.value) || 0
    });
  });

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

