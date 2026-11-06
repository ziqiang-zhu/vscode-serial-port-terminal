import { SerialPortInfo } from '../SerialPortHal';
import { CommandShellProfile } from './CommandShellProfile';
import { VirtualDeviceKind } from './VirtualDeviceProfile';

const LINUX_BANNER = 'Welcome to Virtual Linux (busybox)';
const LINUX_PROMPT = 'root@localhost:~# ';
const CAT_CONTENT = 'virtual file content';

// 虚拟 Linux 终端画像（内置默认表见 doc/Hal/SerialPortHalVirtual规划.md §4.2）。
export class LinuxShellProfile extends CommandShellProfile {
  readonly info: SerialPortInfo = { path: 'VCOM-LINUX', manufacturer: 'Virtual' };
  readonly kind: VirtualDeviceKind = 'linux';

  get banner(): string {
    return LINUX_BANNER;
  }

  get prompt(): string {
    return LINUX_PROMPT;
  }

  constructor(interactionDir?: string) {
    super('linux', interactionDir);
  }

  protected builtinExact(command: string): string | undefined {
    switch (command) {
      case 'help':
        return 'Virtual Linux commands:\nhelp\nuname -a\nls\npwd\necho <text>\ncat <path>';
      case 'uname -a':
        return 'Linux virtual 5.15.0-virtual #1 SMP PREEMPT armv7l GNU/Linux';
      case 'ls':
        return 'bin  dev  etc  home  proc  root  sys  tmp  usr  var';
      case 'pwd':
        return '/root';
      default:
        return undefined;
    }
  }

  protected builtinParametric(command: string): string | undefined {
    if (command.startsWith('echo ')) {
      return command.slice('echo '.length).trim();
    }
    if (command.startsWith('cat ')) {
      return CAT_CONTENT;
    }
    return undefined;
  }

  protected formatUnknown(command: string): string {
    return `bash: ${command}: command not found`;
  }
}
