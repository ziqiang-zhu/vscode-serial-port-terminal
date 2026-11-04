import { SerialPortInfo } from '../SerialPortHal';

// 画像输出回调：画像产生的数据经此回到 VirtualPortHandle 并分发给订阅者。
export type VirtualEmit = (data: Buffer) => void;

// 虚拟设备画像抽象基类：一台虚拟设备的全部行为（契约见 doc/Hal/SerialPortHalVirtual规划.md §4）。
// 画像为纯逻辑组件，不感知句柄、定时器与配置——延迟与生命周期由 VirtualPortHandle 统一承担。
export abstract class VirtualDeviceProfile {
  abstract readonly info: SerialPortInfo;

  // 端口打开且首个订阅者就绪后调用一次（欢迎信息 / 提示符输出窗口）。
  onOpen(_emit: VirtualEmit): void {}

  // 收到主机侧输入（write），产生的输出经 emit 返回。
  abstract onInput(data: Buffer, emit: VirtualEmit): void;

  // 端口关闭时调用，画像清理自身状态。
  onClose(): void {}
}
