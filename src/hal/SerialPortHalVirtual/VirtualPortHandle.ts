import { SerialPortHandle } from '../SerialPortHal';
import { VirtualDeviceProfile } from './VirtualDeviceProfile';

// per-profile 运行态：控制面可变（在线 / 延迟 / 背压），句柄与门面共享同一引用——
// 控制面修改即时作用于存活句柄。
export interface VirtualRuntime {
  online: boolean;
  delayMs: number;
  backpressure: boolean;
}

export const newRuntime = (): VirtualRuntime => ({ online: true, delayMs: 0, backpressure: false });

// 虚拟端口句柄：承担画像之外的横切职责——responseDelay 延迟管线、背压排队语义、
// 设备侧注入、订阅管理与生命周期清理（契约见 doc/Hal/SerialPortHalVirtual规划.md §7）。
export class VirtualPortHandle implements SerialPortHandle {
  private closed = false;
  private opened = false;
  private readonly pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly queued: Buffer[] = [];
  private readonly dataListeners = new Set<(data: Buffer) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();
  private readonly drainListeners = new Set<() => void>();

  constructor(
    private readonly profile: VirtualDeviceProfile,
    // 运行态按引用共享（与 HAL 持有的是同一对象）：控制面修改即时作用于存活句柄。
    private readonly runtime: VirtualRuntime = { online: true, delayMs: 0, backpressure: false }
  ) {}

  // 背压阻塞：write 排队返回 false（模拟驱动缓冲，字节不丢失）；放行后按序送达。
  write(data: Buffer): boolean {
    if (this.closed) {
      return true;
    }
    if (this.runtime.backpressure) {
      this.queued.push(data);
      return false;
    }
    this.dispatch(data);
    return true;
  }

  // 控制面放行：按序送达排队数据并触发 onDrain（模拟驱动缓冲排空）。
  releaseBackpressure(): void {
    const queued = this.queued.splice(0);
    for (const chunk of queued) {
      this.dispatch(chunk);
    }
    if (queued.length > 0) {
      for (const listener of this.drainListeners) {
        listener();
      }
    }
  }

  // 设备侧注入：以对端视角向订阅者推送数据（不经画像处理，控制台/调试用）。
  injectFromDevice(data: Buffer): void {
    this.emitData(data);
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
    this.queued.length = 0;
    this.profile.onClose();
    this.dataListeners.clear();
    this.errorListeners.clear();
    this.drainListeners.clear();
    return Promise.resolve();
  }

  private dispatch(data: Buffer): void {
    const delay = this.runtime.delayMs;
    const run = () => this.profile.onInput(data, output => this.emitData(output));
    if (delay > 0) {
      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer);
        run();
      }, delay);
      this.pendingTimers.add(timer);
    } else {
      run();
    }
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
