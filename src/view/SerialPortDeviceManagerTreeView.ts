import * as vscode from 'vscode';
import { SerialPortDeviceDetector, SerialPortDevicesChangeEvent } from '../SerialPortDeviceDetector/SerialPortDeviceDetector';
import { SerialPortConnectionService } from '../SerialPortConnection/SerialPortConnectionService';
import { SerialPortConfigStore } from '../SerialPortConfig/SerialPortConfigStore';
import { SerialConfig, formatSerialConfigDescription, formatSerialConfigSummary, serialPortPresets } from '../SerialPortConfig/SerialPortQuickConfig';
import { SerialPortDeviceTreeItem } from './SerialPortDeviceTreeItem';
import { SerialPortQuickConfigTreeItem } from './SerialPortQuickConfigTreeItem';

type ViewItem = SerialPortDeviceTreeItem | SerialPortQuickConfigTreeItem;
type ConfigPickItem = vscode.QuickPickItem & { config?: SerialConfig };

export class SerialPortDeviceManagerTreeView implements vscode.TreeDataProvider<ViewItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ViewItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items = new Map<string, SerialPortDeviceTreeItem>();

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
      element.collapsibleState = this.hasQuickConfigs(element.device.identity)
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;
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
    const saved = this.configStore.getConfigs(item.device.identity);
    const items: ConfigPickItem[] = [];
    if (saved.length > 0) {
      items.push({ label: '保存的配置', kind: vscode.QuickPickItemKind.Separator });
      for (const quickConfig of saved) {
        items.push({
          label: quickConfig.name,
          description: formatSerialConfigSummary(quickConfig.config),
          detail: formatSerialConfigDescription(quickConfig.config),
          config: quickConfig.config
        });
      }
    }
    items.push({ label: '预设组合', kind: vscode.QuickPickItemKind.Separator });
    for (const preset of serialPortPresets) {
      items.push({
        label: preset.label,
        description: formatSerialConfigDescription(preset.config),
        config: preset.config
      });
    }
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: '选择本次连接参数（不会保存为快捷配置）',
      matchOnDescription: true
    });
    if (!picked?.config) {
      return;
    }
    await this.connectionService.connect(item.device, picked.config);
  }

  private async addQuickConfig(item: SerialPortDeviceTreeItem): Promise<void> {
    const identity = item.device.identity;
    const name = await vscode.window.showInputBox({
      prompt: '输入配置名称（如：开发板调试、GPS 模块）',
      value: `配置 ${this.configStore.getConfigs(identity).length + 1}`,
      validateInput: value => this.validateConfigName(identity, value)
    });
    if (!name) {
      return;
    }
    const preset = await vscode.window.showQuickPick(
      serialPortPresets.map(p => ({
        label: p.label,
        description: formatSerialConfigDescription(p.config),
        config: p.config
      })),
      { placeHolder: '选择预设参数组合（波特率/数据位/校验/停止位/流控）', matchOnDescription: true }
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
      prompt: '输入新名称',
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
    const choice = await vscode.window.showWarningMessage(
      `删除配置 "${quickConfig.name}"？`,
      { modal: true },
      '删除'
    );
    if (choice !== '删除') {
      return;
    }
    this.configStore.remove(device.identity, quickConfig.id);
  }

  private validateConfigName(identity: string, value: string, excludeId?: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
      return '名称不能为空';
    }
    if (this.configStore.getConfigs(identity).some(c => c.id !== excludeId && c.name === trimmed)) {
      return `名称 "${trimmed}" 已存在`;
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
    this.treeView.message = this.items.size > 0 ? '' : '未检测到串口设备';
  }
}
