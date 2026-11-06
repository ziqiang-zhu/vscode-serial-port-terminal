import { SerialPortHal, SerialPortHandle, SerialPortInfo, SerialPortOpenOptions } from './SerialPortHal';

// 虚拟设备路径统一前缀（真实设备命名为 COM* / tty* / dev/*，无冲突，见规划 §5）。
export const VIRTUAL_PORT_PREFIX = 'VCOM-';

// 混排 HAL（契约见 doc/Hal/SerialPortHalVirtual规划.md §5、§10.5）：测试构建下真实设备
// 与虚拟设备共存——listDevices 返回两侧并集（真实在前、虚拟在后），openPort 按路径前缀
// 路由：前缀命中走虚拟 HAL（含离线拒绝），其余透传真实 HAL（未知设备的明确报错由真实
// 侧给出）。构造注入接口而非具体实现：单元测试以桩注入真实侧，纯逻辑可直接单测。
// 生产构建（USE_VIRTUAL_HAL = false）不经过本类，仍为纯真实 HAL。
export class SerialPortHalComposite implements SerialPortHal {
  constructor(
    private readonly real: SerialPortHal,
    private readonly virtual: SerialPortHal,
    private readonly prefix = VIRTUAL_PORT_PREFIX
  ) {}

  // 并集枚举，真实在前：设备树中真实设备不因虚拟注册集变化而跳动。
  async listDevices(): Promise<SerialPortInfo[]> {
    const [realDevices, virtualDevices] = await Promise.all([this.real.listDevices(), this.virtual.listDevices()]);
    return [...realDevices, ...virtualDevices];
  }

  openPort(options: SerialPortOpenOptions): Promise<SerialPortHandle> {
    return options.path.startsWith(this.prefix)
      ? this.virtual.openPort(options)
      : this.real.openPort(options);
  }
}
