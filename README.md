# Serial Port Terminal

一个 VS Code 串口终端插件：在侧边栏管理串口设备，一键连接，在真正的终端面板里与设备交互；还能一键把串口终端桥接为本机 TCP 端口，让 AI Agent 直接在端口上操作设备终端。

> 🇬🇧 [English](README.en.md)

> **⚠️ 平台支持**：当前发布版本仅支持 **Windows x64**（serialport 原生模块在打包时仅保留 win32-x64 预编译二进制）。macOS / Linux / ARM 平台暂不受支持。

## ✨ 功能

- 🔌 **设备管理** —— 活动栏入口，列出系统串口设备，展示厂商信息、悬停详情与连接状态
- 🔄 **热插拔侦测** —— 周期性扫描（间隔可配置、可关闭），设备插入/拔除自动增删列表
- 🚦 **连接状态** —— 未连接 / 连接中 / 已连接三态，带视觉反馈，打开失败自动回滚并提示原因
- 🖥️ **内置终端** —— 基于 VS Code Pseudoterminal，数据原样显示，键入回车即发送
- 📜 **断开保留日志** —— 断开后终端面板保留，可继续回看本次会话
- ⚙️ **快捷配置** —— 全局命名连接配置，可跨设备复用（引用计数），支持增/改/删/引用与悬停查看完整参数
- 🎯 **智能连接** —— 当前连接高亮、上次使用配置自动置顶、选中快捷配置子节点可直连
- 🧩 **手动配置** —— 连接时可直接按需配置参数（波特率/帧格式来自 settings 下拉），无需预先建立预设
- 🏷️ **终端标题带配置名** —— 显示设备路径 + 配置名（或波特率）
- 💾 **日志保存** —— 终端标题栏「保存/暂停/停止」，有数据才建文件，文件名精确到秒，剥离 ANSI 转义序列（颜色码等）、可选每行时间戳，停止时提示保存路径；可选快捷键 `Ctrl+S`（开始/停止，默认关闭）
- 📂 **打开日志目录** —— 设备列表标题栏一键在系统文件管理器中打开日志目录
- 🤖 **AgentBridge（AI 交互）** —— 终端标题栏一键把串口桥接为本机 TCP 端口，让 AI Agent 读写嵌入式 Linux 终端（多客户端、去 ANSI 实时透传、状态栏常驻端口、点击复制）
- 🌐 **本地化** —— 支持英文 / 简体中文

## 📦 安装

1. 在 VS Code Marketplace 搜索 **Serial Port Terminal** 安装；或
2. 下载 `.vsix` 后，通过「扩展 → ... → 从 VSIX 安装」安装。

## 🚀 使用方法

1. 点击活动栏的串口管理器图标，打开设备列表
2. 点击设备上的「连接」，在弹出的选择器中选择「保存的配置」或「手动配置参数」，可使用临时配置连接
3. 右键点击设备，可保存快捷配置，先选中某个快捷配置子节点，再点连接，可直接用该配置连接
4. 自动弹出终端面板 —— 设备数据实时显示，键入内容后回车发送
5. 断开：点击设备条目上的「断开」，或直接关闭终端面板
6. 日志：在终端面板标题栏点击「保存」开始记录，可暂停 / 继续 / 停止，可配置使用快捷键开始与停止
7. Agent 交互：连接后在终端标题栏点击 `$(broadcast)` 开启桥接，把状态栏显示的地址交给 AI Agent 即可接入

## 🤖 Agent 交互（AgentBridge）

一键把当前串口桥接为本机 TCP 端口，让 AI Agent 像操作终端一样读写嵌入式 Linux 设备：

1. 连接设备后，在终端面板标题栏点击 `$(broadcast)`（开启 Agent Bridge）；
2. 状态栏与提示会显示监听地址（如 `127.0.0.1:2000`，点击状态栏可复制）；
3. AI Agent 用 TCP 连接该地址，实时收发设备串口数据（多客户端、去 ANSI 的字节透传）；
4. 点击 `$(record)`（停止 Agent Bridge）结束桥接。

> 🔒 默认仅监听 `127.0.0.1`（本机），不暴露到局域网；端口与监听地址可在设置中配置。
> 📝 转发给 AI Agent 的字符流已剥离 ANSI 转义序列（颜色码等控制字符），客户端无需自行处理。

## ⌨️ 命令

### 命令面板可用

以下命令可通过命令面板（`Ctrl+Shift+P`）直接执行，均带 `Serial Port Terminal:` 前缀：

| 命令 ID | 名称 | 说明 |
|---|---|---|
| `serialPortDeviceList.refresh` | 刷新 | 手动扫描串口设备 |
| `serialPortLog.start` | 保存日志 | 开始记录日志 |
| `serialPortLog.pause` | 暂停 | 暂停记录日志 |
| `serialPortLog.resume` | 继续 | 继续记录日志 |
| `serialPortLog.stop` | 停止 | 停止记录日志 |
| `serialPortLog.openDirectory` | 打开日志目录 | 在系统文件管理器中打开日志目录 |
| `serialPortAgentBridge.start` | 开启 Agent Bridge | 把当前串口桥接到本机 TCP 端口 |
| `serialPortAgentBridge.stop` | 停止 Agent Bridge | 停止当前串口的 Agent Bridge 桥接 |

### 设备 / 配置上下文命令

以下命令需先在设备列表中选中设备或快捷配置节点，经右键菜单或行内按钮触发：

| 命令 ID | 名称 | 说明 |
|---|---|---|
| `serialPortDevice.connect` | 连接 | 连接选中的设备 |
| `serialPortDevice.disconnect` | 断开链接 | 断开选中的设备 |
| `serialPortQuickConfig.add` | 添加快捷配置 | 为选中的设备添加命名连接配置 |
| `serialPortQuickConfig.rename` | 重命名 | 重命名选中的快捷配置 |
| `serialPortQuickConfig.remove` | 删除 | 删除选中的快捷配置 |

### 宏命令（侧边栏「命令/宏」视图）

以下命令在「命令/宏」视图中操作，经标题栏按钮、行内按钮或右键菜单触发：

| 命令 ID | 名称 | 说明 |
|---|---|---|
| `serialPortMacro.add` | 新增宏 | 在「命令/宏」视图标题栏新增一个宏 |
| `serialPortMacro.send` | 发送宏 | 将选中的宏发送到当前活动串口设备 |
| `serialPortMacro.remove` | 删除宏 | 删除选中的宏 |

## ⚙️ 配置

> ⚠️ **关于 `Ctrl+S` 快捷键**：`serialPortTerminal.logShortcutsEnabled` 默认关闭。开启后，在串口终端内按 `Ctrl+S` 会被扩展拦截用于开始/停止记录，**不会发送给设备**（设备端收不到该按键）。

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `serialPortTerminal.hotPlugEnabled` | `true` | 是否启用热插拔侦测 |
| `serialPortTerminal.pollingInterval` | `2` | 轮询间隔（秒），范围 1–15 |
| `serialPortTerminal.baudRates` | 8 个常用波特率 | 手动配置时可选的波特率列表 |
| `serialPortTerminal.frameFormats` | 10 个常用组合 | 手动配置时可选的帧格式（数据位-校验-停止位）列表 |
| `serialPortTerminal.logDirectory` | 空 | 日志保存目录，留空使用默认（`Documents/SerialPortTerminal/Log`） |
| `serialPortTerminal.logFilenameTemplate` | `{device}_{YYYY}{MM}{DD}_{HH}{mm}{ss}.log` | 日志文件名模板（占位符：设备名 / 年月日时分秒） |
| `serialPortTerminal.logMaxFileSize` | `0` | 单个日志文件最大大小（KB），`0` = 不分割；≥1 时超限自动分割为带编号文件 |
| `serialPortTerminal.logTimestampEnabled` | `false` | 是否在每行日志前加时间戳（下次开始记录时生效） |
| `serialPortTerminal.logTimestampFormat` | `[{HH}:{mm}:{ss}.{SSS}] ` | 时间戳格式（占位符：年月日时分秒毫秒） |
| `serialPortTerminal.logShortcutsEnabled` | `false` | 启用终端内 `Ctrl+S` 快捷键开始/停止记录（⚠️ 启用后 `Ctrl+S` 被拦截，不发送给设备） |
| `serialPortTerminal.agentBridge.host` | `127.0.0.1` | Agent Bridge 监听地址（默认仅本机） |
| `serialPortTerminal.agentBridge.ports` | `[2000]` | Agent Bridge 候选端口列表（启动时下拉选择，单值直接使用） |

## 🗺️ 待开发计划

- 输入增强：行尾符配置（CR / LF / CRLF）
- Parser 与字符转义（分帧、不可见字符可视化）
- 多 Consumer 二级菜单管理
- 启动自动恢复（上次设备与配置）
- 日志增强：编码配置（当前固定 UTF-8）

## 🛠️ 开发

```bash
npm install
npm run compile     # 编译
npm run watch       # 监听编译
npm run clean       # 清空 dist
```

按 `F5` 启动扩展开发主机调试：每次 F5 自动执行 `clean + compile`，保证运行最新构建。

## 📄 许可证

[MIT](LICENSE)
