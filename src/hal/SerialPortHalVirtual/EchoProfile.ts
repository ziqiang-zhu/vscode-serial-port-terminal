import { SerialPortInfo } from '../SerialPortHal';
import { VirtualDeviceProfile, VirtualDeviceKind, VirtualEmit } from './VirtualDeviceProfile';

// 回显画像：输入什么回显什么，用于验证数据管道与 AgentBridge 字节透传。
export class EchoProfile extends VirtualDeviceProfile {
  readonly info: SerialPortInfo = { path: 'VCOM-ECHO', manufacturer: 'Virtual' };
  readonly kind: VirtualDeviceKind = 'echo';

  onInput(data: Buffer, emit: VirtualEmit): void {
    emit(data);
  }
}
