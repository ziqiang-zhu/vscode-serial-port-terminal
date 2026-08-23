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

const parityMarks: Record<SerialConfig['parity'], string> = { none: 'N', even: 'E', odd: 'O', mark: 'M', space: 'S' };
const parityLabels: Record<SerialConfig['parity'], string> = { none: '无', even: '偶', odd: '奇', mark: 'Mark', space: 'Space' };
const flowControlLabels: Record<SerialConfig['flowControl'], string> = { none: '无', rtscts: 'RTS/CTS' };

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
