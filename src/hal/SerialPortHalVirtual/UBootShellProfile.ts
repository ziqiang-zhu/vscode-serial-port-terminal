import { SerialPortInfo } from '../SerialPortHal';
import { CommandShellProfile } from './CommandShellProfile';
import { LinuxShellProfile } from './LinuxShellProfile';
import { VirtualDeviceKind, VirtualEmit } from './VirtualDeviceProfile';

const UBOOT_BANNER = 'U-Boot 2023.10-virtual (Nov 05 2026 - 00:00:00 +0800)';
const UBOOT_PROMPT = '=> ';
const UBOOT_BOOTDELAY = 2; // 对应 printenv 的 bootdelay=2
const UBOOT_COUNTDOWN_TICK = 1000;
const UBOOT_ENV = [
  'arch=arm',
  'board=virtual',
  'baudrate=115200',
  'bootargs=console=ttyS0,115200 root=/dev/mmcblk0p2',
  'bootcmd=run distro_bootcmd',
  'bootdelay=2',
  'serial#=VIRTUAL0000',
].join('\n');
const KERNEL_BOOT_LOG = [
  'Starting kernel ...',
  '',
  '[    0.000000] Booting Linux on physical CPU 0x0',
  '[    0.000000] Linux version 6.1.0-virtual (gcc 12.2.0)',
  '[    1.000000] Freeing unused kernel image memory: 1024K',
].join('\n');

// 虚拟 U-Boot 终端画像（内置默认表见 doc/Hal/SerialPortHalVirtual规划.md §4.3）。
// 开机链路（P4）：打开输出横幅 + 自动开机倒计时（按秒退格更新，不先显示提示符）；
// 窗口内首个输入块中断倒计时（整块被消费：不回显、不进入行缓冲），停留 U-Boot 会话；
// 倒计时自然到期或 U-Boot 会话中执行 `boot` 切换 Linux 会话——命令表整体委托内嵌
// LinuxShellProfile（避免命令表双份维护），U-Boot 专属命令按 Linux 未知格式回退；
// close 复位状态机，重开端口重新走开机链路。倒计时为设备侧自主输出（画像自带
// 定时器，同 Replay 约定，onClose 清理），不经 responseDelay 延迟管线。
export class UBootShellProfile extends CommandShellProfile {
  readonly info: SerialPortInfo = { path: 'VCOM-UBOOT', manufacturer: 'Virtual' };
  readonly kind: VirtualDeviceKind = 'uboot';
  private session: 'uboot' | 'linux' = 'uboot';
  private countdownTimer: ReturnType<typeof setInterval> | undefined;
  private countdownRemaining = 0;
  private countdownEmit: VirtualEmit | undefined;
  private readonly linux: LinuxShellProfile;

  constructor(interactionDir?: string) {
    super('uboot', interactionDir);
    this.linux = new LinuxShellProfile(interactionDir);
  }

  get banner(): string {
    return UBOOT_BANNER;
  }

  // 会话感知提示符：`boot` 应答管线的尾部提示符随会话切换取 Linux 提示符。
  get prompt(): string {
    return this.session === 'linux' ? this.linux.prompt : UBOOT_PROMPT;
  }

  setInteractionDir(dir: string | undefined): void {
    super.setInteractionDir(dir);
    this.linux.setInteractionDir(dir);
  }

  onOpen(emit: VirtualEmit): void {
    this.session = 'uboot';
    this.countdownRemaining = UBOOT_BOOTDELAY;
    this.countdownEmit = emit;
    this.emitText(this.normalizeDisplay(`${this.banner}\nHit any key to stop autoboot: ${UBOOT_BOOTDELAY}`), emit);
    this.countdownTimer = setInterval(() => this.tickCountdown(), UBOOT_COUNTDOWN_TICK);
  }

  onInput(data: Buffer, emit: VirtualEmit): void {
    if (this.countdownTimer !== undefined) {
      // 倒计时窗口内首个输入块中断开机：整块被消费，倒计时行收束后显示 U-Boot 提示符。
      this.stopCountdown();
      this.emitText(`\r\n${UBOOT_PROMPT}`, emit);
      return;
    }
    if (this.session === 'linux') {
      this.linux.onInput(data, emit);
      return;
    }
    super.onInput(data, emit);
  }

  onClose(): void {
    this.stopCountdown();
    this.session = 'uboot';
    this.linux.onClose();
    super.onClose();
  }

  protected builtinExact(command: string): string | undefined {
    switch (command) {
      case 'boot':
        // 切换 Linux 会话：应答 = 内核启动信息 + Linux 横幅（尾部提示符经 prompt getter 取 Linux 提示符）。
        this.session = 'linux';
        return `${KERNEL_BOOT_LOG}\n${this.linux.banner}`;
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

  // 倒计时按秒退格更新（2 → \b1 → \b0）；归零输出开机链并切换 Linux 会话。
  private tickCountdown(): void {
    const emit = this.countdownEmit;
    this.countdownRemaining -= 1;
    if (this.countdownRemaining > 0) {
      if (emit) {
        this.emitText(`\b${this.countdownRemaining}`, emit);
      }
      return;
    }
    this.stopCountdown();
    if (emit) {
      // 开机链行尾归一为 CRLF（KERNEL_BOOT_LOG 内部为 \n，同应答管线约定）。
      this.emitText(this.normalizeDisplay(`\b0\r\n${KERNEL_BOOT_LOG}\r\n${this.linux.banner}\r\n${this.linux.prompt}`), emit);
    }
    this.session = 'linux';
  }

  private stopCountdown(): void {
    if (this.countdownTimer !== undefined) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = undefined;
    }
    this.countdownEmit = undefined;
  }
}
