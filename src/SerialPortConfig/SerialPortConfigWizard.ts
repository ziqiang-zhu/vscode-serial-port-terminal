import * as vscode from 'vscode';
import { SerialConfig } from './SerialPortQuickConfig';

const FLOW_CONTROL_OPTIONS: { label: string; value: SerialConfig['flowControl'] }[] = [
  { label: vscode.l10n.t('None'), value: 'none' },
  { label: vscode.l10n.t('RTS/CTS'), value: 'rtscts' }
];

const DEFAULT_BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const DEFAULT_FRAME_FORMATS = ['8-N-1', '8-E-1', '8-O-1', '8-N-2', '8-E-2', '8-O-2', '7-N-1', '7-E-1', '7-O-1', '7-N-2'];

/**
 * 引导用户依次选择串口连接参数：波特率 → 帧格式 → 流控。
 * 波特率/帧格式取自已配置（settings），单值时跳过对应下拉直接选中。
 * @param current 现有/上次使用的配置，用于标注「当前」值。
 * @returns 完整参数；用户任一环节取消则返回 undefined。
 */
export async function pickSerialConfig(current?: SerialConfig): Promise<SerialConfig | undefined> {
  const baudRate = await pickBaudRate(current?.baudRate);
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

function readBaudRates(): number[] {
  const raw = vscode.workspace.getConfiguration('serialPortTerminal').get<unknown[]>('baudRates') ?? DEFAULT_BAUD_RATES;
  return raw.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0);
}

function readFrameFormats(): string[] {
  const raw = vscode.workspace.getConfiguration('serialPortTerminal').get<unknown[]>('frameFormats') ?? DEFAULT_FRAME_FORMATS;
  return raw.filter((v): v is string => typeof v === 'string' && /^\d+-[NEOMS]-[0-9.]+$/.test(v));
}

async function pickBaudRate(current?: number): Promise<number | undefined> {
  const baudRates = readBaudRates();
  if (baudRates.length === 0) {
    vscode.window.showErrorMessage(vscode.l10n.t('No baud rates configured'));
    return undefined;
  }
  if (baudRates.length === 1) {
    return baudRates[0];
  }
  const picked = await vscode.window.showQuickPick(
    baudRates.map(b => ({
      label: String(b),
      ...(b === current ? { description: vscode.l10n.t('Current') } : {})
    })),
    { placeHolder: vscode.l10n.t('Select the baud rate') }
  );
  if (!picked) {
    return undefined;
  }
  return Number(picked.label);
}

async function pickFrameFormat(current?: SerialConfig): Promise<{ dataBits: number; parity: SerialConfig['parity']; stopBits: number } | undefined> {
  const frameFormats = readFrameFormats();
  if (frameFormats.length === 0) {
    vscode.window.showErrorMessage(vscode.l10n.t('No frame formats configured'));
    return undefined;
  }
  if (frameFormats.length === 1) {
    return parseFrameFormat(frameFormats[0] as string);
  }
  const currentLabel = current ? frameLabel(current) : undefined;
  const frame = await vscode.window.showQuickPick(
    frameFormats.map(f => ({
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
