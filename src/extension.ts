import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('serialPortTerminal.open', () => {
			vscode.window.showInformationMessage('Serial Port Terminal: Hello');
		})
	);
}

export function deactivate() {}
