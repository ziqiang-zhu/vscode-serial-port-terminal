import { SerialPortHandle } from '../SerialPortHal';
import { VirtualDeviceProfile } from './VirtualDeviceProfile';

// 虚拟端口句柄：承担画像之外的横切职责——responseDelay 延迟管线、
// 订阅管理与生命周期清理（契约见 doc/Hal/SerialPortHalVirtual规划.md §7）。
// 背压 P0 恒为放行（write 恒返回 true），阻塞模拟归 P3 控制台联动。
export class VirtualPortHandle implements SerialPortHandle {
  private closed = false;
  private opened = false;
  private readonly pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly dataListeners = new Set<(data: Buffer) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly drainListeners = new Set<() => void>();

  constructor(
    private readonly profile: VirtualDeviceProfile,
    private readonly responseDelay: number
  ) {}

  write(data: Buffer): boolean {
    if (this.closed) {
      return true;
    }
    const dispatch = () => {
      if (this.closed) {
        return;
      }
      this.profile.onInput(data, output => this.emitData(output));
    };
    if (this.responseDelay > 0) {
      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer);
        dispatch();
      }, this.responseDelay);
      this.pendingTimers.add(timer);
    } else {
      dispatch();
    }
    return true;
  }

  // 首个数据订阅者就绪时触发画像的 onOpen（欢迎信息先于订阅到达不会丢失）。
  onData(listener: (data: Buffer) => void): void {
    this.dataListeners.add(listener);
    if (!this.opened) {
      this.opened = true;
      this.profile.onOpen(output => this.emitData(output));
    }
  }

  // 虚拟设备不产生运行期错误与背压；订阅口保留以满足接口契约。
  onError(listener: (error: Error) => void): void {
    this.errorListeners.add(listener);
  }

  onDrain(listener: () => void): void {
    this.drainListeners.add(listener);
  }

  close(): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }
    this.closed = true;
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.profile.onClose();
    this.dataListeners.clear();
    this.errorListeners.clear();
    this.drainListeners.clear();
    return Promise.resolve();
  }

  private emitData(data: Buffer): void {
    if (this.closed || data.length === 0) {
      return;
    }
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }
}
