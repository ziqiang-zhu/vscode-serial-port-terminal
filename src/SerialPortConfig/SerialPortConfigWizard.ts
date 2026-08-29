import * as vscode from 'vscode';
import { SerialConfig } from './SerialPortQuickConfig';

const FLOW_CONTROL_OPTIONS: { label: string; value: SerialConfig['flowControl'] }[] = [
  { label: vscode.l10n.t('None'), value: 'none' },
  { label: vscode.l10n.t('RTS/CTS'), value: 'rtscts' }
];

// 由合法取值组合生成：数据位 5/6/7/8 × 校验 N/E/O/M/S × 停止位 1/1.5/2。
const FRAME_FORMATS = buildFrameFormats();

/**
 * 引导用户依次选择串口连接参数：波特率 → 帧格式 → 流控。
 * @param current 现有/上次使用的配置，用于预填波特率；未传默认 115200。
 * @returns 完整参数；用户任一环节取消则返回 undefined。
 */
export async function pickSerialConfig(current?: SerialConfig): Promise<SerialConfig | undefined> {
  const baudRate = await pickBaudRate(current?.baudRate ?? 115200);
  if (baudRate === undefined) {
    return undefined;
  }
  const frame = await pickFrameFormat(current);
  if (!frame) {
    return undefined;
  }
  const flowControl = await pickFlowControl(current?.flowControl);
  if (!flowControl) {
    return undefined;
  }
  return {
    baudRate,
    dataBits: frame.dataBits,
    parity: frame.parity,
    stopBits: frame.stopBits,
    flowControl: flowControl.value
  };
}

async function pickBaudRate(current: number): Promise<number | undefined> {
  const text = await vscode.window.showInputBox({
    prompt: vscode.l10n.t('Enter the baud rate (e.g. 115200, 9600)'),
    value: String(current),
    validateInput: validateBaudRate
  });
  if (!text) {
    return undefined;
  }
  return Number(text.trim());
}

function validateBaudRate(value: string): string | undefined {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) {
    return vscode.l10n.t('Enter a positive integer baud rate (e.g. 115200)');
  }
  return undefined;
}

async function pickFrameFormat(current?: SerialConfig): Promise<{ dataBits: number; parity: SerialConfig['parity']; stopBits: number } | undefined> {
  const currentLabel = current ? frameLabel(current) : undefined;
  const frame = await vscode.window.showQuickPick(
    FRAME_FORMATS.map(f => ({
      label: f,
      ...(f === currentLabel ? { description: vscode.l10n.t('Current') } : {})
    })),
    { placeHolder: vscode.l10n.t('Select the frame format (data bits-parity-stop bits)') }
  );
  if (!frame) {
    return undefined;
  }
  return parseFrameFormat(frame.label);
}

async function pickFlowControl(current?: SerialConfig['flowControl']): Promise<{ label: string; value: SerialConfig['flowControl'] } | undefined> {
  return vscode.window.showQuickPick(
    FLOW_CONTROL_OPTIONS.map(option => ({
      label: option.label,
      value: option.value,
      ...(option.value === current ? { description: vscode.l10n.t('Current') } : {})
    })),
    { placeHolder: vscode.l10n.t('Select flow control') }
  );
}

function buildFrameFormats(): string[] {
  const dataBits = [5, 6, 7, 8];
  const parityLetters = ['N', 'E', 'O', 'M', 'S'];
  const stopBits = [1, 1.5, 2];
  const formats: string[] = [];
  for (const data of dataBits) {
    for (const letter of parityLetters) {
      for (const stop of stopBits) {
        formats.push(`${data}-${letter}-${stop}`);
      }
    }
  }
  return formats;
}

function parseFrameFormat(frame: string): { dataBits: number; parity: SerialConfig['parity']; stopBits: number } {
  const parts = frame.split('-');
  const letter = parts[1];
  const parity: SerialConfig['parity'] =
    letter === 'E' ? 'even' :
    letter === 'O' ? 'odd' :
    letter === 'M' ? 'mark' :
    letter === 'S' ? 'space' :
    'none';
  return { dataBits: Number(parts[0]), parity, stopBits: Number(parts[2]) };
}

function frameLabel(config: SerialConfig): string {
  const parityLetters: Record<SerialConfig['parity'], string> = { none: 'N', even: 'E', odd: 'O', mark: 'M', space: 'S' };
  return `${config.dataBits}-${parityLetters[config.parity]}-${config.stopBits}`;
}
