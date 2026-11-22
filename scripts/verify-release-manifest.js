// 发布防线：校验清单携带 VDC 产品化产物——虚拟设备控制台视图带 when 守卫、
// virtualConsole 设置在位、testMode.* 不暴露为设置（虚拟参数由控制台管理，重启
// 回归默认），清单 %key% 均能解析到 package.nls.json。防止清单漂移导致功能缺失、
// 守卫丢失或本地化键悬空。作为 vscode:prepublish 的第三道前置执行，非零退出即
// 中止 vsce package / publish。见 doc/编译指导.md §4.3。
'use strict';

const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const nls = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.nls.json'), 'utf8'));
const problems = [];

// configuration 兼容单对象与数组两种清单形态。
const configuration = manifest.contributes?.configuration;
const properties = Array.isArray(configuration)
  ? Object.assign({}, ...configuration.map(item => item.properties ?? {}))
  : configuration?.properties ?? {};

const views = manifest.contributes?.views?.serialPortTerminalSideBar ?? [];
const consoleView = views.find(view => view.id === 'serialPortConsole');
if (!consoleView) {
  problems.push('contributes.views must declare serialPortConsole (Virtual Device Console)');
} else if (consoleView.when !== 'serialPortTerminal.virtualConsoleActive') {
  problems.push('serialPortConsole view must guard visibility with when: "serialPortTerminal.virtualConsoleActive"');
}

const testModeKeys = Object.keys(properties).filter(key => key.startsWith('serialPortTerminal.testMode.'));
if (testModeKeys.length > 0) {
  problems.push(`serialPortTerminal.testMode.* settings must not be shipped (console-managed, restart resets): ${testModeKeys.join(', ')}`);
}

if (!properties['serialPortTerminal.virtualConsole']) {
  problems.push('missing setting serialPortTerminal.virtualConsole (Virtual Device Console switch)');
}

// 清单 %key% 引用必须能解析到 package.nls.json（缺失时 vsce 产出悬空占位）。
const nlsMisses = [];
const scan = value => {
  for (const match of String(value).matchAll(/%([^%]+)%/g)) {
    if (!(match[1] in nls)) {
      nlsMisses.push(match[1]);
    }
  }
};
scan(JSON.stringify(manifest.contributes ?? {}));
if (nlsMisses.length > 0) {
  problems.push(`manifest references nls keys missing from package.nls.json: ${[...new Set(nlsMisses)].join(', ')}`);
}

if (problems.length > 0) {
  console.error('[verify-release-manifest] package.json does not carry the VDC release surface:');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}
console.log('[verify-release-manifest] release manifest carries VDC (guarded console view, no testMode settings)');
