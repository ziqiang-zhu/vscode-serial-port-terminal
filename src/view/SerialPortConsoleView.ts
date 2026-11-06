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
    | 'inject'
    | 'pickReplayFile'
    | 'pickInteractionDir';
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
          void this.persist('replayFile', picked[0].fsPath);
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
          void this.persist('interactionDir', picked[0].fsPath);
        }
        break;
      }
    }
    void this.pushState();
  }

  // 文件 / 目录选择入口同时写 workspace 设置（跨会话保留）；live 生效走控制面 API。
  private persist(key: 'replayFile' | 'interactionDir', value: string): Thenable<void> {
    return vscode.workspace
      .getConfiguration('serialPortTerminal.testMode')
      .update(key, value, vscode.ConfigurationTarget.Workspace);
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
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 8px; font-size: var(--vscode-font-size); }
select, input[type="text"], input[type="number"], textarea { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 3px 5px; margin: 2px 0; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 3px 10px; margin: 3px 3px 3px 0; cursor: pointer; }
.row { margin: 6px 0; }
label { display: block; margin-top: 8px; }
.muted { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<div id="root"><div class="muted">Loading…</div></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('root');
  let state = { mode: 'unavailable', selected: undefined, entries: [] };

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
    on('btnInteractionDir', 'click', () => post({ type: 'pickInteractionDir', path: entry.path }));
  }

  function render() {
    if (state.mode === 'unavailable') {
      root.innerHTML = '<div class="muted">虚拟设备控制台仅在测试构建（USE_VIRTUAL_HAL）中可用。</div>';
      return;
    }
    const entry = state.entries.find((e) => e.path === state.selected) || state.entries[0];
    if (!entry) {
      root.innerHTML = '<div class="muted">无虚拟设备。</div>';
      return;
    }
    state.selected = entry.path;
    const options = state.entries
      .map((e) => '<option value="' + esc(e.path) + '"' + (e.path === entry.path ? ' selected' : '') + '>' + esc(e.path) + '</option>')
      .join('');
    const replayControls = entry.kind === 'replay'
      ? '<label>回放速率（行/秒）</label><input type="number" id="rate" min="1" value="' + esc(entry.rate ?? 100) + '"><button id="btnRate">应用速率</button>'
        + '<label>回放文件</label><div><button id="btnReplayFile" class="muted">选择日志文件</button> <span class="muted">' + esc(entry.file || '未配置') + '</span></div>'
        + '<label>循环回放</label><button id="btnLoop">' + (entry.loop ? '循环：开' : '循环：关') + '</button>'
      : '';
    const interactionControls = entry.kind === 'linux' || entry.kind === 'uboot'
      ? '<label>应答目录（linux/ 与 uboot/ 子目录）</label><div><button id="btnInteractionDir" class="muted">选择应答目录</button></div>'
      : '';
    root.innerHTML =
      '<label>目标设备</label><select id="sel">' + options + '</select>'
      + '<div class="row"><button id="btnOnline">' + (entry.online ? '拔出设备' : '上线设备') + '</button>'
      + '<button id="btnBp">' + (entry.backpressure ? '背压：放行' : '背压：阻塞') + '</button></div>'
      + '<label>应答延迟（ms）</label><input type="number" id="delay" min="0" value="' + esc(entry.delayMs) + '"><button id="btnDelay">应用延迟</button>'
      + '<label>注入数据（设备侧输出）</label><textarea id="inject" rows="3"></textarea><button id="btnInject">注入</button>'
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
