import * as vscode from 'vscode';
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

// 测试构建：构造虚拟 HAL（画像 + per-profile 运行态）；生产构建：undefined（真实 HAL）。
export function createVirtualHal(): SerialPortHalVirtual | undefined {
  if (!USE_VIRTUAL_HAL) {
    return undefined;
  }
  const delayMs = readResponseDelay();
  const interactionDir = readInteractionDir();
  const onlineRuntime = { online: true, delayMs, backpressure: false };
  return new SerialPortHalVirtual([
    { profile: new EchoProfile(), runtime: { ...onlineRuntime } },
    { profile: new LinuxShellProfile(interactionDir), runtime: { ...onlineRuntime } },
    { profile: new UBootShellProfile(interactionDir), runtime: { ...onlineRuntime } },
    {
      profile: new ReplayProfile(readReplayFile(), readReplayRate(), readReplayLoop()),
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

function readResponseDelay(): number {
  const raw = vscode.workspace
    .getConfiguration('serialPortTerminal.testMode')
    .get<number>('responseDelay', 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function readInteractionDir(): string | undefined {
  const raw = vscode.workspace
    .getConfiguration('serialPortTerminal.testMode')
    .get<string>('interactionDir', '');
  return raw && raw.trim() ? raw.trim() : undefined;
}

function readReplayFile(): string | undefined {
  const raw = vscode.workspace
    .getConfiguration('serialPortTerminal.testMode')
    .get<string>('replayFile', '');
  return raw && raw.trim() ? raw.trim() : undefined;
}

function readReplayRate(): number {
  const raw = vscode.workspace
    .getConfiguration('serialPortTerminal.testMode')
    .get<number>('replayRate', 100);
  return Number.isFinite(raw) && raw >= 1 ? raw : 100;
}

function readReplayLoop(): boolean {
  return vscode.workspace
    .getConfiguration('serialPortTerminal.testMode')
    .get<boolean>('replayLoop', false);
}
