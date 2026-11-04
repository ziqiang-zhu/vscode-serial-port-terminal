import { SerialPortHal, SerialPortHandle, SerialPortInfo, SerialPortOpenOptions } from '../SerialPortHal';
import { EchoProfile } from './EchoProfile';
import { VirtualDeviceProfile } from './VirtualDeviceProfile';
import { VirtualPortHandle } from './VirtualPortHandle';

// SerialPortHal 的虚拟设备实现（契约见 doc/Hal/SerialPortHalVirtual规划.md）。
// 纯逻辑组件：不 import vscode 与第三方包，responseDelay 由装配层读配置后构造注入，
// 保证可直接纳入 node:test 单元测试。
export class SerialPortHalVirtual implements SerialPortHal {
  private readonly profiles: VirtualDeviceProfile[];
  private readonly responseDelay: number;

  constructor(profiles: VirtualDeviceProfile[] = [new EchoProfile()], responseDelay = 0) {
    this.profiles = profiles;
    this.responseDelay = responseDelay;
  }

  listDevices(): Promise<SerialPortInfo[]> {
    return Promise.resolve(this.profiles.map(profile => profile.info));
  }

  // 任意参数均成功打开（参数忽略，契约 §7.3）；仅路径必须命中已注册画像。
  openPort(options: SerialPortOpenOptions): Promise<SerialPortHandle> {
    const profile = this.profiles.find(item => item.info.path === options.path);
    if (!profile) {
      return Promise.reject(new Error(`Virtual port not found: ${options.path}`));
    }
    return Promise.resolve(new VirtualPortHandle(profile, this.responseDelay));
  }
}
