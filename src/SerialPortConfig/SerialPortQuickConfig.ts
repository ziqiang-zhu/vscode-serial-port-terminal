export interface SerialPortQuickConfig {
  readonly id: string;
  readonly name: string;
  readonly config: SerialConfig;
}

export interface SerialConfig {
  schemaVersion: number;
  baudRate: number;
  dataBits: number;
  parity: 'none' | 'even' | 'odd' | 'mark' | 'space';
  stopBits: number;
  flowControl: 'none' | 'rtscts';
}

const SCHEMA_VERSION = 1;
const parityMarks: Record<SerialConfig['parity'], string> = { none: 'N', even: 'E', odd: 'O', mark: 'M', space: 'S' };
const parityLabels: Record<SerialConfig['parity'], string> = { none: '无', even: '偶', odd: '奇', mark: 'Mark', space: 'Space' };
const flowControlLabels: Record<SerialConfig['flowControl'], string> = { none: '无', rtscts: 'RTS/CTS' };

function preset(
  label: string,
  baudRate: number,
  dataBits: number,
  parity: SerialConfig['parity'],
  stopBits: number,
  flowControl: SerialConfig['flowControl']
): { label: string; config: SerialConfig } {
  return { label, config: { schemaVersion: SCHEMA_VERSION, baudRate, dataBits, parity, stopBits, flowControl } };
}

export const serialPortPresets = [
  preset('115200 8-N-1', 115200, 8, 'none', 1, 'none'),
  preset('9600 8-N-1', 9600, 8, 'none', 1, 'none'),
  preset('19200 8-N-1', 19200, 8, 'none', 1, 'none'),
  preset('38400 8-N-1', 38400, 8, 'none', 1, 'none'),
  preset('57600 8-N-1', 57600, 8, 'none', 1, 'none'),
  preset('115200 7-E-1', 115200, 7, 'even', 1, 'none'),
  preset('9600 7-E-1', 9600, 7, 'even', 1, 'none'),
  preset('115200 8-N-1 RTS/CTS', 115200, 8, 'none', 1, 'rtscts')
];

export function formatSerialConfigSummary(config: SerialConfig): string {
  const flow = config.flowControl === 'none' ? '' : ` ${flowControlLabels[config.flowControl]}`;
  return `${config.baudRate} ${config.dataBits}-${parityMarks[config.parity]}-${config.stopBits}${flow}`;
}

export function formatSerialConfigDescription(config: SerialConfig): string {
  return `波特率 ${config.baudRate} · 数据位 ${config.dataBits} · ${parityLabels[config.parity]}校验 · 停止位 ${config.stopBits} · 流控 ${flowControlLabels[config.flowControl]}`;
}

export function formatSerialConfigDetails(config: SerialConfig): string {
  return [
    `波特率: ${config.baudRate}`,
    `数据位: ${config.dataBits}`,
    `校验: ${parityLabels[config.parity]}`,
    `停止位: ${config.stopBits}`,
    `流控: ${flowControlLabels[config.flowControl]}`
  ].join('\n');
}
