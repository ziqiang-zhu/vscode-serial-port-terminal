import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as vm from 'vm';
import * as fs from 'fs';
import * as path from 'path';

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

// 宿主分支集合的期望快照：新增页面消息时必须同步更新此列表与宿主分支、
// 页面发送点三处（对账测试 #2 的冻结锚点）。
const EXPECTED_PAGE_MESSAGES = [
  'ready',
  'sendText',
  'sendHex',
  'recordStart',
  'recordStop',
  'bridgeStart',
  'bridgeStop',
  'slotSend',
  'slotIntervalStart',
  'slotIntervalStop',
  'pickSendFile',
  'sendFileOnce',
  'startFileSend',
  'stopFileSend',
  'pauseFileSend',
  'resumeFileSend',
];

const repoRoot = path.join(__dirname, '..', '..', '..');

describe('串口助手页脚本（语法守卫）', () => {
  it('#1 the delivered page script parses without syntax errors', () => {
    const script = extractPageScript();
    assert.ok(script.includes('acquireVsCodeApi()'), 'extracted block is not the panel script');
    assert.doesNotThrow(() => new vm.Script(script, { filename: 'serialPortAssist.page.js' }));
  });

  it('#2 every page message type has a matching host branch', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'src', 'SerialPortConsumer', 'SerialPortAssist', 'SerialPortAssist.ts'),
      'utf8'
    );
    // 宿主分支集合：msg.type === '…' 的全部字面量
    // 同一分支可能在复合条件与内层判断各出现一次（如 pickSendFile）——按集合去重
    const handled = [...new Set([...source.matchAll(/msg\.type === '([A-Za-z]+)'/g)].map(match => match[1]))].sort();
    // 对账一：宿主分支与期望快照完全一致——增删分支必须显式更新此列表，
    // 强制同步审视页面发送点与宿主处理两侧
    assert.deepEqual(handled, [...EXPECTED_PAGE_MESSAGES].sort());
    // 对账二：每个宿主处理的类型，页面脚本中必须存在其带引号字面量（发送点或
    // 三元分支两侧均算）——宿主有分支而页面从不发送（按钮失效类缺陷）在此暴露
    const pageScript = extractPageScript();
    for (const type of EXPECTED_PAGE_MESSAGES) {
      assert.ok(
        pageScript.includes(`'${type}'`),
        `page script must reference '${type}' (host handles it)`
      );
    }
  });
});
