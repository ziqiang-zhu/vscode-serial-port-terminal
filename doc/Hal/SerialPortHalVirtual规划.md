# SerialPortHalVirtual 设计

> 状态：P0 / P1 / P2 已实现（P3 / P4 规划中）｜ 目录：`src/hal/SerialPortHalVirtual/` ｜ 上位文档：[总体架构.md](../总体架构.md) ｜ 契约：[SerialPortHal设计.md](SerialPortHal设计.md)

## 1. 定位

SerialPortHalVirtual 是产品测试模式的载体：`SerialPortHal` 接口的虚拟设备实现，与 `SerialPortHalImpl` 并列，经编译期开关进入构建，仅用于测试模式。上层 Detector、ConnectionService、Connection 与全部 Consumer 零改动地运行在虚拟设备之上，配套虚拟设备控制台（§8）提供设备侧的运行时控制。

用途：

- 无硬件体验完整链路：连接、终端交互、日志保存、AgentBridge 全部可用；
- 开发与调试 agent-bridge-skills：AI Agent 经 AgentBridge 操作虚拟终端；
- 以真实采集日志为数据源，验证日志相关能力（每行时间戳、ANSI 剥离、按大小分割）。

## 2. 设计目标

- **零业务侵入**：虚拟实现只存在于 HAL 层与装配层，不触碰任何服务层与 Consumer，见 [SerialPortHal设计.md](SerialPortHal设计.md) §2「可替换、可测试」；
- **编译期隔离**：虚拟 HAL 经源码开关进入构建，不存在运行时切换与设置切换；生产发布构建必须为真实 HAL；
- **显式区分**：虚拟设备在树视图中带 Virtual 标注，与真实设备明确区分；
- **参数容错**：连接参数（波特率、帧格式、流控）允许正常设置，实现直接忽略，上层连接流程不因虚拟设备产生分支；
- **行为可扩展**：命令应答表驱动，应答目录文件覆盖内置表，新增虚拟指令不需要改代码。

## 3. 设备清单

测试构建下默认提供四台虚拟设备，每台固定一个实例（`listDevices` 只返回虚拟设备）：

| 设备 | 路径 | 画像 | 用途 |
|---|---|---|---|
| 回显设备 | `VCOM-ECHO` | Echo | 管道验证：输入什么回显什么 |
| Linux 终端设备 | `VCOM-LINUX` | LinuxShell | Agent 连接测试：常用命令固定应答 |
| U-Boot 终端设备 | `VCOM-UBOOT` | UBootShell | Agent 连接测试：U-Boot 命令集固定应答 |
| 日志回放设备 | `VCOM-REPLAY` | Replay | 按可调速率回放日志文件 |

设备随画像落地分阶段注册：P0 仅提供 VCOM-ECHO，P1/P2 补齐 Linux / U-Boot / Replay，四台齐备为最终形态。`manufacturer` 字段固定为 `Virtual`——设备列表的行描述与悬浮提示由此自带 Virtual 标注，无需 UI 层改动（完整控制台见 §8）。

设备默认在线；控制台可切换「拔出 / 上线」模拟热插拔事件链（见 §8）。设备身份走退化链第三级（path 兜底）——虚拟设备路径固定且稳定，见 [SerialPortDeviceDetector设计.md](../SerialPortDeviceDetector设计.md) §4.1。

## 4. 设备画像

### 4.1 Echo（回显）

收到什么回什么，数据原样回显。用于验证数据管道与 [AgentBridge](../ConsumerDesign/SerialPortAgentBridge设计.md) 的字节透传。

### 4.2 LinuxShell（虚拟 Linux 终端）

- 打开端口时输出欢迎信息与提示符 `root@localhost:~# `；
- 命令按行匹配应答，内置默认表：

| 命令 | 应答 |
|---|---|
| `help` | 支持的命令清单 |
| `uname -a` | 固定的内核信息行 |
| `ls` / `pwd` | 预置目录列表 / 路径 |
| `echo <文本>` | 回显文本 |
| `cat <文件>` | 预置文件内容 |
| 其余命令 | `bash: <命令>: command not found` |

- 应答来源与文件覆盖约定见 §4.5；
- **远端回显**：画像自行回显键入字符（真实串口终端的回显来自设备端），保证终端内输入可见。

### 4.3 UBootShell（虚拟 U-Boot 终端）

同 LinuxShell：打开时输出版本横幅与提示符 `=>`，内置默认表：

| 命令 | 应答 |
|---|---|
| `help` | 支持的命令清单 |
| `version` | 固定的 U-Boot 版本信息 |
| `printenv` | 预置环境变量 |
| 其余命令 | `Unknown command '<命令>' - try 'help'` |

应答来源与文件覆盖约定见 §4.5。开机倒计时与 `boot` 命令切换 Linux 会话的状态机链路列入演进，首版两个画像相互独立。

### 4.4 Replay（日志回放）

- 数据源为纯文本日志文件（配置 `testMode.replayFile`），**打开端口时读取**（重新连接即加载最新文件），按**原始字节切片**逐行播放（`\r\n` 行尾与多字节字符字节级保真）；
- **速率语义（已定稿）：行/秒**——`testMode.replayRate` = 每秒播放行数，默认 `100`、最小 `1`；内部以 100ms 节拍批发（每节拍 `N/10` 行，余数累进），高速率自动合并为大批次（契合真实串口的 chunk 到达形态）；
- 播放完成（EOF）：`testMode.replayLoop=true` 从头循环，`false` 停止播放（设备保持在线、静默）；
- `replayFile` 未配置或文件不可读：设备照常枚举与打开，但无任何输出（静默设备）；
- 主机侧输入被忽略（回放设备为纯数据源）；播放随端口 close 停止；整文件读入内存（开发工具定位，数十 MB 量级日志可接受）。

### 4.5 应答目录（交互型画像）

LinuxShell 与 UBootShell 的命令应答支持文件覆盖：

- 配置 `serialPortTerminal.testMode.interactionDir` 指定应答根目录，子目录 `linux/`、`uboot/` 分别对应两个画像（两画像存在同名命令，如 `help`，单层目录会冲突）；
- 文件名 = 命令行（如 `uname -a.txt`、`printenv.txt`），文件内容 = 静态应答文本，输出时自动补换行与提示符；
- 子目录或命令文件缺省时回退内置默认表；
- 文件名受 Windows 合法字符限制，含 `\ / : * ? " < > |` 的命令无法以文件覆盖，保留内置表应答；
- Echo 无命令表、Replay 属日志型，均不适用本约定。

## 5. 装配与选择（编译期）

- 源码开关常量（`src/hal/halSelection.ts` 的 `USE_VIRTUAL_HAL = false`）决定 `extension.ts` 注入的实现；不存在运行时切换，也不提供设置项；
- 本 HAL 仅用于测试模式：`vscode:prepublish` 以 `node scripts/verify-hal-selection.js` 为第二道前置（测试门禁之后），脚本校验源码中开关字面量为 `false`，未复位则非零退出、拒绝打包；
- 测试构建下设备来源**完全替换**：`listDevices` 只返回虚拟设备，虚拟与真实设备不混排；按路径前缀分发两级 HAL 的混排路由列入演进；
- 生命周期语义与真实设备一致：断开、关闭终端面板、扩展停用均走上层统一销毁流程，虚拟句柄在 `close` 时停止回放与定时器。

## 6. 配置（草案）

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `serialPortTerminal.testMode.replayFile` | string | `""` | 回放设备的纯文本日志文件路径 |
| `serialPortTerminal.testMode.replayRate` | number | `100` | 回放速率（行/秒），最小 1；语义见 §4.4 |
| `serialPortTerminal.testMode.replayLoop` | boolean | `false` | 播放到文件末尾后是否循环 |
| `serialPortTerminal.testMode.responseDelay` | number | `0` | 命令应答延迟（ms），模拟真实设备的异步响应 |
| `serialPortTerminal.testMode.interactionDir` | string | `""` | 交互型画像的应答根目录，约定见 §4.5 |

配置项为草案，实现时定稿。虚拟 HAL 的启停由编译期开关决定（§5），不设运行期测试模式开关。

## 7. 关键机制

### 7.1 输入处理管线

```
handle.write(data) → responseDelay 延迟 → 画像处理 → emit onData(输出)
```

命令应答类画像内部维护行缓冲，按 `\r` 切分出命令行后查表匹配；Echo 与 Replay 不做行缓冲。

### 7.2 背压模拟

控制台状态按钮切换「阻塞 / 放行」：阻塞时 `write` 返回 `false`，放行时触发 `onDrain`，为 HAL 的已知限制「write 背压信号未消费」（见 [SerialPortHalImpl实现.md](SerialPortHalImpl实现.md) §5）提供无硬件的验证手段。

### 7.3 参数忽略

`openPort` 对任何 `SerialPortOpenOptions` 都成功打开，参数不生效，仅记录 debug 级日志便于排查。

## 8. 虚拟设备控制台（WebviewView）

侧边栏视图，挂在现有 `serialPortTerminalSideBar` 容器下。**全部虚拟设备共享一个控制台**，仅提供通用控制操作，不含画像专属界面。

| 控制项 | 形式 | 说明 |
|---|---|---|
| 目标设备 | 下拉框 | 切换当前控制的虚拟设备 |
| 在线 / 拔出 | 状态按钮 | 拔出时该设备从 `listDevices` 消失，经 Detector removed 事件走真实的连接销毁链；上线后恢复出现在设备列表 |
| 背压阻塞 / 放行 | 状态按钮 | 控制该设备 `write` 的背压行为（见 §7.2） |
| 应答延迟 | 数值输入 | 精确值（ms），不用滑杆类模糊控件 |
| 回放速率 | 数值输入 | 精确值 |
| 回放循环 | 状态按钮 | 切换 `replayLoop` |
| 回放文件 | 文件选择入口 | 选择纯文本日志文件，写入 `testMode.replayFile` |
| 应答根目录 | 目录选择入口 | 选择交互型画像应答根目录，写入 `testMode.interactionDir`（约定见 §4.5） |
| 数据注入 | 文本输入 + 发送 | 以设备侧视角向串口对端注入任意数据，用于模拟设备主动输出 |

实现约定：

- Webview ↔ 扩展主进程经 `postMessage` 通信，消息协议包含 `select` / `setOnline` / `setBackpressure` / `setDelay` / `setRate` / `setLoop` / `setFiles` / `inject` 与反向的 `stateChanged`；
- `SerialPortHalVirtual` 在 `SerialPortHal` 契约之外暴露**控制面 API**（`inject` / `setOnline` / `setBackpressure` / `setDelay` / `setRate` / `setLoop` / `setReplayFile` / `setInteractionDir`），仅控制台使用，不影响 HAL 契约本身；
- 控制台随编译期开关进入构建，生产构建不注册该视图。

## 9. 不做范围

- 桥接本地真实 shell（node-pty 原生依赖，风险等级与 serialport 相同）；
- 用户自定义 expect 规则引擎；
- CTS/RTS 流控线路信号模拟。

## 10. 演进路线

- **P0**（实施拆分见 §10.1）：编译期开关 + prepublish 校验 + HAL 骨架 + Echo 画像，跑通测试构建下的连接与终端交互；
- **P1**（实施拆分见 §10.2）：LinuxShell / UBootShell 画像（内置默认表 + 应答目录覆盖 + 远端回显），支撑 agent-bridge-skills 调试；
- **P2**（实施拆分见 §10.3）：Replay 画像（文件回放、行/秒速率、循环）；
- **P3**：虚拟设备控制台（WebviewView：设备下拉、状态按钮、精确数值输入、文件入口、数据注入）+ 背压模拟；
- **P4**：U-Boot → Linux 开机链路、混排路由。

### 10.1 P0 实施拆分

| # | 内容 | 落点 |
|---|---|---|
| 1 | 编译期开关与 HAL 工厂 | `src/hal/halSelection.ts`：`USE_VIRTUAL_HAL = false` 常量 + `createSerialPortHal()` 工厂；`extension.ts` 改用工厂获取 HAL（默认分支行为不变） |
| 2 | HAL 骨架 | `src/hal/SerialPortHalVirtual/`：`SerialPortHalVirtual`（`listDevices` 返回已注册画像、`openPort` 任意参数成功）、`VirtualPortHandle`（write / onData / onError / onDrain / close，含 `responseDelay` 延迟管线与 close 时定时器清理）、`VirtualDeviceProfile` 抽象基类（`onOpen` / `onInput(data, emit)` / `onClose`） |
| 3 | Echo 画像 | `EchoProfile`：`onInput` 将输入原样 `emit`；P0 仅注册此一台（`VCOM-ECHO`，manufacturer=`Virtual`） |
| 4 | 防误发布校验 | `scripts/verify-hal-selection.js`：校验 `halSelection.ts` 中开关字面量为 `false`；`vscode:prepublish` 追加该前置 |
| 5 | 单元测试 | 用例清单见 `doc/Test/开发测试体系规划.md` §6.5（11 例：设备枚举、参数忽略、回显、保序、延迟、close 语义、订阅口完整性） |

实现约束：虚拟 HAL 不 import `vscode` 与第三方包（`responseDelay` 经构造参数注入、由装配层读配置传入），保持纯逻辑可直接单测；背压 P0 恒为放行（`write` 恒返回 `true`），仅保留接口。

### 10.2 P1 实施拆分

| # | 内容 | 落点 |
|---|---|---|
| 1 | 命令壳基类 | `CommandShellProfile`（抽象，继承 `VirtualDeviceProfile`）：**远端回显**（输入原样 echo，`\r` 回显为 `\r\n`）、**行缓冲**（`\r` / `\n` 为终止符，跨 chunk 累积）、**应答管线**（命令行 → 查应答 → 输出 + `\r\n` 行尾 + 提示符）、`onClose` 清缓冲；`EchoProfile` 不受影响 |
| 2 | LinuxShell 画像 | `LinuxShellProfile`：横幅 `Welcome to Virtual Linux (busybox)` + 提示符 `root@localhost:~# `；内置表 `help` / `uname -a` / `ls` / `pwd` / 参数化 `echo <文本>` / 参数化 `cat <路径>`（固定内容块）；未知命令 `bash: <命令>: command not found` |
| 3 | UBootShell 画像 | `UBootShellProfile`：横幅 `U-Boot 2023.10-virtual` + 提示符 `=> `；内置表 `help` / `version` / `printenv`（预置环境变量块）；未知命令 `Unknown command '<命令>' - try 'help'` |
| 4 | 复合命令解析 | 按 `;` 分隔依次执行、输出顺序拼接——**设计点，支撑 agent-bridge-skills 的标准模式** `echo __MARK_BEGIN__; <命令>; echo __MARK_END__`（标记检测要求各标记独占一行，无此解析则虚拟 Linux 无法配合技能仓库） |
| 5 | 应答目录覆盖 | 画像构造参数注入 `interactionDir`（装配层读 `testMode.interactionDir` 传入，纯逻辑约束不变）；子目录 `linux/`、`uboot/`；文件名 = 命令行 + `.txt`、内容 = 应答文本；**优先级：精确文件 > 精确内置 > 参数化内置 > 未知回退**；目录/文件缺省回退内置；Windows 非法文件名字符的命令无法覆盖，保留内置表 |
| 6 | 注册 | `halSelection.ts` 测试分支注册三台设备（Echo + Linux + UBoot），`listDevices` 返回三项；均 manufacturer=`Virtual` |
| 7 | 单元测试 | 用例清单见 `doc/Test/开发测试体系规划.md` §6.6（20 例） |

行为细节（实现即定稿）：应答与提示符行尾一律 `\r\n`（真实串口终端习惯，term.js 的独占一行标记检测兼容）；空回车（仅 `\r`）只回显换行 + 新提示符；`responseDelay` 延迟作用于整个 `onInput` 分发（回显与应答同时延迟到达），逐 chunk 时序微调归 P3 控制台。

> **现状（2026-11-05）**：P1 已实现——`CommandShellProfile` 基类 + Linux / U-Boot 两画像按上表落地，20 例单测全绿（`doc/Test/开发测试体系规划.md` §6.6），复合命令解析（#4）按推荐实现。

### 10.3 P2 实施拆分

| # | 内容 | 落点 |
|---|---|---|
| 1 | Replay 画像 | `ReplayProfile`（继承 `VirtualDeviceProfile`，不经命令壳基类）：构造注入 `(file?, rate = 100, loop = false)`；`onOpen` 读取文件 + 启动 100ms 节拍批发（余数累进）；EOF 按 `loop` 循环/停止；`onClose` 清定时器；`onInput` 忽略；文件按原始字节切片（含行尾），内容字节级保真 |
| 2 | 装配 | `halSelection.ts` 注册第四台设备（读 `replayFile` / `replayRate` / `replayLoop` 配置注入）；`SerialPortHalVirtual` 默认注册集扩为四台 |
| 3 | 单元测试 | 用例清单见 `doc/Test/开发测试体系规划.md` §6.7（13 例，`mock.timers` 控时） |

实现约束沿用 §10.1：纯逻辑（仅 Node 内建 fs）、无 vscode 依赖；运行时速率调整归 P3 控制面 API。

> **现状（2026-11-05）**：P2 已实现——`ReplayProfile` 按上表落地（节拍累进采用 ms 基整数规避浮点漂移），13 例单测全绿（`doc/Test/开发测试体系规划.md` §6.7），四台虚拟设备齐备（§3 最终形态）。

## 11. 组件结构

```mermaid
classDiagram
    class SerialPortHal {
        <<interface>>
        +listDevices()
        +openPort(options)
    }
    class SerialPortHandle {
        <<interface>>
        +close()
        +write(data): boolean
        +onDrain(listener)
        +onData(listener)
        +onError(listener)
    }
    class SerialPortHalVirtual {
        -profiles: Map~path, VirtualDeviceProfile~
        +listDevices()
        +openPort(options)
        +inject(data)
        +setOnline(path, online)
        +setBackpressure(path, blocked)
        +setDelay(path, ms)
        +setRate(path, rate)
        +setReplayFile(path, file)
        +setInteractionDir(dir)
    }
    class VirtualPortHandle {
        -profile: VirtualDeviceProfile
    }
    class VirtualDeviceProfile {
        <<abstract>>
        +onOpen(emit)
        +onInput(data, emit)
        +onClose()
    }
    class CommandShellProfile {
        <<abstract>>
        +banner / prompt
        -lineBuffer
        -resolve(commandLine)
    }
    class EchoProfile
    class LinuxShellProfile {
        -commands: CommandTable
    }
    class UBootShellProfile {
        -commands: CommandTable
    }
    class ReplayProfile {
        -file
        -rate
        -loop
        -lineIndex
        -carry
    }
    class VirtualDeviceConsole {
        <<WebviewView>>
        +设备下拉 / 状态按钮 / 数值输入 / 文件入口 / 数据注入
    }
    SerialPortHalVirtual ..|> SerialPortHal : 实现
    VirtualPortHandle ..|> SerialPortHandle : 实现
    SerialPortHalVirtual --> VirtualPortHandle : 创建
    VirtualPortHandle --> VirtualDeviceProfile : 持有
    VirtualDeviceProfile <|-- EchoProfile
    VirtualDeviceProfile <|-- CommandShellProfile
    CommandShellProfile <|-- LinuxShellProfile
    CommandShellProfile <|-- UBootShellProfile
    VirtualDeviceProfile <|-- ReplayProfile
    VirtualDeviceConsole --> SerialPortHalVirtual : 控制面 API（postMessage）
```
