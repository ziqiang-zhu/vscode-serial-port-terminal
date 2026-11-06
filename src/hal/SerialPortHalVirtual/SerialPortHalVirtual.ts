import { SerialPortHal, SerialPortHandle, SerialPortInfo, SerialPortOpenOptions } from '../SerialPortHal';
import { CommandShellProfile } from './CommandShellProfile';
import { EchoProfile } from './EchoProfile';
import { LinuxShellProfile } from './LinuxShellProfile';
import { ReplayProfile } from './ReplayProfile';
import { UBootShellProfile } from './UBootShellProfile';
import { VirtualDeviceProfile, VirtualDeviceKind } from './VirtualDeviceProfile';
import { VirtualPortHandle, VirtualRuntime } from './VirtualPortHandle';

export type { VirtualDeviceKind };

// SerialPortHal 的虚拟设备实现（契约见 doc/Hal/SerialPortHalVirtual规划.md）。
// 纯逻辑组件：不 import vscode 与第三方包，runtime / interactionDir / replay*
// 由装配层读配置后构造注入，保证可直接纳入 node:test 单元测试。
// 默认注册集为当前已实现画像全集（P0 Echo + P1 Linux / U-Boot + P2 Replay）。

export interface VirtualConsoleEntry {
  path: string;
  kind: VirtualDeviceKind;
  online: boolean;
  delayMs: number;
  backpressure: boolean;
  rate?: number;
  loop?: boolean;
  file?: string;
}

interface VirtualEntry {
  profile: VirtualDeviceProfile;
  runtime: VirtualRuntime;
  handle?: VirtualPortHandle;
}

const defaultEntries = (): { profile: VirtualDeviceProfile }[] => [
  { profile: new EchoProfile() },
  { profile: new LinuxShellProfile() },
  { profile: new UBootShellProfile() },
  { profile: new ReplayProfile() },
];

export class SerialPortHalVirtual implements SerialPortHal {
  private readonly entries = new Map<string, VirtualEntry>();

  constructor(
    entries: { profile: VirtualDeviceProfile; runtime?: Partial<VirtualRuntime> }[] = defaultEntries()
  ) {
    for (const entry of entries) {
      const runtime: VirtualRuntime = {
        online: true,
        delayMs: 0,
        backpressure: false,
        ...entry.runtime,
      };
      this.entries.set(entry.profile.info.path, { profile: entry.profile, runtime });
    }
  }

  listDevices(): Promise<SerialPortInfo[]> {
    return Promise.resolve(
      [...this.entries.values()].filter(entry => entry.runtime.online).map(entry => entry.profile.info)
    );
  }

  // 任意参数均成功打开（参数忽略，契约 §7.3）；路径必须命中画像且在线（拔出/未知均有明确原因）。
  openPort(options: SerialPortOpenOptions): Promise<SerialPortHandle> {
    const entry = this.entries.get(options.path);
    if (!entry) {
      return Promise.reject(new Error(`Virtual port not found: ${options.path}`));
    }
    if (!entry.runtime.online) {
      return Promise.reject(new Error(`Virtual port offline: ${options.path}`));
    }
    const handle = new VirtualPortHandle(entry.profile, entry.runtime);
    entry.handle = handle;
    return Promise.resolve(handle);
  }

  // —— 控制面（P3，仅虚拟设备控制台使用；SerialPortHal 契约之外的能力）——

  // 设备侧注入：向该端口订阅者推送数据（端口未打开则静默丢弃）。
  inject(path: string, data: Buffer): void {
    this.entries.get(path)?.handle?.injectFromDevice(data);
  }

  // 上线 / 拔出：拔出经 listDevices 过滤走 Detector removed 的真实销毁链。
  setOnline(path: string, online: boolean): void {
    const entry = this.entries.get(path);
    if (entry) {
      entry.runtime.online = online;
    }
  }

  setBackpressure(path: string, blocked: boolean): void {
    const entry = this.entries.get(path);
    if (!entry) {
      return;
    }
    entry.runtime.backpressure = blocked;
    if (!blocked) {
      entry.handle?.releaseBackpressure();
    }
  }

  setDelay(path: string, delayMs: number): void {
    const entry = this.entries.get(path);
    if (entry && Number.isFinite(delayMs) && delayMs >= 0) {
      entry.runtime.delayMs = delayMs;
    }
  }

  setRate(path: string, linesPerSecond: number): void {
    const profile = this.entries.get(path)?.profile;
    if (profile instanceof ReplayProfile) {
      profile.setRate(linesPerSecond);
    }
  }

  setLoop(path: string, loop: boolean): void {
    const profile = this.entries.get(path)?.profile;
    if (profile instanceof ReplayProfile) {
      profile.setLoop(loop);
    }
  }

  setReplayFile(path: string, file: string): void {
    const profile = this.entries.get(path)?.profile;
    if (profile instanceof ReplayProfile) {
      profile.setFile(file);
    }
  }

  setInteractionDir(path: string, dir: string): void {
    const profile = this.entries.get(path)?.profile;
    if (profile instanceof CommandShellProfile) {
      profile.setInteractionDir(dir.trim() ? dir.trim() : undefined);
    }
  }

  // 控制台状态快照：设备清单（含离线）+ 各画像可调参数。
  getConsoleEntries(): VirtualConsoleEntry[] {
    return [...this.entries.values()].map(entry => ({
      path: entry.profile.info.path,
      kind: entry.profile.kind,
      online: entry.runtime.online,
      delayMs: entry.runtime.delayMs,
      backpressure: entry.runtime.backpressure,
      ...(entry.profile instanceof ReplayProfile
        ? {
            rate: entry.profile.getRate(),
            loop: entry.profile.getLoop(),
            file: entry.profile.getFile() ?? '',
          }
        : {}),
    }));
  }
}
