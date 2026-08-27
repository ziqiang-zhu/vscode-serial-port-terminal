import * as vscode from 'vscode';
import { SerialPortConnectionService } from '../SerialPortConnection/SerialPortConnectionService';
import { getActiveSerialPortDevicePath } from '../SerialPortConsumer/SerialPortTerminal/SerialPortTerminal';
import { SerialPortMacro } from './SerialPortMacro';
import { SerialPortMacroTreeItem } from './SerialPortMacroTreeItem';

const STORAGE_KEY = 'serialPortMacros';

export class SerialPortMacroManager implements vscode.TreeDataProvider<SerialPortMacroTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SerialPortMacroTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(
    private readonly connectionService: SerialPortConnectionService,
    private readonly storage: vscode.Memento,
    context: vscode.ExtensionContext
  ) {
    const treeView = vscode.window.createTreeView('serialPortMacroList', {
      treeDataProvider: this,
      showCollapseAll: false
    });
    context.subscriptions.push(treeView);

    context.subscriptions.push(
      vscode.commands.registerCommand('serialPortMacro.add', () => {
        void this.addMacro();
      }),
      vscode.commands.registerCommand('serialPortMacro.remove', (item: SerialPortMacroTreeItem) => {
        if (item) {
          void this.removeMacro(item);
        }
      }),
      vscode.commands.registerCommand('serialPortMacro.send', (item: SerialPortMacroTreeItem) => {
        if (item) {
          this.sendMacro(item);
        }
      })
    );
  }

  getTreeItem(element: SerialPortMacroTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SerialPortMacroTreeItem[] {
    return this.readMacros().map(macro => new SerialPortMacroTreeItem(macro));
  }

  private async addMacro(): Promise<void> {
    const label = await vscode.window.showInputBox({
      prompt: vscode.l10n.t('Enter a macro name'),
      validateInput: value => this.validateLabel(value)
    });
    if (!label) {
      return;
    }

    const data = await vscode.window.showInputBox({
      prompt: vscode.l10n.t('Enter the data to send (use \\r\\n for a line ending)'),
      placeHolder: 'reboot\\r\\n'
    });
    if (data === undefined) {
      return;
    }

    const macros = this.readMacros();
    macros.push({ label: label.trim(), data });
    this.saveMacros(macros);
    this._onDidChangeTreeData.fire();
  }

  private async removeMacro(item: SerialPortMacroTreeItem): Promise<void> {
    const deleteLabel = vscode.l10n.t('Delete');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('Delete macro "{0}"?', item.macro.label),
      { modal: true },
      deleteLabel
    );
    if (choice !== deleteLabel) {
      return;
    }
    this.saveMacros(this.readMacros().filter(m => m.label !== item.macro.label));
    this._onDidChangeTreeData.fire();
  }

  private sendMacro(item: SerialPortMacroTreeItem): void {
    const path = getActiveSerialPortDevicePath();
    if (!path) {
      vscode.window.showWarningMessage(vscode.l10n.t('No active serial connection'));
      return;
    }
    const connection = this.connectionService.getConnection(path);
    if (!connection) {
      vscode.window.showWarningMessage(vscode.l10n.t('No active serial connection'));
      return;
    }
    connection.send(Buffer.from(interpretEscapes(item.macro.data), 'utf-8'));
  }

  private validateLabel(value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
      return vscode.l10n.t('Name cannot be empty');
    }
    if (this.readMacros().some(m => m.label === trimmed)) {
      return vscode.l10n.t('Name "{0}" already exists', trimmed);
    }
    return undefined;
  }

  private readMacros(): SerialPortMacro[] {
    return this.storage.get<SerialPortMacro[]>(STORAGE_KEY, []);
  }

  private saveMacros(macros: SerialPortMacro[]): void {
    void this.storage.update(STORAGE_KEY, macros);
  }
}

function interpretEscapes(data: string): string {
  return data.replace(/\\([rnt\\])/g, (_, c: string) => {
    if (c === 'r') {
      return '\r';
    }
    if (c === 'n') {
      return '\n';
    }
    if (c === 't') {
      return '\t';
    }
    return '\\';
  });
}
