import * as vscode from 'vscode';
import { SerialPort } from 'serialport';

export type SerialPortDeviceStatus = 'connected' | 'disconnected' | 'connecting';

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
    this.setConnectStatus('disconnected');  // default disconnected state
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
      case 'connecting':
        this.contextValue = 'serialPortDevice.connecting'; // without matched view/item/context, used to disable operation.
        this.iconPath = new vscode.ThemeIcon('loading~spin');
        break;
    }
  }
}

export class SerialPortDeviceManager implements vscode.TreeDataProvider<SerialPortDeviceItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SerialPortDeviceItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private devices: SerialPortDeviceItem[] = [];

  // 视图引用，用于空状态提示等视图级操作
  private readonly treeView: vscode.TreeView<SerialPortDeviceItem>;

  constructor(private readonly context: vscode.ExtensionContext) {
    // register commands
    const refreshCommand = vscode.commands.registerCommand('serialPortDeviceList.refresh', () => {
      this.refresh();
    });
    context.subscriptions.push(refreshCommand);

    const connectCommand = vscode.commands.registerCommand('serialPortDevice.connect', (device: SerialPortDeviceItem) => {
      this.connectSerialPortDevice(device);
    });
    context.subscriptions.push(connectCommand);

    const disconnectCommand = vscode.commands.registerCommand('serialPortDevice.disconnect', (device: SerialPortDeviceItem) => {
      this.disconnectSerialPortDevice(device);
    });
    context.subscriptions.push(disconnectCommand);

    // create tree view
    this.treeView = vscode.window.createTreeView('serialPortDeviceList', {
      treeDataProvider: this,
      showCollapseAll: false
    });
    context.subscriptions.push(this.treeView);

    // initialize device list
    void this.init();
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

      this.devices = ports.map(port => new SerialPortDeviceItem(
        port.path,
        port.manufacturer,
        port.vendorId,
        port.productId
      ));

      this.treeView.message = this.devices.length > 0 ? '' : '未检测到串口设备';

      this._onDidChangeTreeData.fire();
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

  public connectSerialPortDevice(device: SerialPortDeviceItem): void {
    if (device) {
      device.setConnectStatus('connecting');
      vscode.window.showInformationMessage(`连接中: ${device.path}`);
      this._onDidChangeTreeData.fire(device);

      // TODO: real connection logic here
    }
  }

  public disconnectSerialPortDevice(device: SerialPortDeviceItem): void {
    if (device) {
      device.setConnectStatus('disconnected');
      vscode.window.showInformationMessage(`断开连接: ${device.path}`);
      this._onDidChangeTreeData.fire(device);
    }
  }
}
