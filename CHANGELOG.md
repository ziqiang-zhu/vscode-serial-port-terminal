# 更新日志

> 🇬🇧 [English](CHANGELOG.en.md)

## [1.1.0]

### 新增
- 命令/宏发送：侧边栏新增「命令/宏」树视图，支持新增、删除、发送宏到当前活动的串口设备（存储于 globalState）

## [1.0.3]

### 变更
- HAL 暴露背压信号：`SerialPortHandle.write` 返回 `boolean`，新增 `onDrain` 事件，并经 Connection / Consumer 传播

## [1.0.2]

### 变更
- `SerialPortConsumer.onData` 改为可选，允许实现「只发送、不接收数据」的 Consumer

## [1.0.1]

### 修复
- 日志目录含中文（非 ASCII）时「打开日志目录」按钮失败的问题：改用系统文件管理器命令打开目录，并将目录创建改为异步避免阻塞

## [1.0.0]

### 新增
- 串口终端内 `Ctrl+S` 快捷键：开始/停止记录日志（配置项 `serialPortTerminal.logShortcutsEnabled`，默认关闭；开启后 `Ctrl+S` 被拦截、不发送给设备）

### 说明
- 首个正式版本：设备管理、热插拔、连接、内置终端、日志记录与文件名/时间戳配置等核心功能已基本完成

## [0.3.10]

### 变更
- 所有命令在命令面板中统一加 `Serial Port Terminal` 前缀（category）

## [0.3.9]

### 新增
- 日志每行时间戳：新增 `serialPortTerminal.logTimestampEnabled` / `logTimestampFormat` 配置，时间戳可精确到毫秒

## [0.3.8]

### 新增
- 日志内容剥离 ANSI 转义序列：新增 `SerialPortLogDataParser` 数据处理类，写入日志前移除颜色码等不可见符号

## [0.3.7]

### 新增
- 日志文件名自定义：新增 `serialPortTerminal.logFilenameTemplate` 配置，支持占位符模板与时间戳格式自定义

## [0.3.6]

### 新增
- 日志保存提示：停止记录（点「停止」或断开连接）且本次有数据写入时，弹出「文件已保存到 <路径>」提示

## [0.3.5]

### 新增
- 市场图标（Logo）

### 变更
- 删除未注册的 `serialPortTerminal.open` 活动栏命令

## [0.3.4]

### 变更
- 侧边栏图标改为 `debug-console`

## [0.3.3]

### 新增
- 「打开日志目录」按钮：在设备列表标题栏一键打开日志目录

## [0.3.2]

### 修复
- 日志文件命名精确到秒，避免同一分钟内多次保存导致的文件命名冲突

### 新增
- 延迟创建文件：首次收到数据时才创建日志文件，避免产生空文件

## [0.3.1]

### 修复
- 修复 COM 号复用（同路径身份变化）时新设备条目从树视图丢失的问题
