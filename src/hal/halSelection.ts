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

export function createSerialPortHal(): SerialPortHal {
  if (USE_VIRTUAL_HAL) {
    return new SerialPortHalVirtual(
      [
        new EchoProfile(),
        new LinuxShellProfile(readInteractionDir()),
        new UBootShellProfile(readInteractionDir()),
        new ReplayProfile(readReplayFile(), readReplayRate(), readReplayLoop()),
      ],
      readResponseDelay()
    );
  }
  return new SerialPortHalImpl();
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
