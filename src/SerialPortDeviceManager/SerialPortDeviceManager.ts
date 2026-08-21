import * as vscode from 'vscode';
import { SerialPort } from 'serialport';

export type SerialPortDeviceStatus = 'connected' | 'disconnected' | 'loading';

export interface SerialPortDevice {
  readonly path: string,
  readonly manufacturer?: string,
  readonly vendorId?: string,
  readonly productId?: string

  setConnectStatus(status: SerialPortDeviceStatus): void;
}

class SerialPortDeviceItem extends vscode.TreeItem {
  constructor(
    public readonly path: string,
    public readonly manufacturer?: string,
    public readonly vendorId?: string,
    public readonly productId?: string
  ) {
    super(path, vscode.TreeItemCollapsibleState.None);
    this.description = manufacturer || 'Unknown Device';
    this.tooltip = `Path: ${path}\nVendorID: ${vendorId}\nProductID: ${productId}\nManufacturer: ${manufacturer}`;
    this.contextValue = 'serialPortDevice.disconnected'; // default disconnected state
    this.iconPath = new vscode.ThemeIcon('vm-outline');
  }
  setConnectStatus(status: SerialPortDeviceStatus): void {
    switch (status) {
      case 'connected':
        this.contextValue = 'serialPortDevice.connected';
        this.iconPath = new vscode.ThemeIcon('vm-connect');
        break;
      case 'disconnected':
        this.contextValue = 'serialPortDevice.disconnected';
        this.iconPath = new vscode.ThemeIcon('vm-outline');
        break;
      case 'loading':
        this.contextValue = '';
        this.iconPath = new vscode.ThemeIcon('loading~spin');
        break;
    }
  }
}

class SerialPortDeviceManager implements vscode.TreeDataProvider<SerialPortDeviceItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SerialPortDeviceItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private devices: SerialPortDeviceItem[] = [];

  // record all connected device paths for refresh keeping the connection status
  private connectedPaths = new Set<string>();

  private updateSerialPortDeviceConnectionStatus(item: SerialPortDeviceItem): void {
    if (this.connectedPaths.has(item.path)) {
      item.setConnectStatus('connected');
    } else {
      item.setConnectStatus('disconnected');
    }
  }

  constructor(private readonly context: vscode.ExtensionContext) {
    const refreshCommand = vscode.commands.registerCommand('serialPortDeviceList.refresh', () => {
      this.refresh();
    });
    context.subscriptions.push(refreshCommand);

    const connectCommand = vscode.commands.registerCommand('serialPortDevice.connect', (device: SerialPortDevice) => {
      this.connectSerialPortDevice(device);
    });
    context.subscriptions.push(connectCommand);

    const disconnectCommand = vscode.commands.registerCommand('serialPortDevice.disconnect', (device: SerialPortDevice) => {
      this.disconnectSerialPortDevice(device);
    });
    context.subscriptions.push(disconnectCommand);

    const treeView = vscode.window.createTreeView('serialPortDeviceList', {
      treeDataProvider: this,
      showCollapseAll: false
    });
    context.subscriptions.push(treeView);
  }

  public async init(): Promise<void> {
    try {
      await this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`初始化串口管理器失败: ${error}`);
    }
  }

  public async refresh(): Promise<void> {
    try {
      // call serialport to get current device list
      const ports = await SerialPort.list();

      const livePaths = new Set(ports.map(port => port.path));
      this.connectedPaths = new Set([...this.connectedPaths].filter(path => livePaths.has(path)));

      this.devices = ports.map(port => {
        const item = new SerialPortDeviceItem(
          port.path,
          port.manufacturer,
          port.vendorId,
          port.productId
        );
        this.updateSerialPortDeviceConnectionStatus(item);
        return item;
      });

      this._onDidChangeTreeData.fire();
      vscode.window.setStatusBarMessage('串口设备列表已刷新', 1500);
    } catch (error) {
      console.error('Refresh error:', error);
      vscode.window.showErrorMessage(`获取串口列表失败: ${error}`);
      throw error;
    }
  }

  getTreeItem(element: SerialPortDeviceItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SerialPortDeviceItem): Thenable<SerialPortDeviceItem[]> {
    if (!element) {
      return Promise.resolve(this.devices);
    }
    return Promise.resolve([]);
  }

  public connectSerialPortDevice(device: SerialPortDevice): void {
    if (device) {
      this.connectedPaths.add(device.path);
      device.setConnectStatus('loading');
      vscode.window.showInformationMessage(`连接中: ${device.path}`);
      this._onDidChangeTreeData.fire(device);
    }
  }

  public disconnectSerialPortDevice(device: SerialPortDevice): void {
    if (device) {
      this.connectedPaths.delete(device.path);
      device.setConnectStatus('disconnected');
      vscode.window.showInformationMessage(`断开连接: ${device.path}`);
      this._onDidChangeTreeData.fire(device);
    }
  }
}

export function initSerialPortDeviceManager(context: vscode.ExtensionContext) {
  console.log('Extension is activating...');
  const serialManager = new SerialPortDeviceManager(context);

  serialManager.init();
}