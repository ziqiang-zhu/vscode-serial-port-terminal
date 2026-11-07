import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { describe, it } from 'mocha';

// 控制台视图（doc/Test/开发测试体系规划.md §6.10 #21）：
// 测试构建下视图已静态声明且提供器已注册，focus 命令可解析执行。
// Webview DOM 归宿主渲染进程，扩展侧不可达（页面交互的深度断言不在此层）。
describe('控制台视图（测试构建）', () => {
  it('#21 resolves the webview view via the focus command', async () => {
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('serialPortConsole.focus'); // Thenable → async 包装
    });
  });
});
