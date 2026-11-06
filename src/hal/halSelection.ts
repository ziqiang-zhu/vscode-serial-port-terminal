import * as vscode from 'vscode';
import { SerialPortHal } from './SerialPortHal';
import { SerialPortHalImpl } from './SerialPortHalImpl';
import { EchoProfile } from './SerialPortHalVirtual/EchoProfile';
import { LinuxShellProfile } from './SerialPortHalVirtual/LinuxShellProfile';
import { ReplayProfile } from './SerialPortHalVirtual/ReplayProfile';
import { UBootShellProfile } from './SerialPortHalVirtual/UBootShellProfile';
import { SerialPortHalVirtual } from './SerialPortHalVirtual/SerialPortHalVirtual';

// 编译期 HAL 选择：测试构建改为 true，发布前必须复位为 false
//（scripts/verify-hal-selection.js 在 vscode:prepublish 中强制校验，未复位则拒绝打包）。
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
