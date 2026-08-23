import * as vscode from 'vscode';
import { SerialConfig, formatSerialConfigDescription, formatSerialConfigSummary } from '../SerialPortConfig/SerialPortQuickConfig';
import { SerialPortPreset, SerialPortPresetEntry, readSerialPortPresets, saveSerialPortPresets, toPresetEntry } from '../SerialPortConfig/SerialPortPresets';

const FRAME_FORMATS = [
  '8-N-1', '8-N-2', '8-E-1', '8-E-2', '8-O-1', '8-O-2',
  '7-N-1', '7-N-2', '7-E-1', '7-E-2', '7-O-1', '7-O-2'
];

const FLOW_CONTROL_OPTIONS: { label: string; value: SerialConfig['flowControl'] }[] = [
  { label: '无', value: 'none' },
  { label: 'RTS/CTS', value: 'rtscts' }
];

const MOVE_UP_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('arrow-up'), tooltip: '上移' };
const MOVE_DOWN_BUTTON: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('arrow-down'), tooltip: '下移' };

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
          { label: '$(edit) 编辑', value: 'edit' },
          { label: '$(trash) 删除', value: 'remove' }
        ],
        { placeHolder: `预设 "${target.label}"` }
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
      picker.placeholder = '管理预设组合（悬停条目点击 ↑/↓ 按钮排序）';
      picker.matchOnDescription = true;
      picker.onDidAccept(() => {
        const selected = picker.selectedItems[0];
        picker.dispose();
        resolve(selected);
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
        picker.dispose();
        resolve(undefined);
      });
      picker.show();
    });
  }

  private buildPresetItems(): PresetPickItem[] {
    const presets = readSerialPortPresets();
    const items: PresetPickItem[] = [
      { label: '$(add) 新增预设', action: 'add' },
      { label: '预设列表', kind: vscode.QuickPickItemKind.Separator }
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
      prompt: '输入预设名称',
      value: existing?.preset.label ?? '',
      validateInput: value => this.validatePresetLabel(value, presets, existing?.index)
    });
    if (!name) {
      return;
    }
    const baudRateText = await vscode.window.showInputBox({
      prompt: '输入波特率（如 115200、9600）',
      value: String(existing?.preset.config.baudRate ?? 115200),
      validateInput: value => this.validateBaudRate(value)
    });
    if (!baudRateText) {
      return;
    }
    const frame = await vscode.window.showQuickPick(
      FRAME_FORMATS.map(f => ({ label: f })),
      { placeHolder: '选择帧格式（数据位-校验-停止位）' }
    );
    if (!frame) {
      return;
    }
    const flowControl = await vscode.window.showQuickPick(FLOW_CONTROL_OPTIONS, { placeHolder: '选择流控' });
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
      vscode.window.showErrorMessage(`保存预设失败: ${error}`);
      return;
    }
    vscode.window.showInformationMessage(existing ? `预设 "${entry.label}" 已更新` : `预设 "${entry.label}" 已新增`);
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
      vscode.window.showErrorMessage(`调整顺序失败: ${error}`);
    }
  }

  private async removePreset(index: number, label: string): Promise<void> {
    const choice = await vscode.window.showWarningMessage(`删除预设 "${label}"？`, { modal: true }, '删除');
    if (choice !== '删除') {
      return;
    }
    const entries = readSerialPortPresets().map(toPresetEntry);
    entries.splice(index, 1);
    try {
      await saveSerialPortPresets(entries);
    } catch (error) {
      vscode.window.showErrorMessage(`删除预设失败: ${error}`);
      return;
    }
    vscode.window.showInformationMessage(`预设 "${label}" 已删除`);
  }

  private validatePresetLabel(value: string, presets: SerialPortPreset[], excludeIndex?: number): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
      return '名称不能为空';
    }
    if (presets.some((p, index) => index !== excludeIndex && p.label === trimmed)) {
      return `名称 "${trimmed}" 已存在`;
    }
    return undefined;
  }

  private validateBaudRate(value: string): string | undefined {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) {
      return '请输入正整数波特率（如 115200）';
    }
    return undefined;
  }
}

function parseFrameFormat(frame: string): { dataBits: number; parity: SerialConfig['parity']; stopBits: number } {
  const parts = frame.split('-');
  const parity = parts[1] === 'E' ? 'even' : parts[1] === 'O' ? 'odd' : 'none';
  return { dataBits: Number(parts[0]), parity, stopBits: Number(parts[2]) };
}
