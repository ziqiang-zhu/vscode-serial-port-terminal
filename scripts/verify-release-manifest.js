// 发布防线：校验清单已净化（无虚拟设备控制台视图、无 testMode.* 设置项），防止
// 未净化打包发布。作为 vscode:prepublish 的第三道前置执行——npm run package 经
// scripts/package.js 净化清单后本脚本方能通过，直接 vsce package 会被拦截。
// 非零退出即中止 vsce package / publish。见 doc/编译指导.md §4.3。
'use strict';

const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const problems = [];

// configuration 兼容单对象与数组两种清单形态。
const configuration = manifest.contributes?.configuration;
const properties = Array.isArray(configuration)
  ? Object.assign({}, ...configuration.map(item => item.properties ?? {}))
  : configuration?.properties ?? {};

const views = manifest.contributes?.views?.serialPortTerminalSideBar ?? [];
if (views.some(view => view.id === 'serialPortConsole')) {
  problems.push('contributes.views still declares serialPortConsole (Virtual Device Console)');
}

const testModeKeys = Object.keys(properties).filter(key => key.startsWith('serialPortTerminal.testMode.'));
if (testModeKeys.length > 0) {
  problems.push(`contributes.configuration still declares testMode settings: ${testModeKeys.join(', ')}`);
}

if (problems.length > 0) {
  console.error('[verify-release-manifest] package.json is not sanitized for release:');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error('Package via "npm run package" (sanitizes the manifest before invoking vsce).');
  process.exit(1);
}
console.log('[verify-release-manifest] release manifest is sanitized (no test features)');
