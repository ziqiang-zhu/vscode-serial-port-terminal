
# SerialPortConsumer 设计

> 状态：已实现 ｜ 目录：`src/SerialPortConnection/SerialPortConsumer.ts` ｜ 上位文档：SerialPortConnection设计.md

## 1. 定位

SerialPortConsumer 是数据**消费方**的通用规范，由 Connection 模块定义。任何接入串口数据流的组件 —— 终端展示、数据转义、可视化、协议分析 —— 均继承这一基类，向 SerialPortConnection 注册。

新增 Consumer 的方式：在 `src/SerialPortConsumer/<组件名>/` 下新建子类，实现基类契约，经 Connection 的注册入口接入。

## 2. 设计目标

- **单向接收**：Consumer 只接收数据；发送必须经 Connection 中枢（host），"唯一触碰数据流"的始终是 Connection；
- **生命周期由 Connection 驱动**：注册（attach）、注销（onClosed）均发生在 Connection 的上下文中，Consumer 不感知端口细节；
- **可管理**：每个 Consumer 有 id 与显示名，支持未来的二级菜单展示与手动关闭（M5）；
- **关闭行为自决**：`onClosed` 时用户可见类型保留视图并提示断开，用户不可见类型直接销毁自身资源 —— 选择权在子类，基类不做假设。

## 3. API 定义

### 3.1 SerialPortConsumerHost —— Connection 向 Consumer 提供的能力

Consumer 注册时由 Connection 注入，是 Consumer 与连接之间的唯一交互通道：

| 成员 | 契约 |
|---|---|
| `readonly path: string` | 所属设备路径，用于显示与日志 |
| `send(data: Buffer)` | 向串口发送数据，Consumer 的**唯一**发送途径 |
| `requestDisconnect()` | 请求断开连接，由 Connection 转交 Service 的销毁流程（终端内断开走这里） |

### 3.2 SerialPortConsumer —— 抽象基类

```ts
export abstract class SerialPortConsumer {
  abstract readonly id: string;          // 唯一标识（未来二级菜单的键）
  abstract readonly displayName: string; // 显示名（未来二级菜单展示）
  abstract onData(data: Buffer): void;   // 接收数据，必须实现
  abstract onClosed(): void;             // 连接销毁通知：可见类型提示断开并保留视图，不可见类型销毁资源
  onError?(error: Error): void;          // 可选：运行期错误

  attach(host: SerialPortConsumerHost): void; // 注册时由 Connection 调用
  protected send(data: Buffer): void;         // 转发到 host
  protected requestDisconnect(): void;        // 转发到 host
}
```

- `attach` 后基类持有 host，子类经受保护的 `send` / `requestDisconnect` 使用；
- `onData` 由 Connection 的数据流入口调用，调用顺序即串口到达顺序；
- 基类不关心数据的解析、转义、配色 —— 那是各 Consumer 自身职责。

## 4. 注册与生命周期

```
Service.connect 成功
    → 构造 Connection
    → Service 经工厂注册默认 Consumer（SerialPortTerminal）
        → Connection.addConsumer(terminal)
        → terminal.attach(host)
    → 数据到达 → terminal.onData(data)
断开 / 拔除 / 扩展停用
    → Connection 销毁前逐个调用 consumer.onClosed()
    → Consumer 按自身类型处理关闭（保留视图并提示 / 直接销毁）
```

| 规则 | 说明 |
|---|---|
| `addConsumer(consumer)` | 注册并 attach；同 id 重复注册时先对旧实例执行 `onClosed` |
| `removeConsumer(id)` | 注销指定 Consumer（M5 二级菜单"手动关闭"走这里） |
| Consumer 减为零 | Connection 通知 Service → 关闭串口并销毁 Connection（等同于一次断开） |
| 默认 Consumer | SerialPortTerminal，由 Service 在 connect 成功后经工厂注册；其移除同样适用"减为零"规则 |

### 4.1 关闭行为约定

`onClosed` 的实现由 Consumer 类型自行决定：

- **用户可见类型**（如 SerialPortTerminal）：保留视图并提示"已断开"，日志可继续回看；此后视图进入冻结态（数据与输入均失效）；
- **用户不可见类型**（如未来的 Logger）：直接在 `onClosed` 中销毁自身资源。

该约定不写入接口：基类不做假设，保留/销毁的选择权完全在子类。

## 5. 数据流向

```
串口 → HAL 句柄 onData
    → Connection 分发给每个已注册 Consumer.onData(data)
    → Terminal 显示 / DataPaster 转义 / 分析器处理（各自内部）
```

Connection 只广播不加工；Consumer 之间的协作（如 DataPaster 的转义结果供 Terminal 使用）不经过 Connection，由 Consumer 内部自行编排。若未来出现共享转义结果的管道需求，再引入 Processor 概念，不扩充 Consumer 契约。

## 6. 组件结构

```mermaid
classDiagram
    class SerialPortConsumer {
        <<abstract>>
        +id
        +displayName
        +onData(data)
        +onClosed()
        +attach(host)
        #send(data)
        #requestDisconnect()
    }
    class SerialPortConsumerHost {
        <<interface>>
        +path
        +send(data)
        +requestDisconnect()
    }
    class SerialPortConnection {
        +addConsumer(consumer)
        +removeConsumer(id)
    }
    SerialPortConnection --> SerialPortConsumer : 注册并广播
    SerialPortConnection ..|> SerialPortConsumerHost : 实现
    SerialPortConsumer --> SerialPortConsumerHost : attach 注入
```

## 7. 路线图

- **M3**：SerialPortTerminal 作为默认 Consumer（已落地），输入增强与 Parser 演进；
- **M5**：多 Consumer 注册、二级菜单展示与手动关闭、减为零自动关串口。
