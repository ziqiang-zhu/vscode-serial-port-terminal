import * as vscode from 'vscode';
import { SerialPortDeviceDetector, SerialPortDevicesChangeEvent } from '../SerialPortDeviceDetector/SerialPortDeviceDetector';
import { SerialPortConnectionService } from '../SerialPortConnection/SerialPortConnectionService';
import { SerialPortDeviceTreeItem } from './SerialPortDeviceTreeItem';

export class SerialPortDeviceManagerTreeView implements vscode.TreeDataProvider<SerialPortDeviceTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SerialPortDeviceTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private items = new Map<string, SerialPortDeviceTreeItem>();

  private readonly treeView: vscode.TreeView<SerialPortDeviceTreeItem>;

  constructor(
    private readonly detector: SerialPortDeviceDetector,
    connectionService: SerialPortConnectionService,
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
          void connectionService.connect(item.device);
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

    void detector.scan();
  }

  getTreeItem(element: SerialPortDeviceTreeItem): vscode.TreeItem {
    element.syncStatusAppearance();
    return element;
  }

  getChildren(element?: SerialPortDeviceTreeItem): Thenable<SerialPortDeviceTreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }
    return Promise.resolve([...this.items.values()]);
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
