# Changelog

> 🇨🇳 [简体中文](CHANGELOG.md)

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
