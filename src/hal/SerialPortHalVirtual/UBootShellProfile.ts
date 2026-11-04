import { SerialPortInfo } from '../SerialPortHal';
import { CommandShellProfile } from './CommandShellProfile';

const UBOOT_BANNER = 'U-Boot 2023.10-virtual (Nov 05 2026 - 00:00:00 +0800)';
const UBOOT_PROMPT = '=> ';
const UBOOT_ENV = [
  'arch=arm',
  'board=virtual',
  'baudrate=115200',
  'bootargs=console=ttyS0,115200 root=/dev/mmcblk0p2',
  'bootcmd=run distro_bootcmd',
  'bootdelay=2',
  'serial#=VIRTUAL0000',
].join('\n');

// 虚拟 U-Boot 终端画像（内置默认表见 doc/Hal/SerialPortHalVirtual规划.md §4.3）。
// 开机倒计时与 boot 切换 Linux 会话的状态机链路列入 P4，首版独立。
export class UBootShellProfile extends CommandShellProfile {
  readonly info: SerialPortInfo = { path: 'VCOM-UBOOT', manufacturer: 'Virtual' };
  readonly banner = UBOOT_BANNER;
  readonly prompt = UBOOT_PROMPT;

  constructor(interactionDir?: string) {
    super('uboot', interactionDir);
  }

  protected builtinExact(command: string): string | undefined {
    switch (command) {
      case 'help':
        return 'Virtual U-Boot commands:\nhelp\nversion\nprintenv';
      case 'version':
        return `${UBOOT_BANNER}\narmv7l, board: virtual`;
      case 'printenv':
        return UBOOT_ENV;
      default:
        return undefined;
    }
  }

  protected builtinParametric(_command: string): string | undefined {
    return undefined;
  }

  protected formatUnknown(command: string): string {
    return `Unknown command '${command}' - try 'help'`;
  }
}
