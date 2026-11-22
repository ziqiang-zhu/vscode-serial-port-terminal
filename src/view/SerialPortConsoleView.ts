import * as vscode from 'vscode';
import { SerialPortHalVirtual, VirtualConsoleEntry } from '../hal/SerialPortHalVirtual/SerialPortHalVirtual';

export const SERIAL_PORT_CONSOLE_VIEW_ID = 'serialPortConsole';

interface ConsoleStateMessage {
  type: 'state';
  mode: 'ready' | 'unavailable';
  selected?: string;
  entries?: VirtualConsoleEntry[];
}

interface ConsoleCommand {
  type:
    | 'select'
    | 'setOnline'
    | 'setBackpressure'
    | 'setDelay'
    | 'setRate'
    | 'setLoop'
    | 'play'
    | 'pause'
    | 'stop'
    | 'pickReplayFile'
    | 'clearReplayFile'
    | 'pickInteractionDir'
    | 'inject';
  path?: string;
  value?: unknown;
  text?: string;
}

// 虚拟设备控制台（契约见 doc/Hal/SerialPortHalVirtual规划.md §8、§10.4）：
// 全部虚拟设备共享一个控制台，仅通用控制操作；生产构建注册提供器但页面渲染占位
//（WebviewView 必须静态声明且注册，否则向用户显示错误占位）。
export class SerialPortConsoleView implements vscode.WebviewViewProvider {
  public static readonly viewId = SERIAL_PORT_CONSOLE_VIEW_ID;
  private view?: vscode.WebviewView;
  private selected: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly virtualHal: SerialPortHalVirtual | undefined) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage(
      message => void this.onMessage(message as ConsoleCommand),
      undefined,
      this.disposables
    );
    view.webview.html = this.html(view.webview);
    void this.pushState();
  }

  dispose(): void {
    for (const item of this.disposables.splice(0)) {
      item.dispose();
    }
  }

  private async onMessage(message: ConsoleCommand): Promise<void> {
    const hal = this.virtualHal;
    const path = message.path ?? this.selected;
    switch (message.type) {
      case 'select':
        this.selected = message.path;
        break;
      case 'setOnline':
        if (hal && path) {
          hal.setOnline(path, message.value === true);
        }
        break;
      case 'setBackpressure':
        if (hal && path) {
          hal.setBackpressure(path, message.value === true);
        }
        break;
      case 'setDelay':
        if (hal && path) {
          hal.setDelay(path, Number(message.value) || 0);
        }
        break;
      case 'setRate':
        if (hal && path) {
          hal.setRate(path, Math.max(1, Number(message.value) || 1));
        }
        break;
      case 'setLoop':
        if (hal && path) {
          hal.setLoop(path, message.value === true);
        }
        break;
      case 'play':
        if (hal && path) {
          hal.play(path);
        }
        break;
      case 'pause':
        if (hal && path) {
          hal.pause(path);
        }
        break;
      case 'stop':
        if (hal && path) {
          hal.stop(path);
        }
        break;
      case 'inject':
        if (hal && path && message.text) {
          hal.inject(path, Buffer.from(message.text, 'utf8'));
        }
        break;
      case 'pickReplayFile': {
        if (!hal || !path) {
          break;
        }
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { Logs: ['log', 'txt'] },
        });
        if (picked?.[0]) {
          hal.setReplayFile(path, picked[0].fsPath);
        }
        break;
      }
      case 'clearReplayFile': {
        if (hal && path) {
          hal.setReplayFile(path, '');
        }
        break;
      }
      case 'pickInteractionDir': {
        if (!hal || !path) {
          break;
        }
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          canSelectFolders: true,
        });
        if (picked?.[0]) {
          hal.setInteractionDir(path, picked[0].fsPath);
        }
        break;
      }
    }
    void this.pushState();
  }

  private async pushState(): Promise<void> {
    const view = this.view;
    if (!view) {
      return;
    }
    if (!this.virtualHal) {
      await view.webview.postMessage({
        type: 'state',
        mode: 'unavailable',
      } satisfies ConsoleStateMessage);
      return;
    }
    const message: ConsoleStateMessage = {
      type: 'state',
      mode: 'ready',
      entries: this.virtualHal.getConsoleEntries(),
      ...(this.selected !== undefined ? { selected: this.selected } : {}),
    };
    await view.webview.postMessage(message);
  }

  private html(webview: vscode.Webview): string {
    const nonce = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    // 界面文案集中在宿主侧 l10n 定值后注入模板（webview 内无 l10n 运行时）；
    // 脚本内经 JSON 序列化整体下发为 JS 对象，键名见 bundle 双语包。
    const L = {
      loading: vscode.l10n.t('Loading…'),
      testBuildOnly: vscode.l10n.t('The virtual device console is only available in test builds (USE_VIRTUAL_HAL).'),
      noDevices: vscode.l10n.t('No virtual devices.'),
      targetDevice: vscode.l10n.t('Target device'),
      bringOnline: vscode.l10n.t('Bring online'),
      unplug: vscode.l10n.t('Unplug'),
      backpressureOpen: vscode.l10n.t('Backpressure: release'),
      backpressureHold: vscode.l10n.t('Backpressure: hold'),
      responseDelay: vscode.l10n.t('Response delay (ms)'),
      applyDelay: vscode.l10n.t('Apply delay'),
      injectData: vscode.l10n.t('Inject data (device-side output)'),
      inject: vscode.l10n.t('Inject'),
      replayFile: vscode.l10n.t('Replay file'),
      selectLogFile: vscode.l10n.t('Select log file'),
      clearSelection: vscode.l10n.t('Clear selection'),
      autoStart: vscode.l10n.t('Playback starts automatically once the device is connected'),
      pause: vscode.l10n.t('Pause'),
      stop: vscode.l10n.t('Stop'),
      resume: vscode.l10n.t('Resume'),
      startPlayback: vscode.l10n.t('Start playback'),
      replayRate: vscode.l10n.t('Replay rate (lines/s)'),
      applyRate: vscode.l10n.t('Apply rate'),
      loop: vscode.l10n.t('Loop'),
      loopOn: vscode.l10n.t('Loop: on'),
      loopOff: vscode.l10n.t('Loop: off'),
      responseDir: vscode.l10n.t('Response directory (linux/ and uboot/ subfolders)'),
      selectResponseDir: vscode.l10n.t('Select response directory'),
    };
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px; font-size: var(--vscode-font-size); }
select, input[type="text"], input[type="number"], textarea { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 3px 5px; margin: 2px 0; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 3px 10px; margin: 3px 3px 3px 0; cursor: pointer; transition: background 0.1s ease, transform 0.05s ease, filter 0.05s ease; }
button:hover { background: var(--vscode-button-hoverBackground); }
button:active { background: var(--vscode-button-hoverBackground); transform: translateY(1px); filter: brightness(0.88); }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.row { margin: 6px 0; }
label { display: block; margin-top: 8px; }
.muted { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<div id="root"><div class="muted">${L.loading}</div></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const L = ${JSON.stringify(L)};
  const root = document.getElementById('root');
  let state = { mode: 'unavailable', selected: undefined, entries: [] };

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // webview → 扩展主进程：全部控件交互经此上行（onDidReceiveMessage 处理后回推 state）。
  const post = (message) => vscode.postMessage(message);

  function wire(entry) {
    const on = (id, event, fn) => {
      const el = document.getElementById(id);
      if (el) { el.addEventListener(event, fn); }
    };
    on('sel', 'change', (ev) => post({ type: 'select', path: ev.target.value }));
    on('btnOnline', 'click', () => post({ type: 'setOnline', path: entry.path, value: !entry.online }));
    on('btnBp', 'click', () => post({ type: 'setBackpressure', path: entry.path, value: !entry.backpressure }));
    on('btnDelay', 'click', () => post({ type: 'setDelay', path: entry.path, value: document.getElementById('delay').value }));
    on('btnInject', 'click', () => {
      const box = document.getElementById('inject');
      if (box.value) { post({ type: 'inject', path: entry.path, text: box.value }); box.value = ''; }
    });
    on('btnRate', 'click', () => post({ type: 'setRate', path: entry.path, value: document.getElementById('rate').value }));
    on('btnLoop', 'click', () => post({ type: 'setLoop', path: entry.path, value: !entry.loop }));
    on('btnReplayFile', 'click', () => post({ type: 'pickReplayFile', path: entry.path }));
    on('btnClearReplayFile', 'click', () => post({ type: 'clearReplayFile', path: entry.path }));
    on('btnPlay', 'click', () => post({ type: 'play', path: entry.path }));
    on('btnPause', 'click', () => post({ type: 'pause', path: entry.path }));
    on('btnResume', 'click', () => post({ type: 'play', path: entry.path }));
    on('btnStop', 'click', () => post({ type: 'stop', path: entry.path }));
    on('btnInteractionDir', 'click', () => post({ type: 'pickInteractionDir', path: entry.path }));
  }

  function render() {
    if (state.mode === 'unavailable') {
      root.innerHTML = '<div class="muted">' + L.testBuildOnly + '</div>';
      return;
    }
    const entry = state.entries.find((e) => e.path === state.selected) || state.entries[0];
    if (!entry) {
      root.innerHTML = '<div class="muted">' + L.noDevices + '</div>';
      return;
    }
    state.selected = entry.path;
    const options = state.entries
      .map((e) => '<option value="' + esc(e.path) + '"' + (e.path === entry.path ? ' selected' : '') + '>' + esc(e.path) + '</option>')
      .join('');
    let replayControls = '';
    if (entry.kind === 'replay') {
      // 文件区：未选 → 选择入口；已选 → 只显示路径 + 取消选择（禁止直接换文件）。
      const filePart = entry.file
        ? '<label>' + L.replayFile + '</label><div><span class="muted">' + esc(entry.file) + '</span>'
          + ' <button id="btnClearReplayFile" class="muted">' + L.clearSelection + '</button></div>'
        : '<label>' + L.replayFile + '</label><div><button id="btnReplayFile" class="muted">' + L.selectLogFile + '</button></div>';
      // 播放区：状态机按钮组（未连接且已选文件 → 提示连接后自动播放）。
      let playPart = '';
      if (entry.file) {
        if (!entry.connected) {
          playPart = '<div class="muted">' + L.autoStart + '</div>';
        } else if (entry.playback === 'playing') {
          playPart = '<button id="btnPause">' + L.pause + '</button><button id="btnStop">' + L.stop + '</button>';
        } else if (entry.playback === 'paused') {
          playPart = '<button id="btnResume">' + L.resume + '</button><button id="btnStop">' + L.stop + '</button>';
        } else {
          playPart = '<button id="btnPlay">' + L.startPlayback + '</button>';
        }
      }
      replayControls = filePart + playPart
        + '<label>' + L.replayRate + '</label><input type="number" id="rate" min="1" value="' + esc(entry.rate ?? 100) + '"><button id="btnRate">' + L.applyRate + '</button>'
        + '<label>' + L.loop + '</label><button id="btnLoop">' + (entry.loop ? L.loopOn : L.loopOff) + '</button>';
    }
    const interactionControls = entry.kind === 'linux' || entry.kind === 'uboot'
      ? '<label>' + L.responseDir + '</label><div><button id="btnInteractionDir" class="muted">' + L.selectResponseDir + '</button></div>'
      : '';
    root.innerHTML =
      '<label>' + L.targetDevice + '</label><select id="sel">' + options + '</select>'
      + '<div class="row"><button id="btnOnline">' + (entry.online ? L.unplug : L.bringOnline) + '</button>'
      + '<button id="btnBp">' + (entry.backpressure ? L.backpressureOpen : L.backpressureHold) + '</button></div>'
      + '<label>' + L.responseDelay + '</label><input type="number" id="delay" min="0" value="' + esc(entry.delayMs) + '"><button id="btnDelay">' + L.applyDelay + '</button>'
      + '<label>' + L.injectData + '</label><textarea id="inject" rows="3"></textarea><button id="btnInject">' + L.inject + '</button>'
      + replayControls
      + interactionControls;
    wire(entry);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'state') {
      state = message;
      render();
    }
  });
  render();
})();
</script>
</body>
</html>`;
  }
}

// 注册控制台视图（生产构建同样注册：页面渲染「仅在测试构建可用」占位）。
export function registerVirtualDeviceConsole(
  context: vscode.ExtensionContext,
  virtualHal: SerialPortHalVirtual | undefined
): vscode.Disposable[] {
  const provider = new SerialPortConsoleView(virtualHal);
  const registration = vscode.window.registerWebviewViewProvider(
    SerialPortConsoleView.viewId,
    provider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );
  context.subscriptions.push(registration, provider);
  return [registration];
}
