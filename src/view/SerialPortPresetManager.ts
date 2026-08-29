import * as vscode from 'vscode';
import { formatSerialConfigDescription, formatSerialConfigSummary } from '../SerialPortConfig/SerialPortQuickConfig';
import { SerialPortPreset, SerialPortPresetEntry, readSerialPortPresets, saveSerialPortPresets, toPresetEntry } from '../SerialPortConfig/SerialPortPresets';
import { pickSerialConfig } from '../SerialPortConfig/SerialPortConfigWizard';

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
    const config = await pickSerialConfig(existing?.preset.config);
    if (!config) {
      return;
    }
    const entries = readSerialPortPresets().map(toPresetEntry);
    const entry: SerialPortPresetEntry = {
      label: name.trim(),
      baudRate: config.baudRate,
      dataBits: config.dataBits,
      parity: config.parity,
      stopBits: config.stopBits,
      flowControl: config.flowControl
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

}
