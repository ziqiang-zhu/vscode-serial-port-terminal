# Serial Port Terminal

一个 VS Code 串口终端插件：在侧边栏管理串口设备，一键连接，在真正的终端面板里与设备交互。

> 🇬🇧 [English](README.en.md)

> **⚠️ 平台支持**：当前发布版本仅支持 **Windows x64**（serialport 原生模块在打包时仅保留 win32-x64 预编译二进制）。macOS / Linux / ARM 平台暂不受支持。

## ✨ 功能

- 🔌 **设备管理** —— 活动栏入口，列出系统串口设备，展示厂商信息、悬停详情与连接状态
- 🔄 **热插拔侦测** —— 周期性扫描（间隔可配置、可关闭），设备插入/拔除自动增删列表
- 🚦 **连接状态** —— 未连接 / 连接中 / 已连接三态，带视觉反馈，打开失败自动回滚并提示原因
- 🖥️ **内置终端** —— 基于 VS Code Pseudoterminal，数据原样显示，键入回车即发送
- 📜 **断开保留日志** —— 断开后终端面板保留，可继续回看本次会话
- ⚙️ **快捷配置** —— 每台设备可保存多份命名连接配置，支持增/改/删与悬停查看完整参数
- 🎯 **智能连接** —— 当前连接高亮、上次使用配置自动置顶、选中快捷配置子节点可直连
- 🧩 **预设管理界面** —— 齿轮按钮打开预设列表，四步向导新增/编辑，无需手改 JSON
- 🏷️ **终端标题带配置名** —— 显示设备路径 + 配置名（或波特率）
- 💾 **日志保存** —— 终端标题栏「保存/暂停/停止」，有数据才建文件，文件名精确到秒，剥离 ANSI 转义序列（颜色码等）、可选每行时间戳，停止时提示保存路径
- 📂 **打开日志目录** —— 设备列表标题栏一键在系统文件管理器中打开日志目录
- 🌐 **本地化** —— 支持英文 / 简体中文

## 📦 安装

1. 在 VS Code Marketplace 搜索 **Serial Port Terminal** 安装；或
2. 下载 `.vsix` 后，通过「扩展 → ... → 从 VSIX 安装」安装。

## 🚀 使用方法

1. 点击活动栏的串口管理器图标，打开设备列表
2. 点击设备上的「连接」，在弹出的选择器中选择「保存的配置」或「预设组合」（不保存）
   - 提示：先选中某个快捷配置子节点，再点连接，可直接用该配置连接
3. 自动弹出终端面板 —— 设备数据实时显示，键入内容后回车发送
4. 断开：点击设备条目上的「断开」，或直接关闭终端面板
5. 日志：在终端面板标题栏点击「保存」开始记录，可暂停 / 继续 / 停止

## ⌨️ 命令

### 命令面板可用

以下命令可通过命令面板（`Ctrl+Shift+P`）直接执行，均带 `Serial Port Terminal:` 前缀：

| 命令 ID | 名称 | 说明 |
|---|---|---|
| `serialPortDeviceList.refresh` | 刷新 | 手动扫描串口设备 |
| `serialPortPreset.manage` | 管理预设组合 | 打开预设组合管理界面 |
| `serialPortLog.start` | 保存日志 | 开始记录日志 |
| `serialPortLog.pause` | 暂停 | 暂停记录日志 |
| `serialPortLog.resume` | 继续 | 继续记录日志 |
| `serialPortLog.stop` | 停止 | 停止记录日志 |
| `serialPortLog.openDirectory` | 打开日志目录 | 在系统文件管理器中打开日志目录 |

### 设备 / 配置上下文命令

以下命令需先在设备列表中选中设备或快捷配置节点，经右键菜单或行内按钮触发：

| 命令 ID | 名称 | 说明 |
|---|---|---|
| `serialPortDevice.connect` | 连接 | 连接选中的设备 |
| `serialPortDevice.disconnect` | 断开链接 | 断开选中的设备 |
| `serialPortQuickConfig.add` | 添加快捷配置 | 为选中的设备添加命名连接配置 |
| `serialPortQuickConfig.rename` | 重命名 | 重命名选中的快捷配置 |
| `serialPortQuickConfig.remove` | 删除 | 删除选中的快捷配置 |

## ⚙️ 配置

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `serialPortTerminal.hotPlugEnabled` | `true` | 是否启用热插拔侦测 |
| `serialPortTerminal.pollingInterval` | `2` | 轮询间隔（秒），范围 1–15 |
| `serialPortTerminal.serialConfigPresets` | 8 个常用组合 | 连接/添加配置时可选的预设参数组合（建议经「管理预设组合」界面编辑） |
| `serialPortTerminal.logDirectory` | 空 | 日志保存目录，留空使用默认（`Documents/SerialPortTerminal/Log`） |
| `serialPortTerminal.logFilenameTemplate` | `{device}_{YYYY}{MM}{DD}_{HH}{mm}{ss}.log` | 日志文件名模板（占位符：设备名 / 年月日时分秒） |
| `serialPortTerminal.logTimestampEnabled` | `false` | 是否在每行日志前加时间戳（下次开始记录时生效） |
| `serialPortTerminal.logTimestampFormat` | `[{HH}:{mm}:{ss}.{SSS}] ` | 时间戳格式（占位符：年月日时分秒毫秒） |

## 🗺️ 待开发计划

- 输入增强：行尾符配置（CR / LF / CRLF）
- Parser 与字符转义（分帧、不可见字符可视化）
- 多 Consumer 二级菜单管理
- 启动自动恢复（上次设备与配置）
- 日志增强：保存/暂停/停止快捷键、按大小分割、更多配置（分割大小、时间戳开关/间隔、编码）

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
