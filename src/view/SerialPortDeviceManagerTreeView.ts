import * as vscode from 'vscode';
import { SerialPortDeviceDetector, SerialPortDevicesChangeEvent } from '../SerialPortDeviceDetector/SerialPortDeviceDetector';
import { SerialPortConnectionService } from '../SerialPortConnection/SerialPortConnectionService';
import { SerialPortConfigStore } from '../SerialPortConfig/SerialPortConfigStore';
import { SerialConfig, formatSerialConfigDescription, formatSerialConfigSummary, serialConfigEquals } from '../SerialPortConfig/SerialPortQuickConfig';
import { readSerialPortPresets } from '../SerialPortConfig/SerialPortPresets';
import { SerialPortDeviceTreeItem } from './SerialPortDeviceTreeItem';
import { SerialPortQuickConfigTreeItem } from './SerialPortQuickConfigTreeItem';

type ViewItem = SerialPortDeviceTreeItem | SerialPortQuickConfigTreeItem;
type ConfigPickItem = vscode.QuickPickItem & { config?: SerialConfig; configName?: string };

export class SerialPortDeviceManagerTreeView implements vscode.TreeDataProvider<ViewItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ViewItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items = new Map<string, SerialPortDeviceTreeItem>();

  private selectedItem: ViewItem | undefined;

  private readonly treeView: vscode.TreeView<ViewItem>;

  constructor(
    private readonly detector: SerialPortDeviceDetector,
    private readonly connectionService: SerialPortConnectionService,
    private readonly configStore: SerialPortConfigStore,
    context: vscode.ExtensionContext
  ) {
    this.treeView = vscode.window.createTreeView('serialPortDeviceList', {
      treeDataProvider: this,
      showCollapseAll: false
    });
    context.subscriptions.push(this.treeView);

    context.subscriptions.push(
      detector.onDidChangeDevices(event => {
        this.handleDevicesChanged(event);
      })
    );

    context.subscriptions.push(
      connectionService.onDidChangeDeviceStatus(() => {
        this._onDidChangeTreeData.fire();
      })
    );

    context.subscriptions.push(
      configStore.onDidChangeConfigs(() => {
        this._onDidChangeTreeData.fire();
      })
    );

    context.subscriptions.push(this.treeView.onDidChangeVisibility(({ visible }) => {
      if (visible) {
        detector.start();
      } else {
        detector.stop();
      }
    }));
    context.subscriptions.push(this.treeView.onDidChangeSelection(({ selection }) => {
      this.selectedItem = selection.length === 1 ? selection[0] : undefined;
    }));
    if (this.treeView.visible) {
      detector.start();
    }

    context.subscriptions.push(
      vscode.commands.registerCommand('serialPortDeviceList.refresh', () => {
        void detector.scan();
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('serialPortDevice.connect', (item: SerialPortDeviceTreeItem) => {
        if (item) {
          void this.connectDevice(item);
        }
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('serialPortDevice.disconnect', (item: SerialPortDeviceTreeItem) => {
        if (item) {
          void connectionService.disconnect(item.device);
        }
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('serialPortQuickConfig.add', (item: SerialPortDeviceTreeItem) => {
        if (item) {
          void this.addQuickConfig(item);
        }
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('serialPortQuickConfig.rename', (item: SerialPortQuickConfigTreeItem) => {
        if (item) {
          void this.renameQuickConfig(item);
        }
      })
    );
    context.subscriptions.push(
      vscode.commands.registerCommand('serialPortQuickConfig.remove', (item: SerialPortQuickConfigTreeItem) => {
        if (item) {
          void this.removeQuickConfig(item);
        }
      })
    );

    void detector.scan();
  }

  getTreeItem(element: ViewItem): vscode.TreeItem {
    if (element instanceof SerialPortDeviceTreeItem) {
      element.syncStatusAppearance();
      element.syncConnectionConfig(this.connectionService.getConnectionConfig(element.device.path));
      element.collapsibleState = this.hasQuickConfigs(element.device.identity)
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;
    } else {
      element.syncActiveState(this.connectionService.getConnectionConfig(element.device.path));
    }
    return element;
  }

  getChildren(element?: ViewItem): Thenable<ViewItem[]> {
    if (element instanceof SerialPortDeviceTreeItem) {
      return Promise.resolve(
        this.configStore
          .getConfigs(element.device.identity)
          .map(config => new SerialPortQuickConfigTreeItem(element.device, config))
      );
    }
    return Promise.resolve([...this.items.values()]);
  }

  private hasQuickConfigs(identity: string): boolean {
    return this.configStore.getConfigs(identity).length > 0;
  }

  private async connectDevice(item: SerialPortDeviceTreeItem): Promise<void> {
    const selected = this.selectedItem;
    if (selected instanceof SerialPortQuickConfigTreeItem && selected.device.path === item.device.path) {
      await this.connectWithConfig(item, selected.quickConfig.config, selected.quickConfig.name);
      return;
    }
    const identity = item.device.identity;
    const saved = this.configStore.getConfigs(identity);
    const presets = readSerialPortPresets();
    if (saved.length === 0 && presets.length === 0) {
      vscode.window.showWarningMessage(vscode.l10n.t('No connectable parameters: add presets in settings or add a quick config for the device'));
      return;
    }
    const lastUsed = this.configStore.getLastUsedConfig(identity);
    const orderedSaved = lastUsed
      ? [...saved].sort(
          (a, b) =>
            Number(serialConfigEquals(lastUsed, b.config)) - Number(serialConfigEquals(lastUsed, a.config))
        )
      : saved;
    const items: ConfigPickItem[] = [];
    if (orderedSaved.length > 0) {
      items.push({ label: vscode.l10n.t('Saved Configs'), kind: vscode.QuickPickItemKind.Separator });
      for (const quickConfig of orderedSaved) {
        const isLastUsed = lastUsed !== undefined && serialConfigEquals(lastUsed, quickConfig.config);
        items.push({
          label: quickConfig.name,
          description: `${isLastUsed ? vscode.l10n.t('Last used · ') : ''}${formatSerialConfigSummary(quickConfig.config)}`,
          detail: formatSerialConfigDescription(quickConfig.config),
          config: quickConfig.config,
          configName: quickConfig.name
        });
      }
    }
    items.push({ label: vscode.l10n.t('Presets'), kind: vscode.QuickPickItemKind.Separator });
    for (const preset of presets) {
      items.push({
        label: preset.label,
        description: formatSerialConfigDescription(preset.config),
        config: preset.config
      });
    }
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t('Select connection parameters (baud rate/data bits/parity/stop bits/flow control)'),
      matchOnDescription: true
    });
    if (!picked?.config) {
      return;
    }
    await this.connectWithConfig(item, picked.config, picked.configName);
  }

  private async connectWithConfig(item: SerialPortDeviceTreeItem, config: SerialConfig, label?: string): Promise<void> {
    await this.connectionService.connect(item.device, config, label);
    if (item.device.status === 'connected') {
      this.configStore.setLastUsedConfig(item.device.identity, config);
    }
  }

  private async addQuickConfig(item: SerialPortDeviceTreeItem): Promise<void> {
    const identity = item.device.identity;
    const name = await vscode.window.showInputBox({
      prompt: vscode.l10n.t('Enter a config name'),
      value: vscode.l10n.t('Config {0}', this.configStore.getConfigs(identity).length + 1),
      validateInput: value => this.validateConfigName(identity, value)
    });
    if (!name) {
      return;
    }
    const presets = readSerialPortPresets();
    if (presets.length === 0) {
      vscode.window.showWarningMessage(vscode.l10n.t('No presets available: add some in settings (serialPortTerminal.serialConfigPresets)'));
      return;
    }
    const preset = await vscode.window.showQuickPick(
      presets.map(p => ({
        label: p.label,
        description: formatSerialConfigDescription(p.config),
        config: p.config
      })),
      { placeHolder: vscode.l10n.t('Select a preset parameter combo (baud rate/data bits/parity/stop bits/flow control)'), matchOnDescription: true }
    );
    if (!preset) {
      return;
    }
    this.configStore.add(identity, name, preset.config);
    await this.treeView.reveal(item, { expand: true, focus: true });
  }
 
  private async renameQuickConfig(item: SerialPortQuickConfigTreeItem): Promise<void> {
    const { device, quickConfig } = item;
    const name = await vscode.window.showInputBox({
      prompt: vscode.l10n.t('Enter a new name'),
      value: quickConfig.name,
      validateInput: value => this.validateConfigName(device.identity, value, quickConfig.id)
    });
    if (!name) {
      return;
    }
    this.configStore.rename(device.identity, quickConfig.id, name);
  }

  private async removeQuickConfig(item: SerialPortQuickConfigTreeItem): Promise<void> {
    const { device, quickConfig } = item;
    const deleteLabel = vscode.l10n.t('Delete');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('Delete config "{0}"?', quickConfig.name),
      { modal: true },
      deleteLabel
    );
    if (choice !== deleteLabel) {
      return;
    }
    this.configStore.remove(device.identity, quickConfig.id);
  }

  private validateConfigName(identity: string, value: string, excludeId?: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
      return vscode.l10n.t('Name cannot be empty');
    }
    if (this.configStore.getConfigs(identity).some(c => c.id !== excludeId && c.name === trimmed)) {
      return vscode.l10n.t('Name "{0}" already exists', trimmed);
    }
    return undefined;
  }

  private handleDevicesChanged(event: SerialPortDevicesChangeEvent): void {
    for (const device of event.added) {
      this.items.set(device.path, new SerialPortDeviceTreeItem(device));
    }
    for (const device of event.removed) {
      this.items.delete(device.path);
    }
    this.updateEmptyStateMessage();
    this._onDidChangeTreeData.fire();
  }

  private updateEmptyStateMessage(): void {
    this.treeView.message = this.items.size > 0 ? '' : vscode.l10n.t('No serial devices detected');
  }
}
