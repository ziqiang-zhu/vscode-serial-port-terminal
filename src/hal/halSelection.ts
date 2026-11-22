import { SerialPortHal } from './SerialPortHal';
import { SerialPortHalComposite } from './SerialPortHalComposite';
import { SerialPortHalImpl } from './SerialPortHalImpl';
import { EchoProfile } from './SerialPortHalVirtual/EchoProfile';
import { LinuxShellProfile } from './SerialPortHalVirtual/LinuxShellProfile';
import { ReplayProfile } from './SerialPortHalVirtual/ReplayProfile';
import { UBootShellProfile } from './SerialPortHalVirtual/UBootShellProfile';
import { SerialPortHalVirtual } from './SerialPortHalVirtual/SerialPortHalVirtual';

// 编译期开关：源码字面量恒为 false（发布就绪状态，永不手动修改）；测试构建由
// scripts/build.js 经环境变量 USE_VIRTUAL_HAL 在产物级注入 true。三种编译形态
// （产品 / 测试 / 单元测试）见 doc/编译指导.md。
export const USE_VIRTUAL_HAL = false;

// 构造虚拟 HAL（画像 + per-profile 运行态）；enabled 为 false 时返回 undefined（真实 HAL）。
// 生效门控在调用方（extension.ts）：enabled = USE_VIRTUAL_HAL（编译期测试开关，测试构建
// 由 build.js 产物注入 true）|| 用户设置 virtualConsole（产品构建，激活期一次性读取，
// 修改后重启扩展宿主/VS Code 生效）。本函数不再读 USE_VIRTUAL_HAL——导出字面量的
// 发射形态是 build.js 产物注入的锚点，必须原样保留。
// 运行参数取固定默认（延迟 0ms / 速率 100 行每秒 / 不循环 / 无回放文件 / 无应答目录）：
// VDC 仅用于测试，不做长期存储——运行参数经控制台调节（控制面 API），重启回归默认。
export function createVirtualHal(enabled: boolean): SerialPortHalVirtual | undefined {
  if (!enabled) {
    return undefined;
  }
  const onlineRuntime = { online: true, delayMs: 0, backpressure: false };
  return new SerialPortHalVirtual([
    { profile: new EchoProfile(), runtime: { ...onlineRuntime } },
    { profile: new LinuxShellProfile(undefined), runtime: { ...onlineRuntime } },
    { profile: new UBootShellProfile(undefined), runtime: { ...onlineRuntime } },
    {
      profile: new ReplayProfile(undefined, 100, false),
      runtime: { ...onlineRuntime },
    },
  ]);
}

// 测试构建：混排路由（真实 + 虚拟共存，VCOM- 前缀归虚拟）；生产构建：纯真实 HAL（现状不变）。
export function createSerialPortHal(virtualHal: SerialPortHalVirtual | undefined): SerialPortHal {
  return virtualHal
    ? new SerialPortHalComposite(new SerialPortHalImpl(), virtualHal)
    : new SerialPortHalImpl();
}
