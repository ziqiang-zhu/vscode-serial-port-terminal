import * as vscode from 'vscode';
import { SerialPort } from 'serialport';

class SerialPortDeviceItem extends vscode.TreeItem {
  constructor(
    public readonly path: string,
    public readonly manufacturer?: string,
    public readonly vendorId?: string,
    public readonly productId?: string
  ) {
    super(path, vscode.TreeItemCollapsibleState.None);
    this.description = manufacturer || 'Unknown Device';
    this.tooltip = `Path: ${path}\nVendorID: ${vendorId}\nProductID: ${productId}`;
    this.contextValue = 'serialPortDevice.disconnected'; // default disconnected state
    this.iconPath = new vscode.ThemeIcon('server-environment');
  }
}

class SerialPortDeviceManager implements vscode.TreeDataProvider<SerialPortDeviceItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SerialPortDeviceItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private devices: SerialPortDeviceItem[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

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
      
      this.devices = ports.map(port => new SerialPortDeviceItem(
        port.path,
        port.manufacturer,
        port.vendorId,
        port.productId
      ));

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

  public connectSerialPortDevice(item: SerialPortDeviceItem): void {
    if (item) {
      item.contextValue = 'serialPortDevice.connected';
      vscode.window.showInformationMessage(`连接中: ${item.path}`);
      this._onDidChangeTreeData.fire(item);
    }
  }

  public disconnectSerialPortDevice(item: SerialPortDeviceItem): void {
    if (item) {
      item.contextValue = 'serialPortDevice.disconnected';
      vscode.window.showInformationMessage(`断开连接: ${item.path}`);
      this._onDidChangeTreeData.fire(item);
    }
  }
}

export function initSerialPortDeviceManager(context: vscode.ExtensionContext) {
  console.log('Extension is activating...');

  // 1. 实例化组件：创建串口管理器
  const serialManager = new SerialPortDeviceManager(context);

  // 2. 注册视图：将管理器绑定到侧边栏
  const treeView = vscode.window.createTreeView('serialPortDeviceList', {
    treeDataProvider: serialManager, // 直接传入管理器实例
    showCollapseAll: false
  });
  context.subscriptions.push(treeView);

  // 3. 注册命令：将用户的操作转发给组件
  const refreshCommand = vscode.commands.registerCommand('serialPortDeviceList.refresh', () => {
    serialManager.refresh();
  });
  context.subscriptions.push(refreshCommand);

  const connectCommand = vscode.commands.registerCommand('serialPortDevice.connect', (item: SerialPortDeviceItem) => {
    serialManager.connectSerialPortDevice(item);
  });
  context.subscriptions.push(connectCommand);

  const disconnectCommand = vscode.commands.registerCommand('serialPortDevice.disconnect', (item: SerialPortDeviceItem) => {
    serialManager.disconnectSerialPortDevice(item);
  });
  context.subscriptions.push(disconnectCommand);

  // 4. 启动组件
  serialManager.init();
}