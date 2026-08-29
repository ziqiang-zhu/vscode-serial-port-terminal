import * as vscode from 'vscode';

export interface SerialPortQuickConfig {
  readonly id: string;
  readonly name: string;
  readonly config: SerialConfig;
}

export interface SerialConfig {
  baudRate: number;
  dataBits: number;
  parity: 'none' | 'even' | 'odd' | 'mark' | 'space';
  stopBits: number;
  flowControl: 'none' | 'rtscts';
}

const parityMarks: Record<SerialConfig['parity'], string> = { none: 'N', even: 'E', odd: 'O', mark: 'M', space: 'S' };

function parityLabel(parity: SerialConfig['parity']): string {
  switch (parity) {
    case 'even':
      return vscode.l10n.t('Even');
    case 'odd':
      return vscode.l10n.t('Odd');
    case 'mark':
      return vscode.l10n.t('Mark');
    case 'space':
      return vscode.l10n.t('Space');
    default:
      return vscode.l10n.t('None');
  }
}

function flowControlLabel(flowControl: SerialConfig['flowControl']): string {
  return flowControl === 'rtscts' ? vscode.l10n.t('RTS/CTS') : vscode.l10n.t('None');
}

export function serialConfigEquals(a: SerialConfig, b: SerialConfig): boolean {
  return (
    a.baudRate === b.baudRate &&
    a.dataBits === b.dataBits &&
    a.parity === b.parity &&
    a.stopBits === b.stopBits &&
    a.flowControl === b.flowControl
  );
}

export function formatSerialConfigSummary(config: SerialConfig): string {
  const flow = config.flowControl === 'rtscts' ? ' RTS/CTS' : '';
  return `${config.baudRate} ${config.dataBits}-${parityMarks[config.parity]}-${config.stopBits}${flow}`;
}

export function formatSerialConfigDescription(config: SerialConfig): string {
  return vscode.l10n.t(
    'Baud {0} · Data {1} · Parity {2} · Stop {3} · Flow {4}',
    config.baudRate,
    config.dataBits,
    parityLabel(config.parity),
    config.stopBits,
    flowControlLabel(config.flowControl)
  );
}

export function formatSerialConfigDetails(config: SerialConfig): string {
  return [
    vscode.l10n.t('Baud rate: {0}', config.baudRate),
    vscode.l10n.t('Data bits: {0}', config.dataBits),
    vscode.l10n.t('Parity: {0}', parityLabel(config.parity)),
    vscode.l10n.t('Stop bits: {0}', config.stopBits),
    vscode.l10n.t('Flow control: {0}', flowControlLabel(config.flowControl))
  ].join('\n');
}
