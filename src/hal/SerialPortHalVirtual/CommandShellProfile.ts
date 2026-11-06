import * as fs from 'fs';
import * as path from 'path';
import { VirtualDeviceProfile, VirtualDeviceKind, VirtualEmit } from './VirtualDeviceProfile';

// 命令壳画像抽象基类（契约见 doc/Hal/SerialPortHalVirtual规划.md §4.2/§4.3/§4.5、§10.2）：
// 远端回显（CR/LF 统一以 CRLF 显示）、行缓冲（\r/\n 终止、跨 chunk 累积）、
// 应答管线（查表 → \r\n 行尾 → 提示符）、复合命令按 ';' 依次执行、应答目录文件覆盖。
// 纯逻辑 + Node 内建 fs（应答文件惰性读取），不 import vscode，可直接单测。
export abstract class CommandShellProfile extends VirtualDeviceProfile {
  abstract readonly kind: VirtualDeviceKind;
  private lineBuffer = '';
  private interactionDir: string | undefined;

  constructor(
    private readonly responseSubdir: string,
    interactionDir?: string
  ) {
    super();
    this.interactionDir = interactionDir;
  }

  // 控制台/配置变更：即时生效（下一命令起走新应答目录）。
  setInteractionDir(dir: string | undefined): void {
    this.interactionDir = dir && dir.trim() ? dir.trim() : undefined;
  }

  abstract readonly banner: string;
  abstract readonly prompt: string;

  onOpen(emit: VirtualEmit): void {
    this.emitText(this.normalizeDisplay(`${this.banner}\n${this.prompt}`), emit);
  }

  onInput(data: Buffer, emit: VirtualEmit): void {
    const text = data.toString('utf8');
    // 远端回显：键入字符原样可见（真实串口终端的回显来自设备端）。
    this.emitText(this.normalizeDisplay(text), emit);

    this.lineBuffer += text;
    const parts = this.lineBuffer.split(/\r\n|\r|\n/);
    this.lineBuffer = parts.pop() ?? '';
    for (const line of parts) {
      const command = line.trim();
      if (command === '') {
        this.emitText(this.normalizeDisplay(this.prompt), emit);
        continue;
      }
      this.emitText(this.normalizeDisplay(`${this.resolve(command)}\n${this.prompt}`), emit);
    }
  }

  onClose(): void {
    this.lineBuffer = '';
  }

  // 单条命令行 → 应答文本（不含行尾）。复合命令按 ';' 分隔依次执行，输出按序拼接。
  protected resolve(commandLine: string): string {
    return commandLine
      .split(';')
      .map(part => part.trim())
      .filter(part => part !== '')
      .map(part => this.resolveSingle(part))
      .join('\n');
  }

  private resolveSingle(command: string): string {
    // 优先级（规划 §4.5）：精确文件 > 精确内置 > 参数化内置 > 未知回退。
    const fromFile = this.readFileResponse(command);
    if (fromFile !== undefined) {
      return fromFile;
    }
    const exact = this.builtinExact(command);
    if (exact !== undefined) {
      return exact;
    }
    const parametric = this.builtinParametric(command);
    if (parametric !== undefined) {
      return parametric;
    }
    return this.formatUnknown(command);
  }

  // 应答目录覆盖：文件名 = 命令行 + '.txt'。目录/文件缺省回退内置；
  // 含 Windows 非法文件名字符或路径穿越片段的命令无法覆盖，保留内置表。
  private readFileResponse(command: string): string | undefined {
    if (!this.interactionDir) {
      return undefined;
    }
    if (/[\\/:*?"<>|]/.test(command) || command.includes('..')) {
      return undefined;
    }
    try {
      const file = path.join(this.interactionDir, this.responseSubdir, `${command}.txt`);
      return fs.readFileSync(file, 'utf8').replace(/[\r\n]+$/, '');
    } catch {
      return undefined;
    }
  }

  protected abstract builtinExact(command: string): string | undefined;
  protected abstract builtinParametric(command: string): string | undefined;
  protected abstract formatUnknown(command: string): string;

  // 显示归一：CR/LF/CRLF 一律以 CRLF 呈现（真实串口终端习惯）。
  private normalizeDisplay(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
  }

  private emitText(text: string, emit: VirtualEmit): void {
    if (text.length > 0) {
      emit(Buffer.from(text, 'utf8'));
    }
  }
}
