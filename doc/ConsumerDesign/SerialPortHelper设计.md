# SerialPortHelper（串口助手）设计

> 状态：待办（v1.6.0 计划功能，本文档为需求记录与评估骨架，启动时完善为完整设计）｜ 目录：`src/SerialPortConsumer/SerialPortHelper/`（计划）｜ 上位文档：[总体架构.md](../总体架构.md) ｜ 关联：[SerialPortConsumer设计.md](SerialPortConsumer设计.md)、[SerialPortAgentBridge设计.md](SerialPortAgentBridge设计.md)、[SerialPortLogRecorder设计.md](SerialPortLogRecorder设计.md)

## 1. 定位（需求来源：2026-11-07 用户需求）

面向调试与测试的**纯字节流**串口工具：数据原样发送、原样接收，与现有面向终端交互的 SerialPortTerminal 并列的第二种**主 Consumer** 类型。

起因（Terminal 形态的不足）：AgentBridge 面向终端，可纯字节发送但无法向用户展示发送的数据（不透明）；接收链路带 ANSI 颜色码剥离，可能误伤原始数据；无数据保存能力。

## 2. 核心需求（用户定义）

| # | 需求 | 说明 |
|---|---|---|
| 1 | SerialPortHelper Consumer | 纯字节流，数据原样发送；与 SerialPortTerminal 并列的主 Consumer，依附型 Consumer（DataRecorder 等）依附它 |
| 2 | 主 Consumer 互斥 | 同一设备同一时刻仅一种主 Consumer（Terminal 或 Helper）；现有 ConnectionService 每设备单连接模型天然支持，互斥落在连接方式选择（UI/命令层） |
| 3 | DataRecorder Consumer | 新依附型 Consumer（与 LogRecorder 并列，依附 Helper）：纯数据记录到文件，转为**带时间戳的十六进制字符串**以文本存储 |
| 4 | 设备树双连接入口 | 设备节点两个连接按钮：启动 Helper / 启动 Terminal；启动后提供统一断开按钮 |
| 5 | AgentBridge 复用与改造 | Helper 启动后提供 AgentBridge 启动按钮（两种主 Consumer 复用）；前置改造：AgentBridge 构造参数决定是否剥离 ANSI（Terminal 剥离现状不变，Helper 不剥离原样透传） |
| 6 | Webview 主页面 | 关闭主页面等同销毁 Helper 连接；布局参照主流串口助手：左侧大数据区、右侧参数区、下方数据区（界面细节启动时定稿） |

## 3. 评估结论（2026-11-07 简评）

- **架构可行，无阻塞性冲突**：Consumer 抽象（id + attach + host 能力）天然支持第二主类型；每设备单连接模型保证互斥；DataRecorder 与 LogRecorder 结构同构（attach / 懒建文件 / onClosed 收尾），新增成本低；
- **ConnectionService 需小幅改造**：`defaultConsumerFactory` 固定工厂 → 按**连接模式**选择主 Consumer（`connect(device, config, label, mode)` 或双工厂）；契约变化小、向后兼容（不传 mode 默认 Terminal）；
- **AgentBridge 改造小**：构造加 `stripAnsi` 参数，onData / onClosed / 空闲刷出三处分支；
- **主要工作量在 Webview 主页面**：字节流 UI 渲染性能（大数据量 hex dump 的 DOM 压力）需要缓冲刷新与渲染上限策略（见 §5 开放问题）；
- **主 Consumer 语义需在 Consumer 设计文档明确**：主 Consumer 由连接模式决定、依附型挂主、`removeConsumer` 清零规则不变。

## 4. 影响面（启动时细化）

- 新增：`SerialPortHelper.ts`（主 Consumer）、`SerialPortDataRecorder.ts`（依附 Consumer，hex 记录）、Helper Webview（Panel）及注册、package.json 命令/菜单（双连接按钮、断开、AgentBridge）；
- 改造：`SerialPortConnectionService`（按模式选主 Consumer）、`SerialPortAgentBridge`（`stripAnsi` 构造参数）、`SerialPortDeviceManagerTreeView`（双连接按钮与命令路由）；
- 测试：Helper 原样收发、DataRecorder hex 格式与落盘、ConnectionService 模式选择、AgentBridge 剥离开关（单测 + 集成场景扩展）。

## 5. 待办清单与开放问题

### 5.1 核心（v1.6.0 必做）

- [ ] `SerialPortConnectionService` 支持按连接模式选择主 Consumer；
- [ ] `SerialPortHelper` 主 Consumer：原样收发；
- [ ] `SerialPortDataRecorder` 依附 Consumer：hex + 时间戳文本落盘；
- [ ] `SerialPortAgentBridge` 剥离开关（构造参数）；
- [ ] 设备树双连接入口 + 统一断开；
- [ ] Helper Webview 主页面（关闭即断开）。

### 5.2 增强（v1.6.0 可选或后续版本）

- [ ] HEX / ASCII 双模式输入与显示（串口助手标配）；
- [ ] 编码选择（UTF-8 / GBK——中文串口设备常见 GBK，避免显示乱码）；
- [ ] 定时发送（周期自动发送，设备压测）；
- [ ] 发送历史与快捷指令按钮（页内级，区别于全局 Macro）；
- [ ] 流量统计（TX/RX 字节计数与速率）；
- [ ] 接收区控制：暂停滚动、清屏、导出当前会话；
- [ ] DataRecorder 文件定位入口。

### 5.3 开放问题（启动时定稿）

- DataRecorder 记录粒度：每 chunk 一行 vs 定时窗口聚合（频率与可读性权衡）；
- 接收区渲染上限与缓冲策略（长会话内存与 DOM 压力；虚拟滚动 or 环形截断）；
- Macro（全局宏）在 Helper 模式下是否可用/如何呈现；
- 连接参数（波特率等）在 Helper 页内热更并重连的交互；
- DTR/RTS 控制线操作——需要 HAL 契约扩展（`SerialPortHandle` 目前无控制线接口），成本高，倾向独立后续版本；
- 版本计划：v1.6.0（用户 2026-11-07 记录，1.5.x 发布之后）。
