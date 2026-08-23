import * as vscode from 'vscode';
import { SerialConfig } from './SerialPortQuickConfig';

export interface SerialPortPreset {
  label: string;
  config: SerialConfig;
}

export interface SerialPortPresetEntry {
  label: string;
  baudRate: number;
  dataBits: number;
  parity: SerialConfig['parity'];
  stopBits: number;
  flowControl: SerialConfig['flowControl'];
}

const VALID_DATA_BITS = [5, 6, 7, 8];
const VALID_STOP_BITS = [1, 1.5, 2];
const VALID_PARITIES = ['none', 'even', 'odd', 'mark', 'space'];
const VALID_FLOW_CONTROLS = ['none', 'rtscts'];

export function readSerialPortPresets(): SerialPortPreset[] {
  const entries = vscode.workspace.getConfiguration('serialPortTerminal').get<unknown[]>('serialConfigPresets') ?? [];
  const presets: SerialPortPreset[] = [];
  for (const entry of entries) {
    const preset = parsePreset(entry);
    if (preset) {
      presets.push(preset);
    } else {
      console.warn('serial-port-terminal: 跳过无效的预设配置项', entry);
    }
  }
  return presets;
}

export function toPresetEntry(preset: SerialPortPreset): SerialPortPresetEntry {
  const { config } = preset;
  return {
    label: preset.label,
    baudRate: config.baudRate,
    dataBits: config.dataBits,
    parity: config.parity,
    stopBits: config.stopBits,
    flowControl: config.flowControl
  };
}

export async function saveSerialPortPresets(entries: SerialPortPresetEntry[]): Promise<void> {
  await vscode.workspace
    .getConfiguration('serialPortTerminal')
    .update('serialConfigPresets', entries, vscode.ConfigurationTarget.Global);
}

function parsePreset(entry: unknown): SerialPortPreset | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }
  const { label, baudRate, dataBits, parity, stopBits, flowControl } = entry as Record<string, unknown>;
  if (typeof label !== 'string' || !label.trim()) {
    return undefined;
  }
  if (typeof baudRate !== 'number' || !Number.isInteger(baudRate) || baudRate <= 0) {
    return undefined;
  }
  if (typeof dataBits !== 'number' || !VALID_DATA_BITS.includes(dataBits)) {
    return undefined;
  }
  if (typeof parity !== 'string' || !VALID_PARITIES.includes(parity)) {
    return undefined;
  }
  if (typeof stopBits !== 'number' || !VALID_STOP_BITS.includes(stopBits)) {
    return undefined;
  }
  if (typeof flowControl !== 'string' || !VALID_FLOW_CONTROLS.includes(flowControl)) {
    return undefined;
  }
  return {
    label: label.trim(),
    config: {
      schemaVersion: 1,
      baudRate,
      dataBits,
      parity: parity as SerialConfig['parity'],
      stopBits,
      flowControl: flowControl as SerialConfig['flowControl']
    }
  };
}
