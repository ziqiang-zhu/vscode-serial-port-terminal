# Changelog

> 🇨🇳 [简体中文](CHANGELOG.md)

## [Unit Test v1.5.0]

- The unit test suite grows to 147 cases: new U-Boot -> Linux boot-chain tests (12 cases, all green: 2-second autoboot countdown with backspaced digits, any-key interrupt, session switch on the boot command or expiry, close reset) and mixed-routing tests (6 cases, all green: union enumeration, `VCOM-` prefix routing, offline rejection, prefix boundary), shipped with HalVirtual P4 — the P0-P4 roadmap is complete; also lands three build modes (product / test / unit test, the HAL switch now injected into build output) and productized packaging (the release VSIX carries no virtual device console panel or `testMode.*` settings); suite version v1.4.0 -> v1.5.0.

## [Unit Test v1.4.0]

- The unit test suite grows to 129 cases: new virtual-device control-plane tests (13 cases, all green: device-side injection, online/unplug filtering and open rejection, backpressure queueing and drain, live delay/rate/loop/interaction-dir adjustments), shipped with HalVirtual P3 (control-plane API plus the virtual device console view; production builds render a placeholder page); suite version v1.3.0 -> v1.4.0.

## [Unit Test v1.3.0]

- The unit test suite grows to 116 cases: new replay-profile tests (13 cases, all green: lines-per-second pacing, byte-exact fidelity, EOF loop/stop, silent device), shipped with HalVirtual P2 — all four virtual devices complete; suite version v1.2.0 -> v1.3.0.

## [F5 Crash Correction]

- Root cause corrected: the intermittent F5 host crash (extensionHost SIGABRT / code 134) is a known upstream issue in the js-debug injection path ([microsoft/vscode#336233](https://github.com/microsoft/vscode/issues/336233)); the earlier GPU-renderer attribution was wrong — the atomic-build fix in `[F5 Debug Stability]` is unaffected
- Debug configuration adjusted: the default `Debug` config restored to standard arguments, `--disable-gpu` demoted to an alternative, and the workspace disables `debug.javascript.enableNetworkView` (the trigger suspected upstream)
- **Scope: development debugging only, zero impact on extension users** — production builds, runtime behavior, and published artifacts are unchanged

## [Unit Test v1.2.0]

- The unit test suite grows to 103 cases: new command-shell profile tests (20 cases, all green: remote echo, line buffering, builtin command tables, compound commands, response-directory overrides); suite version v1.1.0 -> v1.2.0.

## [F5 Debug Stability]

- Fixed random crashes of the F5 debug host: the root cause is a renderer crash of the VS Code 1.145 debug host window on this machine's GPU stack (unrelated to this extension — reproducible with an empty extension); the default debug configuration now disables GPU acceleration, with a `Debug (GPU enabled)` alternative kept alongside a crash-risk note
- Atomic build chain: `compile` now builds into `.tmp-build` first and swaps `dist` on success — a failed or interrupted build exits non-zero and aborts the debug launch, so the host never loads a partial or stale output; `activate` logs a build stamp (time + commit) on its first line for version checks

## [Unit Test v1.1.0]

- The unit test suite grows to 83 cases: new virtual HAL scaffold + Echo profile tests (11 cases, all green, including mock-timer controlled delay-pipeline checks); suite version v1.0.0 -> v1.1.0.

## [1.4.2]

### Added
- SerialPortHalVirtual, the virtual HAL (product test mode P0): a profile abstraction base, a virtual port handle (response-delay pipeline, close cleanup), and the Echo device (`VCOM-ECHO`, self-labeled Virtual in the device list)
- Compile-time `USE_VIRTUAL_HAL` switch (default `false`, source-level only, no runtime toggle); assembly picks the HAL through a factory
- Release guard: `vscode:prepublish` now runs `verify-hal-selection.js` first and rejects packaging while the switch is not reset

### Notes
- Default production behavior is unchanged (the real HAL is assembled while the switch is off)

## [Unit Test v1.0.0]

- The unit test suite grows to 72 cases: new SerialPortConfigStore tests (25 cases, all green), closing P0; suite version v0.5.0 -> v1.0.0.

## [Unit Test v0.5.0]

- The unit test suite grows to 47 cases: new SerialPortDeviceImpl identity-fallback and Unknown-fallback tests (8 cases, all green); suite version v0.4.0 -> v0.5.0.

## [1.4.1]

### Fixed
- LineTimestampBuffer now accumulates raw bytes: multibyte characters split at chunk boundaries are no longer corrupted into replacement characters; unit test coverage expanded to 39 cases

## [1.4.0]

### Changed
- Line-buffered ANSI stripping: escape sequences are stripped per line, with incomplete trailing lines held as raw bytes across chunks — no more fragment leaks or multibyte corruption at chunk boundaries; the remaining half-line is flushed on disconnect
- AgentBridge forwarding semantics adjusted: output is now ANSI-stripped line-buffered forwarding; a held line is flushed automatically after 200ms of silence and on bridge close (newline-less output such as prompts no longer stalls); the send path stays real-time

## [Unit Test Online]

- The unit test suite is online: `npm test` (Node's built-in test runner), 39 cases so far. Progress and case details: `doc/Test/开发测试体系规划.md`; the suite carries its own version in `test/package.json` (currently v0.4.0);
- **Release requirement**: `vscode:prepublish` now runs `npm test` as a gate — `vsce package` and `vsce publish` abort while the suite is red; a green suite is mandatory for packaging a release.

## [1.3.3]

### Added
- Show the serial number (Serial Number) in the device hover tooltip

## [1.3.2]

### Changed
- Simplify the AgentBridge startup notification: drop "listening at", showing just `Agent Bridge: host:port`

## [1.3.1]

### Changed
- AgentBridge strips ANSI escape sequences from the character stream forwarded to clients

## [1.3.0]

### Changed
- Log recorder now uses `SerialPortAnsiStripper` and `SerialPortLineTimestampBuffer`, removing the old `SerialPortLogDataParser`

## [1.2.12]

### Changed
- DataParser extraction: add the `SerialPortLineTimestampBuffer` class for per-line timestamp buffering of logs

## [1.2.11]

### Changed
- DataParser extraction: add the shared `SerialPortAnsiStripper` utility that strips ANSI escape sequences for reuse across consumers

## [1.2.10]

### Changed
- Adjust terminal title-bar button order: move AgentBridge to the right of the log buttons, using `navigation@15/16/17` group orders to stay further clear of other extensions' ordering

## [1.2.9]

### Fixed
- Fix terminal title-bar button reordering: assign explicit `navigation@6/7/8` group orders to the AgentBridge and log buttons so they sit to the right of the native terminal actions and no longer conflict with other extensions' button ordering

## [1.2.8]

### Added
- AgentBridge status bar: show the listening address (`host:port`) persistently in the status bar while the bridge is running, click to copy, and follow the active terminal (per-terminal)

## [1.2.7]

### Changed
- AgentBridge localization and docs: add English and Chinese strings for command titles, setting descriptions, and runtime messages; update the README and mark the design as implemented

## [1.2.6]

### Added
- AgentBridge UI and config: add "Start / Stop Agent Bridge" buttons to the terminal title bar (`$(broadcast)` / `$(record)` icons), and new settings `serialPortTerminal.agentBridge.host` (default `127.0.0.1`) and `serialPortTerminal.agentBridge.ports` (default `[2000]`)

## [1.2.5]

### Added
- Add AgentBridge: bridge a serial connection to a local TCP port so external AI agents can read/write the embedded serial console (multi-client, real-time raw byte passthrough, on-demand terminal title-bar toggle, configurable port)

## [1.2.4]

### Added
- Split logs by size: new `serialPortTerminal.logMaxFileSize` (integer, in KB, default `0` = no splitting); when set to 1 or more, oversized logs are split into numbered files (`xxx.log`, `xxx_002.log`…, flat in the same directory, and the saved notification keeps showing the base file name)

## [1.2.3]

### Fixed
- Fix quick configs being lost, or new same-parameter configs being falsely rejected with "config already exists", after upgrading from an older version: legacy configs are kept as-is (still shown under each device, visible and deletable) and are no longer migrated
- Support both legacy storage shapes: the per-device object from v1.2.0 and earlier, and the global array produced by the v1.2.1/1.2.2 migration; each shape is parsed on read so legacy configs remain visible and deletable after upgrading to v1.2.3

### Changed
- Split quick config storage into two keys: legacy `serialPortQuickConfigs` (per-device) stays read-only for display and deletion; new configs go into `serialPortQuickConfigPool` (global pool) + `serialPortDeviceConfigRefs` (per-device references), with no conflict and no version marker

## [1.2.2]

### Fixed
- Reject creating a quick config whose parameters duplicate an existing one (globally unique), so same-parameter configs are never conflated; reuse via "Choose existing quick config" instead

## [1.2.1]

### Added
- Global quick configs: configs live in a global pool and can be reused across devices (reference counting manages the lifecycle); adding a quick config supports "new" or "reuse an existing quick config"

### Changed
- Remove presets (`serialPortTerminal.serialConfigPresets` and the preset management UI)
- Manual configuration is now settings-driven: baud rate / frame format are dropdowns (new `serialPortTerminal.baudRates` / `serialPortTerminal.frameFormats`; skipped when there is a single value)
- Migrate legacy per-device configs losslessly to the new "global pool + per-device references" format

## [1.2.0]

### Added
- Manual configuration when connecting: a new "Manual configuration" entry at the top of the connection parameter selector opens a four-step wizard (baud rate → frame format → flow control → save option) for on-the-fly configuration and connecting, with an optional "save as quick config"

### Changed
- Mark the current frame format / flow control when editing a preset (implements "prefill current value when editing")

## [1.1.1]

### Fixed
- Fix event emitters and the polling timer in `ConfigStore`/`SerialPortDeviceDetector` not being released on deactivation
- Fix device removal destroying only the connection without resetting status or emitting status events (now routed through the single `disconnect()` entry)
- Fix silently swallowed port errors in HAL (now logged for observability)
- Fix missing parity/flowControl validation in `SerialPortConfigStore`
- Clamp the polling interval to 1–15 seconds

### Changed
- Expand the preset wizard to all 60 frame-format combinations (data bits 5/6/7/8 × parity N/E/O/M/S × stop bits 1/1.5/2)
- Localize the `Unknown` device-field fallback
- Remove the unused `SerialConfig.schemaVersion` field

## [1.1.0]

### Added
- Command/macro sender: a new sidebar tree view for adding, removing, and sending macros to the active serial device (stored in globalState)

## [1.0.3]

### Changed
- Expose the backpressure signal in HAL: `SerialPortHandle.write` returns `boolean`, add an `onDrain` event, and propagate the signal through Connection / Consumer

## [1.0.2]

### Changed
- Make `SerialPortConsumer.onData` optional, allowing send-only consumers that do not receive data

## [1.0.1]

### Fixed
- Fix the "open log directory" button failing when the log directory contains non-ASCII (e.g. Chinese) characters: open the directory via the system file manager, and create it asynchronously to avoid blocking

## [1.0.0]

### Added
- `Ctrl+S` shortcut in the serial terminal to start/stop log recording (setting `serialPortTerminal.logShortcutsEnabled`, disabled by default; when enabled, `Ctrl+S` is intercepted and not sent to the device)

### Notes
- First stable release: device management, hot-plug detection, connection, built-in terminal, log recording, and filename/timestamp configuration are essentially complete

## [0.3.10]

### Changed
- Prefix all commands with `Serial Port Terminal` (category) in the Command Palette

## [0.3.9]

### Added
- Per-line log timestamps: add `serialPortTerminal.logTimestampEnabled` / `logTimestampFormat` settings, with millisecond precision

## [0.3.8]

### Added
- Strip ANSI escape sequences from saved logs: add the `SerialPortLogDataParser` data-processing class to remove color codes and other invisible symbols before writing

## [0.3.7]

### Added
- Customizable log filename: add the `serialPortTerminal.logFilenameTemplate` setting with placeholder templates and a customizable timestamp format

## [0.3.6]

### Added
- Log save notification: show a "File saved to <path>" message when recording stops (via Stop or disconnect) and data was written

## [0.3.5]

### Added
- Marketplace icon (logo)

### Changed
- Remove the unregistered `serialPortTerminal.open` activity-bar command

## [0.3.4]

### Changed
- Change the sidebar icon to `debug-console`

## [0.3.3]

### Added
- "Open log directory" button: a one-click button in the device-list title bar to open the log directory

## [0.3.2]

### Fixed
- Name log files precise to the second to avoid naming conflicts when saving multiple times within a minute

### Added
- Lazy file creation: create the log file only on first data to avoid empty files

## [0.3.1]

### Fixed
- Fix the device item being lost from the tree view when a COM port is reused (identity change on the same path)
