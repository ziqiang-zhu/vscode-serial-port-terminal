# Serial Port Terminal

**This extension is a VS Code serial port terminal for embedded-system debugging (Debug) and automated testing**.

- Manage serial devices in the sidebar and connect with one click as a serial terminal, providing terminal interaction with embedded systems;
- **AgentBridge** bridges the serial terminal to a local TCP port with one click so an AI agent can access the terminal like a regular user — you and the AI share the same terminal screen: every step it takes is visible in real time, loggable, and you can take over at any moment.

<table width="100%"><tr><td>🇨🇳 <a href="https://github.com/ziqiang-zhu/vscode-serial-port-terminal/blob/master/README.md">简体中文</a></td><td align="right"><a href="https://github.com/ziqiang-zhu/vscode-serial-port-terminal/blob/master/doc/总览.md">📚 Documentation Overview</a></td></tr></table>

> **⚠️ Platform support**: the current release supports **Windows x64 only** (the packaged serialport native module keeps only the win32-x64 prebuilt binary). macOS / Linux / ARM are not supported yet.

> **🚨 Security warning — AgentBridge performs no security validation whatsoever**
>
> AgentBridge is an **unauthenticated, unencrypted plain-text TCP channel**: any program or user that can reach the listening address can read and write your serial device without any authentication.
>
> - **Full device exposure**: anyone connected can operate the device like a real terminal and perform **arbitrary actions** — including destructive ones such as deleting files, rewriting configuration, flashing firmware, or bricking the device; neither the extension nor the device side has any interception or confirmation mechanism;
> - **Full data exposure**: everything sent and received over the serial port (including credentials or secret material) is visible to connected parties;
> - **Risk scales with the listening address**: by default it listens on `127.0.0.1` only, limiting exposure to local processes; changing the listening address to an external one (e.g. `0.0.0.0`) lets any host on the network connect directly.
>
> Use it only in a **trusted local environment**: disconnect when done, never leave it enabled for long on production devices or untrusted networks, and change the listening address with care. 
>
>If you only need to **observe** device output (e.g. letting an AI agent read logs), consider enabling the **read-only mode** in settings (`agentBridge.readonly`, off by default) — clients will be unable to send any data to the device.

## ✨ Features

- 🔌 **Device management** — activity bar entry listing system serial devices with manufacturer info, hover details, and connection status
- 🔄 **Hot-plug detection** — periodic scan (configurable interval, can be disabled); devices are added/removed automatically
- 🚦 **Connection status** — disconnected / connecting / connected with visual feedback; failures roll back and show the cause
- 🖥️ **Built-in terminal** — based on the VS Code Pseudoterminal; data is shown as-is, type and press Enter to send
- 📜 **Log kept after disconnect** — the terminal panel stays open so you can review the session; reconnecting opens a new terminal panel
- ⚙️ **Quick configs** — global named connection configs reusable across devices (reference counting); add / rename / remove / reuse, hover for full details
- 🎯 **Quick connection** — highlight the active config, pin the last-used config, direct-connect by selecting a quick-config node
- 🧩 **Manual configuration** — configure parameters on the fly when connecting (baud rate / frame format from settings dropdowns), no presets needed
- 🏷️ **Terminal title with config name** — shows the device path plus the config name (or baud rate)
- 💾 **Log saving** — "Save / Pause / Stop" buttons in the terminal title bar; files are created only when data arrives, names are precise to the second, ANSI escape sequences are stripped, optional per-line timestamps, and stopping notifies the save path; optional `Ctrl+S` shortcut (start/stop, disabled by default)
- 📂 **Open log directory** — a one-click button in the device-list title bar opens the log folder in the system file manager
- 🤖 **AgentBridge (AI interaction)** — one-click in the terminal title bar bridges the serial port to a local TCP port so AI agents can read/write the embedded Linux terminal (multi-client, ANSI-stripped line-buffered forwarding, persistent status-bar port, click to copy), see below
- 🧪 **Virtual devices (optional)** — once "Virtual Device Console" is enabled in settings (off by default; takes effect after restarting the extension host or VS Code), 4 VCOM- virtual devices (Echo / Linux / U-Boot / Replay) appear in the device tree; the sidebar console can plug/unplug devices, inject data, adjust delay and backpressure, and replay log files
- 🌐 **Localization** — English / Simplified Chinese

## 🤖 AgentBridge — a debugging channel with your AI

Bridge the current serial terminal to a local TCP port with one click so an AI agent can access the embedded device like a regular user.

**🔁 One shared terminal — AI actions visible in real time**

- Every command the agent types is echoed live in the serial terminal panel (the embedded shell must have echo enabled; it is on by default), and each line of device response is visible to you and the agent at the same time;
- The status bar keeps showing the current AgentBridge client count, so you can tell at a glance whether an agent is connected;
- Everything stays visible, and you can take over the keyboard directly in the terminal at any time to pull debugging back to manual.

**💾 Save AI operations like any ordinary log**

- While bridged, click "Save Log" as usual: commands sent by the agent (via device echo) together with all device responses are written into the log file;
- Afterwards you can replay exactly what the AI did — great for debug reports, post-mortems and operation audits.

**🧩 Companion skills**

- Three out-of-the-box skills (connection / embedded Linux / U-Boot) get the agent productive fast (see the next section);
- After starting AgentBridge, copy the prompt below and send it to your AI agent — it will download and install the skills, connect to the device and run commands on its own:

```text
1. Fetch the three skills from https://github.com/ziqiang-zhu/agent-bridge-skills
   (agent-bridge-connection / agent-bridge-embedded-linux / agent-bridge-embedded-uboot),
   and install them into your skills directory following their "Installation" sections;
2. Connect over TCP to 127.0.0.1:2000 (the AgentBridge port of my serial terminal);
3. After connecting, read the device state first and wait for further instructions.
```

**How to use**:

1. After connecting, click the <img src="https://raw.githubusercontent.com/ziqiang-zhu/vscode-serial-port-terminal/master/images/broadcast.png" width="18" alt="broadcast icon"> button at the top-right of the terminal panel title bar to start Agent Bridge on the current connection;
2. The status bar and a notification show the listening address (e.g. `127.0.0.1:2000`; click the status bar to copy) — hand it to your AI agent;
3. The agent connects to that address over TCP to read/write the serial data in real time (multiple clients supported, ANSI escape sequences stripped);
4. To stop: click the <img src="https://raw.githubusercontent.com/ziqiang-zhu/vscode-serial-port-terminal/master/images/record.png" width="18" alt="record icon"> button in the same place — this closes Agent Bridge, and disconnecting the serial connection closes it automatically as well.

> 🔒 By default it listens on `127.0.0.1` (localhost only) and is not exposed to the network; the port and address are configurable.
> 📝 The character stream forwarded to AI agents has ANSI escape sequences (color codes and other control characters) stripped, so clients don't need to handle them.
> 👁️ **Read-only listening**: the `serialPortTerminal.agentBridge.readonly` setting blocks clients from sending data to the device (sent bytes are discarded); changes take effect the next time Agent Bridge starts — ideal for safe observe-only scenarios.

## 🧩 Agent Skills

Ready-made skills help AI agents use AgentBridge out of the box (connection / embedded Linux operations / U-Boot operations):

- Repo: <https://github.com/ziqiang-zhu/agent-bridge-skills>
- Contents:
  - `agent-bridge-connection` — basics for connecting to AgentBridge, running commands and reading output;
  - `agent-bridge-embedded-linux` — common operations once the device reaches a Linux shell;
  - `agent-bridge-embedded-uboot` — common operations while the device is at the U-Boot prompt.

For installation, use the copyable prompt in the previous section — hand it to your AI agent and it installs the skills and connects automatically. You can also download the skills into your AI tool's skills directory manually, or use them as a reference to write your own device-specific skills.

## 🚀 Usage

1. Click the serial manager icon in the activity bar to open the device list
2. Click **Connect** on a device, then pick a saved config or "Manual configuration" in the picker; this connects with a temporary config
3. Right-click a device to save a quick config; select a quick-config node first and connect to use that config directly
4. The terminal panel opens automatically — device data appears in real time; type and press Enter to send
5. Disconnect: click **Disconnect** on the device, or close the terminal panel
6. Logging: click **Save** in the terminal title bar to start recording; pause / resume / stop as needed, and a shortcut can be configured to start/stop
7. Agent collaboration: start the bridge with one click and hand the listening address to your AI agent — see the "AgentBridge" section above

## ⌨️ Commands

### Available from the Command Palette

The following commands can be run directly from the Command Palette (`Ctrl+Shift+P`), all prefixed with `Serial Port Terminal:`:

| Command ID | Title | Description |
|---|---|---|
| `serialPortDeviceList.refresh` | Refresh | Manually scan serial devices |
| `serialPortLog.start` | Save Log | Start recording a log |
| `serialPortLog.pause` | Pause | Pause log recording |
| `serialPortLog.resume` | Resume | Resume log recording |
| `serialPortLog.stop` | Stop | Stop log recording |
| `serialPortLog.openDirectory` | Open Log Directory | Open the log directory in the system file manager |
| `serialPortAgentBridge.start` | Start Agent Bridge | Bridge the current serial port to a local TCP port |
| `serialPortAgentBridge.stop` | Stop Agent Bridge | Stop the Agent Bridge for the current serial port |
| `serialPortAgentBridge.toggleReadonly` | Toggle Agent Bridge Read-only Mode | Toggle the `agentBridge.readonly` setting (takes effect the next time Agent Bridge starts) |

### Device / Config Context Commands

The following commands require selecting a device or quick-config node in the device list; they are triggered via the context menu or inline buttons:

| Command ID | Title | Description |
|---|---|---|
| `serialPortDevice.connect` | Connect | Connect to the selected device |
| `serialPortDevice.disconnect` | Disconnect | Disconnect from the selected device |
| `serialPortQuickConfig.add` | Add Quick Config | Add a named config for the selected device |
| `serialPortQuickConfig.rename` | Rename | Rename the selected quick config |
| `serialPortQuickConfig.remove` | Remove | Delete the selected quick config |

### Macro Commands (sidebar "Commands / Macros" view)

The following commands operate in the "Commands / Macros" view, triggered via the title-bar button, inline button, or context menu:

| Command ID | Title | Description |
|---|---|---|
| `serialPortMacro.add` | Add Macro | Add a macro via the view title-bar button |
| `serialPortMacro.send` | Send Macro | Send the selected macro to the active serial device |
| `serialPortMacro.remove` | Remove Macro | Delete the selected macro |

## ⚙️ Configuration

> ⚠️ **About the `Ctrl+S` shortcut**: `serialPortTerminal.logShortcutsEnabled` is disabled by default. When enabled, pressing `Ctrl+S` inside the serial terminal is intercepted to start/stop recording and is **NOT sent to the device**.

| Setting | Default | Description |
|---|---|---|
| `serialPortTerminal.hotPlugEnabled` | `true` | Enable hot-plug detection |
| `serialPortTerminal.pollingInterval` | `2` | Polling interval in seconds, range 1–15 |
| `serialPortTerminal.baudRates` | 8 common baud rates | Baud rates offered in the manual configuration picker |
| `serialPortTerminal.frameFormats` | 10 common combos | Frame formats (data bits-parity-stop bits) offered in the manual configuration picker |
| `serialPortTerminal.logDirectory` | empty | Log directory; empty uses the default (`Documents/SerialPortTerminal/Log`) |
| `serialPortTerminal.logFilenameTemplate` | `{device}_{YYYY}{MM}{DD}_{HH}{mm}{ss}.log` | Log filename template (placeholders: device name / date and time) |
| `serialPortTerminal.logMaxFileSize` | `0` | Maximum size of a single log file in KB; `0` disables splitting, `≥1` splits oversized logs into numbered files |
| `serialPortTerminal.logTimestampEnabled` | `false` | Prepend a timestamp to each log line (takes effect on the next recording) |
| `serialPortTerminal.logTimestampFormat` | `[{HH}:{mm}:{ss}.{SSS}] ` | Timestamp format (placeholders: date and time with milliseconds) |
| `serialPortTerminal.logShortcutsEnabled` | `false` | Enable the in-terminal `Ctrl+S` shortcut to start/stop recording (⚠️ when enabled, `Ctrl+S` is intercepted and not sent to the device) |
| `serialPortTerminal.agentBridge.host` | `127.0.0.1` | Agent Bridge listening address (localhost only by default) |
| `serialPortTerminal.agentBridge.ports` | `[2000]` | Candidate ports for Agent Bridge (picker shown when starting, a single value is used directly) |
| `serialPortTerminal.agentBridge.readonly` | `false` | Read-only mode: clients cannot send data to the device through Agent Bridge (sent bytes are discarded); changes take effect the next time Agent Bridge starts |
| `serialPortTerminal.virtualConsole` | `false` | Enable the Virtual Device Console and the VCOM- virtual devices; takes effect after restarting the extension host or restarting VS Code |

## 📦 Installation

1. Search for **Serial Port Terminal** in the VS Code Marketplace; or
2. Download the `.vsix` and install via **Extensions → ... → Install from VSIX**.

## 🛠️ Development

```bash
npm install
npm run compile     # compile
npm run watch       # compile on change
npm run clean       # clear dist
```

Press `F5` to launch the Extension Development Host: each F5 runs `clean + compile` automatically.

## 📄 License

[MIT](LICENSE)
