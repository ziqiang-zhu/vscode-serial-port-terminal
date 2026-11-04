import * as vscode from 'vscode';
import { SerialPortHal } from './SerialPortHal';
import { SerialPortHalImpl } from './SerialPortHalImpl';
import { EchoProfile } from './SerialPortHalVirtual/EchoProfile';
import { SerialPortHalVirtual } from './SerialPortHalVirtual/SerialPortHalVirtual';

// 编译期 HAL 选择：测试构建改为 true，发布前必须复位为 false
//（scripts/verify-hal-selection.js 在 vscode:prepublish 中强制校验，未复位则拒绝打包）。
export const USE_VIRTUAL_HAL = false;

export function createSerialPortHal(): SerialPortHal {
  if (USE_VIRTUAL_HAL) {
    return new SerialPortHalVirtual([new EchoProfile()], readResponseDelay());
  }
  return new SerialPortHalImpl();
}

function readResponseDelay(): number {
  const raw = vscode.workspace
    .getConfiguration('serialPortTerminal.testMode')
    .get<number>('responseDelay', 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}
