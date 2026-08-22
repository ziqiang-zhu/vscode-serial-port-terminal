
# SerialPortHal 设计

## 简介

HAL（硬件抽象层）封装 serialport 第三方包，向服务层提供两个最小能力：**枚举串口设备**与**打开并读写串口**。全项目只有本模块 import 'serialport'。

## 设计目标

- **最小面**：只回答"现在有哪些串口"和"打开/读写这个串口"，不承载任何业务；
- **隔离原生模块风险**：serialport 是原生模块（C++ binding），加载失败、`NODE_MODULE_VERSION` 不匹配、平台差异等问题的处理与降级都收口在本模块；
- **可替换、可测试**：服务层只依赖接口，测试可注入 fake 实现，将来可替换后端（web serial 等）而不触碰业务代码。

## 接口

```ts
export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  locationId?: string;
  productId?: string;
  vendorId?: string;
}

export interface SerialPortOpenOptions {
  path: string;
  baudRate: number;
  dataBits?: number;
  parity?: string;
  stopBits?: number;
  flowControl?: boolean | string;
}

export interface SerialPortHandle {
  close(): Promise<void>;
  write(data: Buffer): void;
  onData(listener: (data: Buffer) => void): void;
  onError(listener: (error: Error) => void): void;
}

export interface SerialPortHal {
  listDevices(): Promise<SerialPortInfo[]>;
  openPort(options: SerialPortOpenOptions): Promise<SerialPortHandle>;
}
```

## 边界

- **不包含**：设备身份计算（设备域）、配置读写（连接域）、状态机（设备域）—— 这些属于上层；
- **错误归一化**：打开失败（设备不存在、被占用、无权限、参数错误）归一化为带明确原因的 Error 抛出，由调用方（Service）提示与回滚；
- `SerialPortHalImpl` 是唯一 import 'serialport' 的实现文件。

## 使用方

| 使用方 | 使用的能力 |
|---|---|
| SerialPortDeviceDetector | `listDevices()` —— 轮询枚举 |
| SerialPortMonitorService | `openPort()` —— 建立连接 |
| SerialPortMonitor | 持有 `SerialPortHandle` —— 数据收发、关闭端口 |
