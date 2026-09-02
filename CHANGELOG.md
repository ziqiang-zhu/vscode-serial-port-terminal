# 更新日志

> 🇬🇧 [English](CHANGELOG.en.md)

## [1.2.12]

### 变更
- DataParser 公共化：新增 `SerialPortLineTimestampBuffer` 类，用于日志按行缓冲并前缀时间戳

## [1.2.11]

### 变更
- DataParser 公共化：新增公共工具类 `SerialPortAnsiStripper`，用于剥离 ANSI 转义序列，供各 Consumer 复用

## [1.2.10]

### 变更
- 调整终端标题栏按钮顺序：AgentBridge 移到日志按钮右侧，分组序号改用 `navigation@15/16/17`，进一步避开其他扩展的按钮序号

## [1.2.9]

### 修复
- 修复终端标题栏按钮顺序漂移：为 AgentBridge 与日志按钮指定 `navigation@6/7/8` 分组序号，使其固定排在原生终端按钮右侧，避免与其他扩展的按钮序号冲突

## [1.2.8]

### 新增
- AgentBridge 状态栏显示：桥运行时状态栏常驻显示监听地址（`host:port`），点击复制到剪贴板，跟随活动终端切换（每终端独立）

## [1.2.7]

### 变更
- AgentBridge 本地化与文档：补齐命令标题、配置描述、运行期提示的中英文案，更新 README，设计文档状态转为已实现

## [1.2.6]

### 新增
- AgentBridge 界面与配置：终端标题栏新增「开启 / 停止 Agent Bridge」按钮（`$(broadcast)` / `$(record)` 图标），新增配置 `serialPortTerminal.agentBridge.host`（默认 `127.0.0.1`）与 `serialPortTerminal.agentBridge.ports`（默认 `[2000]`）

## [1.2.5]

### 新增
- 新增 AgentBridge：把串口连接桥接到本机 TCP 端口，供外部 AI Agent 通过端口读写嵌入式串口终端（多客户端、实时裸字节透传、终端标题栏按需启停、端口可配置）

## [1.2.4]

### 新增
- 日志按大小分割：新增 `serialPortTerminal.logMaxFileSize`（整数，单位 KB，默认 `0` = 不分割），设为 ≥1 时，超出该大小的日志自动分割为带编号文件（`xxx.log`、`xxx_002.log`…，平铺同目录，保存提示仍显示主体文件名）

## [1.2.3]

### 修复
- 修复从旧版本升级后快捷配置丢失、或新建同参数配置被误报「配置已存在」的问题：旧配置原样保留（仍挂在设备下、可见可删），不再迁移
- 兼容旧配置的两种存储形态：v1.2.0 及更早的「按设备分区对象」与 v1.2.1/1.2.2 迁移后的「全局数组」，读取时按形态分别解析，升级到 v1.2.3 后旧配置仍可见可删

### 变更
- 快捷配置存储改为双键：旧 `serialPortQuickConfigs`（按设备分区）只读展示、可删；新配置写入 `serialPortQuickConfigPool`（全局池）+ `serialPortDeviceConfigRefs`（每设备引用），两者互不冲突、不做版本标记

## [1.2.2]

### 修复
- 禁止创建与已有快捷配置参数完全相同的配置项（全局唯一），避免同参数配置被混淆；复用请走「选择已存在快捷配置」

## [1.2.1]

### 新增
- 快捷配置全局化：配置存于全局池，可跨设备复用（引用计数管理生命周期）；添加快捷配置支持「新建」或「选择已存在快捷配置」

### 变更
- 移除预设功能（`serialPortTerminal.serialConfigPresets` 与预设管理界面）
- 手动配置参数改为 settings 驱动：波特率/帧格式改为下拉（新增 `serialPortTerminal.baudRates` / `serialPortTerminal.frameFormats`，单值时跳过）
- 旧「按设备分区」的已存配置自动无损迁移为「全局池 + 每设备引用」格式

## [1.2.0]

### 新增
- 连接时手动配置参数：参数选择器顶部新增「手动配置参数」入口，四步向导（波特率 → 帧格式 → 流控 → 保存选项）按需配置并直接连接，可选保存为快捷配置

### 变更
- 预设编辑向导的帧格式/流控标注当前值（兑现「编辑时预填当前值」）

## [1.1.1]

### 修复
- 修复扩展停用时 `ConfigStore`/`SerialPortDeviceDetector` 的事件器与轮询定时器未释放的问题
- 修复设备拔除时只销毁连接、不回写状态与状态事件的问题（统一经 `disconnect()` 单一入口）
- 修复 HAL 空 error 监听静默吞错（改为兜底记录，错误可观测）
- 修复 `SerialPortConfigStore` 未校验 parity/flowControl 的问题
- 修复轮询间隔无代码层钳制的问题（现钳制到 1–15 秒）

### 变更
- 预设向导帧格式补齐为 60 种组合（数据位 5/6/7/8 × 校验 N/E/O/M/S × 停止位 1/1.5/2）
- 设备字段缺失时的 `Unknown` 回退值本地化
- 移除未使用的 `SerialConfig.schemaVersion` 字段

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
