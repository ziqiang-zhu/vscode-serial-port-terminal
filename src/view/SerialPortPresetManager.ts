import * as vscode from 'vscode';
import { SerialConfig, formatSerialConfigDescription, formatSerialConfigSummary } from '../SerialPortConfig/SerialPortQuickConfig';
import { SerialPortPreset, SerialPortPresetEntry, readSerialPortPresets, saveSerialPortPresets, toPresetEntry } from '../SerialPortConfig/SerialPortPresets';

// 由合法取值组合生成：数据位 5/6/7/8 × 校验 N/E/O/M/S × 停止位 1/1.5/2。
const FRAME_FORMATS = buildFrameFormats();

const FLOW_CONTROL_OPTIONS: { label: string; value: SerialConfig['flowControl'] }[] = [
  { label: vscode.l10n.t('None'), value: 'none' },
  { label: vscode.l10n.t('RTS/CTS'), value: 'rtscts' }
];

const MOVE_UP_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: vscode.l10n.t('Move up') };
const MOVE_DOWN_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: vscode.l10n.t('Move down') };

type PresetPickItem = vscode.QuickPickItem & { action?: 'add'; index?: number };

export class SerialPortPresetManager {
  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.commands.registerCommand('serialPortPreset.manage', () => {
        void this.manage();
      })
    );
  }

  private moveInProgress = false;

  private async manage(): Promise<void> {
    while (true) {
      const picked = await this.pickPreset();
      if (!picked) {
        return;
      }
      if (picked.action === 'add') {
        await this.wizardPreset();
        continue;
      }
      const index = picked.index;
      if (index === undefined) {
        continue;
      }
      const target = readSerialPortPresets()[index];
      if (!target) {
        continue;
      }
      const action = await vscode.window.showQuickPick(
        [
          { label: vscode.l10n.t('$(edit) Edit'), value: 'edit' },
          { label: vscode.l10n.t('$(trash) Delete'), value: 'remove' }
        ],
        { placeHolder: vscode.l10n.t('Preset "{0}"', target.label) }
      );
      if (!action) {
        continue;
      }
      if (action.value === 'edit') {
        await this.wizardPreset({ index, preset: target });
      } else {
        await this.removePreset(index, target.label);
      }
    }
  }

  private pickPreset(): Promise<PresetPickItem | undefined> {
    return new Promise(resolve => {
      const picker = vscode.window.createQuickPick<PresetPickItem>();
      picker.items = this.buildPresetItems();
      picker.placeholder = vscode.l10n.t('Manage presets (hover ↑/↓ to reorder, Enter to edit/delete)');
      picker.matchOnDescription = true;
      let settled = false;
      const settle = (item: PresetPickItem | undefined): void => {
        if (settled) {
          return;
        }
        settled = true;
        picker.dispose();
        resolve(item);
      };
      picker.onDidAccept(() => {
        settle(picker.selectedItems[0]);
      });
      picker.onDidTriggerItemButton(async event => {
        const index = event.item.index;
        if (index === undefined || this.moveInProgress) {
          return;
        }
        this.moveInProgress = true;
        try {
          if (event.button === MOVE_UP_BUTTON) {
            await this.movePreset(index, -1);
          } else if (event.button === MOVE_DOWN_BUTTON) {
            await this.movePreset(index, 1);
          }
          picker.items = this.buildPresetItems();
        } finally {
          this.moveInProgress = false;
        }
      });
      picker.onDidHide(() => {
        settle(undefined);
      });
      picker.show();
    });
  }

  private buildPresetItems(): PresetPickItem[] {
    const presets = readSerialPortPresets();
    const items: PresetPickItem[] = [
      { label: vscode.l10n.t('$(add) Add Preset'), action: 'add' },
      { label: vscode.l10n.t('Preset List'), kind: vscode.QuickPickItemKind.Separator }
    ];
    for (let index = 0; index < presets.length; index++) {
      const preset = presets[index];
      if (!preset) {
        continue;
      }
      const buttons: vscode.QuickInputButton[] = [];
      if (index > 0) {
        buttons.push(MOVE_UP_BUTTON);
      }
      if (index < presets.length - 1) {
        buttons.push(MOVE_DOWN_BUTTON);
      }
      items.push({
        label: preset.label,
        description: formatSerialConfigSummary(preset.config),
        detail: formatSerialConfigDescription(preset.config),
        buttons,
        index
      });
    }
    return items;
  }

  private async wizardPreset(existing?: { index: number; preset: SerialPortPreset }): Promise<void> {
    const presets = readSerialPortPresets();
    const name = await vscode.window.showInputBox({
      prompt: vscode.l10n.t('Enter a preset name'),
      value: existing?.preset.label ?? '',
      validateInput: value => this.validatePresetLabel(value, presets, existing?.index)
    });
    if (!name) {
      return;
    }
    const baudRateText = await vscode.window.showInputBox({
      prompt: vscode.l10n.t('Enter the baud rate (e.g. 115200, 9600)'),
      value: String(existing?.preset.config.baudRate ?? 115200),
      validateInput: value => this.validateBaudRate(value)
    });
    if (!baudRateText) {
      return;
    }
    const frame = await vscode.window.showQuickPick(
      FRAME_FORMATS.map(f => ({ label: f })),
      { placeHolder: vscode.l10n.t('Select the frame format (data bits-parity-stop bits)') }
    );
    if (!frame) {
      return;
    }
    const flowControl = await vscode.window.showQuickPick(FLOW_CONTROL_OPTIONS, { placeHolder: vscode.l10n.t('Select flow control') });
    if (!flowControl) {
      return;
    }
    const { dataBits, parity, stopBits } = parseFrameFormat(frame.label);
    const entries = readSerialPortPresets().map(toPresetEntry);
    const entry: SerialPortPresetEntry = {
      label: name.trim(),
      baudRate: Number(baudRateText.trim()),
      dataBits,
      parity,
      stopBits,
      flowControl: flowControl.value
    };
    if (existing) {
      entries[existing.index] = entry;
    } else {
      entries.push(entry);
    }
    try {
      await saveSerialPortPresets(entries);
    } catch (error) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to save preset: {0}', `${error}`));
      return;
    }
    vscode.window.showInformationMessage(
      existing
        ? vscode.l10n.t('Preset "{0}" updated', entry.label)
        : vscode.l10n.t('Preset "{0}" added', entry.label)
    );
  }

  private async movePreset(index: number, offset: number): Promise<void> {
    const entries = readSerialPortPresets().map(toPresetEntry);
    const targetIndex = index + offset;
    const moved = entries[index];
    if (!moved || targetIndex < 0 || targetIndex >= entries.length) {
      return;
    }
    entries.splice(index, 1);
    entries.splice(targetIndex, 0, moved);
    try {
      await saveSerialPortPresets(entries);
    } catch (error) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to reorder: {0}', `${error}`));
    }
  }

  private async removePreset(index: number, label: string): Promise<void> {
    const deleteLabel = vscode.l10n.t('Delete');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('Delete preset "{0}"?', label),
      { modal: true },
      deleteLabel
    );
    if (choice !== deleteLabel) {
      return;
    }
    const entries = readSerialPortPresets().map(toPresetEntry);
    entries.splice(index, 1);
    try {
      await saveSerialPortPresets(entries);
    } catch (error) {
      vscode.window.showErrorMessage(vscode.l10n.t('Failed to delete preset: {0}', `${error}`));
      return;
    }
    vscode.window.showInformationMessage(vscode.l10n.t('Preset "{0}" deleted', label));
  }

  private validatePresetLabel(value: string, presets: SerialPortPreset[], excludeIndex?: number): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
      return vscode.l10n.t('Name cannot be empty');
    }
    if (presets.some((p, index) => index !== excludeIndex && p.label === trimmed)) {
      return vscode.l10n.t('Name "{0}" already exists', trimmed);
    }
    return undefined;
  }

  private validateBaudRate(value: string): string | undefined {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) {
      return vscode.l10n.t('Enter a positive integer baud rate (e.g. 115200)');
    }
    return undefined;
  }
}

function buildFrameFormats(): string[] {
  const dataBits = [5, 6, 7, 8];
  const parityLetters: { letter: string; parity: SerialConfig['parity'] }[] = [
    { letter: 'N', parity: 'none' },
    { letter: 'E', parity: 'even' },
    { letter: 'O', parity: 'odd' },
    { letter: 'M', parity: 'mark' },
    { letter: 'S', parity: 'space' }
  ];
  const stopBits = [1, 1.5, 2];
  const formats: string[] = [];
  for (const data of dataBits) {
    for (const { letter } of parityLetters) {
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
