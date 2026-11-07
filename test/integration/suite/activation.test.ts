import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { describe, it } from 'mocha';

// 扩展激活冒烟（黑盒，真实装配路径）：宿主经 extension.ts 完整装配后激活。
// 契约见 doc/Test/开发测试体系规划.md §6.10 #1。
describe('扩展激活（黑盒，真实装配路径）', () => {
  it('#1 activates and registers core commands', async () => {
    const extension = vscode.extensions.getExtension('ziqiang.serial-port-terminal');
    assert.ok(extension, 'extension not found');
    if (!extension.isActive) {
      await extension.activate();
    }
    assert.ok(extension.isActive);
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['serialPortDeviceList.refresh', 'serialPortDevice.connect', 'serialPortConsole.focus']) {
      assert.ok(commands.includes(id), `command missing: ${id}`);
    }
  });
});
