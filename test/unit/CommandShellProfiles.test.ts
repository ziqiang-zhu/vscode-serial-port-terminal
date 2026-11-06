import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LinuxShellProfile } from '../../src/hal/SerialPortHalVirtual/LinuxShellProfile';
import { UBootShellProfile } from '../../src/hal/SerialPortHalVirtual/UBootShellProfile';
import { VirtualPortHandle } from '../../src/hal/SerialPortHalVirtual/VirtualPortHandle';
import { SerialPortHalVirtual } from '../../src/hal/SerialPortHalVirtual/SerialPortHalVirtual';

// 命令壳画像契约（doc/Test/开发测试体系规划.md §6.6 / doc/Hal/SerialPortHalVirtual规划.md
// §4.2/§4.3/§4.5、§10.2）：远端回显（\r 回显 \r\n）、按 \r/\n 行缓冲、内置表 +
// 应答目录覆盖（精确文件 > 精确内置 > 参数化内置 > 未知回退）、复合命令按 ';' 依次执行；
// 应答与提示符行尾 \r\n；interactionDir 经构造注入（临时目录 + fs 验证覆盖逻辑）。
const LINUX_PROMPT = 'root@localhost:~# ';
const UBOOT_PROMPT = '=> ';

const makeLinux = (dir?: string): VirtualPortHandle => new VirtualPortHandle(new LinuxShellProfile(dir), { online: true, delayMs: 0, backpressure: false });
const makeUboot = (dir?: string): VirtualPortHandle => new VirtualPortHandle(new UBootShellProfile(dir), { online: true, delayMs: 0, backpressure: false });
const collect = (handle: VirtualPortHandle): string[] => {
  const received: string[] = [];
  handle.onData(data => received.push(data.toString('utf8')));
  return received;
};

// noUncheckedIndexedAccess 下取第 i 次输出（附带存在性断言）。
const at = (received: string[], index: number): string => {
  const value = received[index];
  assert.ok(value !== undefined, `missing emission at index ${index}`);
  return value;
};

// P4 起打开即开机倒计时：任意键入中断（整块消费），received = [横幅+倒计时, '\r\n=> ']。
const stopAutoboot = (handle: VirtualPortHandle): void => {
  handle.write(Buffer.from('\r'));
};

// 应答目录覆盖用例的临时根目录（用后清理）。
const withTempDir = (run: (dir: string) => void): void => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'halvirtual-p1-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('命令壳注册（P1）', () => {
  it('#1 registers three shell devices alongside Echo and Replay (all Virtual)', async () => {
    const hal = new SerialPortHalVirtual();
    const devices = await hal.listDevices();
    assert.deepEqual(devices.map(d => d.path), [
      'VCOM-ECHO',
      'VCOM-LINUX',
      'VCOM-UBOOT',
      'VCOM-REPLAY',
    ]);
    assert.ok(devices.every(d => d.manufacturer === 'Virtual'));
  });
});

describe('LinuxShell 画像', () => {
  it('#2 emits banner and prompt on first subscription', () => {
    const handle = makeLinux();
    const received = collect(handle);
    assert.equal(received[0], `Welcome to Virtual Linux (busybox)\r\n${LINUX_PROMPT}`);
  });

  it('#3 echoes typed characters verbatim and CR as CRLF', () => {
    const handle = makeLinux();
    const received = collect(handle);
    handle.write(Buffer.from('abc'));
    assert.equal(received[1], 'abc'); // 无终止符：仅回显，无应答
    handle.write(Buffer.from('\r'));
    assert.equal(received[2], '\r\n');
  });

  it('#4 answers pwd with the working directory and a fresh prompt', () => {
    const handle = makeLinux();
    const received = collect(handle);
    handle.write(Buffer.from('pwd\r'));
    assert.equal(at(received, 2), `/root\r\n${LINUX_PROMPT}`);
  });

  it('#5 answers uname -a with the canned kernel line', () => {
    const handle = makeLinux();
    const received = collect(handle);
    handle.write(Buffer.from('uname -a\r'));
    assert.match(at(received, 2), /Linux virtual 5\.15\.0-virtual/);
  });

  it('#6 answers ls with the canned listing', () => {
    const handle = makeLinux();
    const received = collect(handle);
    handle.write(Buffer.from('ls\r'));
    assert.match(at(received, 2), /bin\s+dev\s+etc/);
  });

  it('#7 answers help with the command list', () => {
    const handle = makeLinux();
    const received = collect(handle);
    handle.write(Buffer.from('help\r'));
    assert.match(at(received, 2), /uname -a/);
  });

  it('#8 answers echo with its argument only', () => {
    const handle = makeLinux();
    const received = collect(handle);
    handle.write(Buffer.from('echo hello world\r'));
    assert.ok(at(received, 2).startsWith(`hello world\r\n${LINUX_PROMPT}`));
  });

  it('#9 answers cat with the canned file content', () => {
    const handle = makeLinux();
    const received = collect(handle);
    handle.write(Buffer.from('cat /etc/os-release\r'));
    assert.ok(at(received, 2).startsWith(`virtual file content\r\n${LINUX_PROMPT}`));
  });

  it('#10 reports unknown commands bash-style', () => {
    const handle = makeLinux();
    const received = collect(handle);
    handle.write(Buffer.from('foo\r'));
    assert.equal(at(received, 2), `bash: foo: command not found\r\n${LINUX_PROMPT}`);
  });

  it('#11 executes compound commands in order so markers land on their own lines', () => {
    const handle = makeLinux();
    const received = collect(handle);
    handle.write(Buffer.from('echo __MARK_BEGIN__; uname -a; echo __MARK_END__\r'));
    const stream = received.join('');
    assert.match(stream, /__MARK_BEGIN__\r\nLinux virtual/);
    assert.match(stream, /GNU\/Linux\r\n__MARK_END__\r\n/);
  });

  it('#12 answers an empty enter with a bare prompt', () => {
    const handle = makeLinux();
    const received = collect(handle); // received[0] 为横幅
    handle.write(Buffer.from('\r'));
    assert.deepEqual(received.slice(1), ['\r\n', LINUX_PROMPT]);
  });

  it('#13 accumulates a command across chunks and runs it on CR', () => {
    const handle = makeLinux();
    const received = collect(handle); // received[0] 为横幅
    handle.write(Buffer.from('pw'));
    handle.write(Buffer.from('d\r'));
    assert.deepEqual(received.slice(1), ['pw', 'd\r\n', `/root\r\n${LINUX_PROMPT}`]);
  });
});

describe('UBootShell 画像', () => {
  it('#14 emits banner and autoboot countdown on open (no prompt before interrupt)', t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const handle = makeUboot();
    const received = collect(handle);
    assert.match(at(received, 0), /^U-Boot 2023\.10-virtual .*\r\nHit any key to stop autoboot: 2$/);
  });

  it('#15 answers version with the canned banner and board info', () => {
    const handle = makeUboot();
    const received = collect(handle);
    stopAutoboot(handle);
    handle.write(Buffer.from('version\r'));
    assert.match(at(received, 3), /U-Boot 2023\.10-virtual/);
    assert.match(at(received, 3), /armv7l, board: virtual/);
  });

  it('#16 answers printenv with the canned environment block', () => {
    const handle = makeUboot();
    const received = collect(handle);
    stopAutoboot(handle);
    handle.write(Buffer.from('printenv\r'));
    assert.match(at(received, 3), /bootargs=console=ttyS0,115200/);
    assert.match(at(received, 3), /serial#=VIRTUAL0000/);
  });

  it('#17 reports unknown commands U-Boot style', () => {
    const handle = makeUboot();
    const received = collect(handle);
    stopAutoboot(handle);
    handle.write(Buffer.from('foo\r'));
    assert.equal(at(received, 3), `Unknown command 'foo' - try 'help'\r\n${UBOOT_PROMPT}`);
  });
});

describe('应答目录覆盖（interactionDir）', () => {
  it('#18 lets linux/pwd.txt override the builtin pwd answer', () => {
    withTempDir(dir => {
      fs.mkdirSync(path.join(dir, 'linux'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'linux', 'pwd.txt'), 'CUSTOM_ROOT\n');
      const handle = makeLinux(dir);
      const received = collect(handle);
      handle.write(Buffer.from('pwd\r'));
      assert.equal(at(received, 2), `CUSTOM_ROOT\r\n${LINUX_PROMPT}`);
    });
  });

  it('#19 keeps linux/ and uboot/ overrides independent for the same command', () => {
    withTempDir(dir => {
      fs.mkdirSync(path.join(dir, 'linux'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'uboot'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'linux', 'help.txt'), 'LINUX_HELP_OVERRIDE');
      fs.writeFileSync(path.join(dir, 'uboot', 'help.txt'), 'UBOOT_HELP_OVERRIDE');
      const linuxHandle = makeLinux(dir);
      const linuxReceived = collect(linuxHandle);
      linuxHandle.write(Buffer.from('help\r'));
      assert.match(at(linuxReceived, 2), /LINUX_HELP_OVERRIDE/);
      const ubootHandle = makeUboot(dir);
      const ubootReceived = collect(ubootHandle);
      stopAutoboot(ubootHandle);
      ubootHandle.write(Buffer.from('help\r'));
      assert.match(at(ubootReceived, 3), /UBOOT_HELP_OVERRIDE/);
    });
  });

  it('#20 falls back to builtins without the dir and for unnameable commands', () => {
    const plain = makeLinux();
    const plainReceived = collect(plain);
    plain.write(Buffer.from('pwd\r'));
    assert.equal(at(plainReceived, 2), `/root\r\n${LINUX_PROMPT}`);

    withTempDir(dir => {
      fs.mkdirSync(path.join(dir, 'linux'), { recursive: true });
      const handle = makeLinux(dir);
      const received = collect(handle);
      handle.write(Buffer.from('foo?bar\r')); // '?' 无法成为文件名：保留内置表
      assert.equal(at(received, 2), `bash: foo?bar: command not found\r\n${LINUX_PROMPT}`);
    });
  });
});

// U-Boot → Linux 开机链路契约（doc/Test/开发测试体系规划.md §6.9 /
// doc/Hal/SerialPortHalVirtual规划.md §4.3 开机链路）：打开输出横幅 + 倒计时（无提示符）；
// 倒计时按秒退格更新（2 → \b1 → \b0）；窗口内首个输入块中断（整块消费）；到期或
// `boot` 切换 Linux 会话（命令表整体切换）；close 复位；VCOM-LINUX 独立不受影响。
// mock.timers 控时（倒计时定时器归画像自带）。
describe('U-Boot 开机链路（P4）', () => {
  it('P4#1 emits banner and countdown without the prompt on open', t => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const handle = makeUboot();
    const received = collect(handle);
    assert.equal(received.length, 1);
    assert.match(at(received, 0), /^U-Boot 2023\.10-virtual .*\r\nHit any key to stop autoboot: 2$/);
    assert.ok(!at(received, 0).includes('=> ')); // 倒计时中断前不显示提示符
  });

  it('P4#2 updates the countdown digit per second via backspace (mock timers)', t => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const handle = makeUboot();
    const received = collect(handle);
    t.mock.timers.tick(1000);
    assert.equal(at(received, 1), '\b1');
    t.mock.timers.tick(1000);
    assert.ok(at(received, 2).startsWith('\b0')); // 归零后开机链随后输出
  });

  it('P4#3 the first input chunk interrupts the countdown and is consumed whole', t => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const handle = makeUboot();
    const received = collect(handle);
    handle.write(Buffer.from('x')); // 任意键：不回显、不进入行缓冲
    assert.deepEqual(received.slice(1), ['\r\n=> ']); // 收束倒计时行 + U-Boot 提示符
    t.mock.timers.tick(5000);
    assert.equal(received.length, 2); // 中断后再无倒计时/开机输出
  });

  it('P4#4 U-Boot session answers with the U-Boot table after interrupt', () => {
    const handle = makeUboot();
    const received = collect(handle);
    stopAutoboot(handle);
    handle.write(Buffer.from('version\r'));
    assert.match(at(received, 3), /armv7l, board: virtual/);
  });

  it('P4#5 the boot command switches to the Linux session', () => {
    const handle = makeUboot();
    const received = collect(handle);
    stopAutoboot(handle);
    handle.write(Buffer.from('boot\r'));
    assert.match(at(received, 3), /Starting kernel/);
    assert.match(at(received, 3), /Welcome to Virtual Linux \(busybox\)/);
    assert.match(at(received, 3), /root@localhost:~# $/);
  });

  it('P4#6 expiry without input auto-boots into the Linux session (mock timers)', t => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const handle = makeUboot();
    const received = collect(handle);
    t.mock.timers.tick(2000);
    assert.equal(at(received, 1), '\b1');
    assert.match(at(received, 2), /^\x080\r\nStarting kernel/); // \x08 = 退格字符（正则 \b 是词边界元字符）
    assert.match(at(received, 2), /Welcome to Virtual Linux \(busybox\)\r\nroot@localhost:~# $/);
  });

  it('P4#7 the Linux table serves commands after the switch (mock timers)', t => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const handle = makeUboot();
    const received = collect(handle);
    t.mock.timers.tick(2000); // 到期自动开机
    handle.write(Buffer.from('uname -a\r'));
    assert.match(at(received, 4), /Linux virtual 5\.15\.0-virtual/);
    assert.match(at(received, 4), /root@localhost:~# $/);
  });

  it('P4#8 U-Boot-specific commands fall back to the Linux unknown format after the switch', t => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const handle = makeUboot();
    const received = collect(handle);
    t.mock.timers.tick(2000);
    handle.write(Buffer.from('printenv\r'));
    assert.equal(at(received, 4), `bash: printenv: command not found\r\n${LINUX_PROMPT}`);
  });

  it('P4#9 unknown commands use the Linux format after the switch (mock timers)', t => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const handle = makeUboot();
    const received = collect(handle);
    t.mock.timers.tick(2000);
    handle.write(Buffer.from('foo\r'));
    assert.equal(at(received, 4), `bash: foo: command not found\r\n${LINUX_PROMPT}`);
  });

  it('P4#10 close resets the state machine: reopen restarts the boot chain', async t => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const profile = new UBootShellProfile();
    const first = new VirtualPortHandle(profile, { online: true, delayMs: 0, backpressure: false });
    const firstReceived = collect(first);
    t.mock.timers.tick(2000); // 开机进入 Linux 会话
    assert.match(at(firstReceived, 2), /root@localhost:~# $/);
    await first.close();
    const second = new VirtualPortHandle(profile, { online: true, delayMs: 0, backpressure: false });
    const secondReceived = collect(second);
    assert.match(at(secondReceived, 0), /Hit any key to stop autoboot: 2/); // 重新走开机链
    stopAutoboot(second);
    second.write(Buffer.from('printenv\r'));
    assert.match(at(secondReceived, 3), /serial#=VIRTUAL0000/); // 会话已复位为 U-Boot
  });

  it('P4#11 the countdown timer is cleared after interrupt (mock timers)', t => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    const handle = makeUboot();
    const received = collect(handle);
    handle.write(Buffer.from('\r'));
    t.mock.timers.tick(5000);
    assert.equal(received.length, 2); // 无开机输出
  });

  it('P4#12 VCOM-LINUX stays an independent resident Linux device', async () => {
    const hal = new SerialPortHalVirtual();
    const devices = await hal.listDevices();
    assert.deepEqual(devices.map(d => d.path), ['VCOM-ECHO', 'VCOM-LINUX', 'VCOM-UBOOT', 'VCOM-REPLAY']);
    const handle = (await hal.openPort({ path: 'VCOM-LINUX', baudRate: 115200 })) as VirtualPortHandle;
    const received = collect(handle);
    assert.match(at(received, 0), /Welcome to Virtual Linux \(busybox\)\r\nroot@localhost:~# $/);
    assert.ok(!at(received, 0).includes('autoboot')); // 无开机链路
  });
});
