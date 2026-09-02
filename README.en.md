# Serial Port Terminal

A VS Code serial port terminal extension: manage serial devices in the sidebar, connect with one click, interact with them in a real terminal panel, and bridge the serial terminal to a local TCP port with one click so AI agents can operate the device terminal right on that port.

> 🇨🇳 [简体中文](README.md)

> **⚠️ Platform support**: the current release supports **Windows x64 only** (the packaged serialport native module keeps only the win32-x64 prebuilt binary). macOS / Linux / ARM are not supported yet.

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
- 🤖 **AgentBridge (AI interaction)** — one-click in the terminal title bar bridges the serial port to a local TCP port so AI agents can read/write the embedded Linux console (multi-client, ANSI-stripped real-time passthrough, persistent status-bar port, click to copy)
- 🌐 **Localization** — English / Simplified Chinese

## 📦 Installation

1. Search for **Serial Port Terminal** in the VS Code Marketplace; or
2. Download the `.vsix` and install via **Extensions → ... → Install from VSIX**.

## 🚀 Usage

1. Click the serial manager icon in the activity bar to open the device list
2. Click **Connect** on a device, then pick a saved config or "Manual configuration" in the picker; this connects with a temporary config
3. Right-click a device to save a quick config; select a quick-config node first and connect to use that config directly
4. The terminal panel opens automatically — device data appears in real time; type and press Enter to send
5. Disconnect: click **Disconnect** on the device, or close the terminal panel
6. Logging: click **Save** in the terminal title bar to start recording; pause / resume / stop as needed, and a shortcut can be configured to start/stop
7. Agent interaction: after connecting, click `$(broadcast)` in the terminal title bar to start the bridge, then hand the status-bar address to your AI agent

## 🤖 Agent Interaction (AgentBridge)

Bridge the current serial port to a local TCP port with one click, so AI agents can read/write the embedded Linux device like a terminal:

1. After connecting, click `$(broadcast)` in the terminal title bar to start Agent Bridge;
2. The status bar and a notification show the listening address (e.g. `127.0.0.1:2000`; click the status bar to copy);
3. The AI agent connects to that address over TCP to read/write the serial data in real time (multi-client, ANSI-stripped byte passthrough);
4. Click `$(record)` to stop the bridge.

> 🔒 By default it listens on `127.0.0.1` (localhost only) and is not exposed to the network; the port and address are configurable.
> 📝 The character stream forwarded to AI agents has ANSI escape sequences (color codes and other control characters) stripped, so clients don't need to handle them.

## 🧩 Agent Skills

Ready-made skills help AI agents use AgentBridge out of the box (connection / embedded Linux operations / U-Boot operations):

- Repo: <https://github.com/ziqiang-zhu/agent-bridge-skills>
- Contents:
  - `agent-bridge-connection` — basics for connecting to AgentBridge, running commands and reading output;
  - `agent-bridge-embedded-linux` — common operations once the device reaches a Linux shell;
  - `agent-bridge-embedded-uboot` — common operations while the device is at the U-Boot prompt.

You can download these skills into your AI tool's skills directory, or use them as a reference to write your own device-specific skills.

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

## 🗺️ Roadmap

- Input enhancements: line-ending configuration (CR / LF / CRLF)
- Parser and character escaping (framing, invisible-character visualization)
- Multi-consumer secondary menu management
- Auto-restore on startup (last device and config)
- Log enhancements: configurable encoding (currently fixed to UTF-8)

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
