import * as vscode from 'vscode';
import { SerialPortConsumer, SerialPortConsumerHost } from '../../SerialPortConnection/SerialPortConsumer';
import { buildLogFilePath } from '../SerialPortLogFiles';
import { ASSIST_BUFFER_LIMIT, SerialPortAssistBuffer } from './SerialPortAssistBuffer';
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
}

interface SendErrorMessage {
  type: 'sendError';
  reason: 'odd-length' | 'invalid-char';
}

interface InitMessage {
  type: 'init';
  path: string;
}

// 页 → 宿主上行消息：P0 发送 + P1 记录开关（桥控制随 P1-b 追加）；显示模式 /
// 清屏 / 暂停滚动为页内行为，不经协议（设计 §5.1）。
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

const FLUSH_INTERVAL_MS = 100;

export class SerialPortAssist extends SerialPortConsumer {
  readonly id = 'serialPortAssist';
  readonly displayName = 'Serial Port Assist';

  private panel: vscode.WebviewPanel | undefined;
  private readonly buffer = new SerialPortAssistBuffer();
  private dataRecorder: SerialPortDataRecorder | undefined;
  private hostPath = '';
  private disconnected = false;
  // 100ms 批刷：seq 已推送水位 + 变更检测（无增量且状态未变时零 postMessage）。
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private pushedSeq = 0;
  private lastTruncated = -1;
  private lastConnection: 'connected' | 'closed' | undefined;
  private lastRecording = false;

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
    // 记录器随 Connection 收尾链拿到 onClosed（关流 + 「已保存」提示），此处
    // 仅清引用；把缓冲内尚未推送的条目与「已断开」状态推完（面板保留可回看
    // ——对齐 Terminal 断开不销毁视图的关闭行为约定），随后停批刷。
    this.dataRecorder = undefined;
    this.flush();
    this.postState(true);
    this.stopFlushTimer();
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
    if (!force && connection === this.lastConnection && truncated === this.lastTruncated) {
      return;
    }
    this.lastConnection = connection;
    this.lastTruncated = truncated;
    const recording = this.dataRecorder !== undefined;
    const changed =
      force ||
      connection !== this.lastConnection ||
      truncated !== this.lastTruncated ||
      recording !== this.lastRecording;
    if (!changed) {
      return;
    }
    this.lastRecording = recording;
    const message: StateMessage = { type: 'state', connection, truncated, recording };
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
    if (msg.type === 'sendText') {
      const { text, lineEnding } = msg as SendTextMessage;
      if (typeof text !== 'string' || text.length === 0) {
        return;
      }
      const ending: AssistLineEnding = isLineEnding(lineEnding) ? lineEnding : DEFAULT_LINE_ENDING;
      this.transmit(Buffer.from(applyLineEnding(interpretEscapes(text), ending), 'utf-8'));
      return;
    }
    if (msg.type === 'sendHex') {
      const { text } = msg as SendHexMessage;
      const result = parseHexInput(typeof text === 'string' ? text : '');
      if (!result.ok) {
        const error: SendErrorMessage = { type: 'sendError', reason: result.reason };
        void this.panel?.webview.postMessage(error);
        return;
      }
      if (result.bytes.length > 0) {
        this.transmit(result.bytes);
      }
      return;
    }
    if (msg.type === 'recordStart') {
      this.startDataRecording();
      return;
    }
    if (msg.type === 'recordStop') {
      this.stopDataRecording();
    }
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
<div id="data"><div class="muted">${L.empty}</div></div>
<div id="sendbar">
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
    sendModeEl.disabled = true;
    lineEndingEl.disabled = true;
  };

  document.getElementById('btnSend').addEventListener('click', () => {
    const text = sendInput.value;
    if (!text || closed) { return; }
    if (sendModeEl.value === 'hex') {
      vscode.postMessage({ type: 'sendHex', text });
    } else {
      vscode.postMessage({ type: 'sendText', text, lineEnding: lineEndingEl.value });
      sendInput.value = '';
    }
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

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || !message.type) { return; }
    if (message.type === 'append') {
      appendEntries(message.entries);
    } else if (message.type === 'state') {
      applyRecording(message.recording === true);
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

