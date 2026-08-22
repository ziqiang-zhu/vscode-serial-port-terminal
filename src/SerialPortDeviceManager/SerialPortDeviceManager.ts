import * as vscode from 'vscode';
import { SerialPort } from 'serialport';

type PortInfo = Awaited<ReturnType<typeof SerialPort.list>>[number];

export type SerialPortDeviceStatus = 'connected' | 'disconnected' | 'connecting';

class SerialPortDeviceItem extends vscode.TreeItem {
  private readonly _info: PortInfo;
  private _status: SerialPortDeviceStatus = 'disconnected';

  constructor(info: PortInfo) {
    super(info.path, vscode.TreeItemCollapsibleState.None);
    this._info = info;

    // set viewItem properties
    this.description = info.manufacturer || 'Unknown Device';
    this.tooltip = `Path: ${info.path}\nVendorID: ${info.vendorId}\nProductID: ${info.productId}\nManufacturer: ${info.manufacturer}`;

    // default disconnected state
    this.status = 'disconnected';
  }

  get path(): string {
    return this._info.path;
  }

  get vendorId(): string {
    return this._info.vendorId || 'Unknown';
  }

  get productId(): string {
    return this._info.productId || 'Unknown';
  }

  get manufacturer(): string {
    return this._info.manufacturer || 'Unknown';
  }

  get status(): SerialPortDeviceStatus {
    return this._status;
  }

  set status(status: SerialPortDeviceStatus) {
    this._status = status;
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
        /*
         * The contextValue is without matched view/item/context in package.json, just used for disable operation,
         * expend cancle operation in the future.
         */
        this.contextValue = 'serialPortDevice.connecting'; 
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

      this.devices = ports.map(port => new SerialPortDeviceItem(port));

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
      device.status = 'connecting';
      vscode.window.showInformationMessage(`连接中: ${device.path}`);
      this._onDidChangeTreeData.fire(device);

      // TODO: real connection logic here
    }
  }

  public disconnectSerialPortDevice(device: SerialPortDeviceItem): void {
    if (device) {
      device.status = 'disconnected';
      vscode.window.showInformationMessage(`断开连接: ${device.path}`);
      this._onDidChangeTreeData.fire(device);
    }
  }
}
