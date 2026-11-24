import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as vm from 'vm';

import { SerialPortAssist } from '../../src/SerialPortConsumer/SerialPortAssist/SerialPortAssist';

// 页脚本语法守卫：串口助手面板的页脚本写在 buildHtml() 的模板字面量里，模板内的
// 转义序列在编译期被解析——写法有误时整段脚本语法错误，面板全部控件失效。
// Consumer 侧用例不执行页脚本，测试全绿也发现不了。本守卫取真实下发的页脚本
// 做语法解析，语法错误在此即时失败。buildHtml 取 l10n 文案，依赖 vscode 模块桩。

const extractPageScript = (): string => {
  const assist = new SerialPortAssist();
  const html = (assist as unknown as { buildHtml(): string }).buildHtml();
  const match = /<script nonce="[^"]*">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, 'page script block not found in the delivered HTML');
  const script = match[1];
  assert.ok(script, 'page script block is empty');
  return script;
};

describe('串口助手页脚本（语法守卫）', () => {
  it('#1 the delivered page script parses without syntax errors', () => {
    const script = extractPageScript();
    assert.ok(script.includes('acquireVsCodeApi()'), 'extracted block is not the panel script');
    assert.doesNotThrow(() => new vm.Script(script, { filename: 'serialPortAssist.page.js' }));
  });
});
