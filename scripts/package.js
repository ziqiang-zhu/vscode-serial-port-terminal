// 产品化打包：净化清单（移除虚拟设备控制台视图、testMode.* 设置及对应本地化键）后
// 调用 vsce package，打包结束（无论成败）恢复清单——git 工作区不留痕迹。prepublish
// 链中的 verify-release-manifest.js 在净化后执行，机械拦截绕过本脚本直接 vsce package
// 的打包。用法：npm run package（参数透传给 vsce，如 npm run package -- --no-yarn）。
// 原理与净化边界见 doc/编译指导.md §4.3。
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const manifestPath = path.join(root, 'package.json');
const nlsPath = path.join(root, 'package.nls.json');

const VIEW_ID = 'serialPortConsole';
const CONFIG_PREFIX = 'serialPortTerminal.testMode.';
const EXPECTED_CONFIG_COUNT = 5;
const NLS_KEYS = [
  'serialPortConsole.View.title',
  'serialPortTerminal.testMode.responseDelay.description',
  'serialPortTerminal.testMode.replayFile.description',
  'serialPortTerminal.testMode.replayRate.description',
  'serialPortTerminal.testMode.replayLoop.description',
  'serialPortTerminal.testMode.interactionDir.description',
];

// 净化清单。任何结构漂移（条目缺失）都抛错中止，而不是静默打错包。
function sanitizeManifest() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const views = manifest.contributes?.views?.serialPortTerminalSideBar;
  if (!Array.isArray(views) || !views.some(view => view.id === VIEW_ID)) {
    throw new Error(`expected a "${VIEW_ID}" view entry under contributes.views.serialPortTerminalSideBar`);
  }
  manifest.contributes.views.serialPortTerminalSideBar = views.filter(view => view.id !== VIEW_ID);
  const properties = manifest.contributes?.configuration?.properties;
  if (!properties || typeof properties !== 'object') {
    throw new Error('expected contributes.configuration.properties');
  }
  const testModeKeys = Object.keys(properties).filter(key => key.startsWith(CONFIG_PREFIX));
  if (testModeKeys.length !== EXPECTED_CONFIG_COUNT) {
    throw new Error(`expected ${EXPECTED_CONFIG_COUNT} testMode settings, found ${testModeKeys.length}`);
  }
  for (const key of testModeKeys) {
    delete properties[key];
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const nls = JSON.parse(fs.readFileSync(nlsPath, 'utf8'));
  for (const key of NLS_KEYS) {
    if (!(key in nls)) {
      throw new Error(`expected nls key "${key}" in package.nls.json`);
    }
    delete nls[key];
  }
  fs.writeFileSync(nlsPath, `${JSON.stringify(nls, null, 2)}\n`, 'utf8');
}

// 调用 vsce（此时磁盘清单已净化，prepublish 链含 verify-release-manifest 校验）。
function runVsce(args) {
  try {
    execSync(`vsce package ${args}`.trim(), { cwd: root, stdio: 'inherit' });
    return 0;
  } catch (err) {
    return err && typeof err.status === 'number' ? err.status : 1;
  }
}

const stamp = Date.now();
const backupManifest = path.join(os.tmpdir(), `spt-package-${stamp}-package.json`);
const backupNls = path.join(os.tmpdir(), `spt-package-${stamp}-package.nls.json`);
let exitCode = 0;

// 字节级备份 → 净化 → 打包 → finally 恢复（打包中途被杀同样恢复）。
fs.copyFileSync(manifestPath, backupManifest);
fs.copyFileSync(nlsPath, backupNls);
try {
  sanitizeManifest();
  exitCode = runVsce(process.argv.slice(2).join(' '));
} catch (err) {
  console.error(`[package] ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  fs.copyFileSync(backupManifest, manifestPath);
  fs.copyFileSync(backupNls, nlsPath);
  fs.rmSync(backupManifest, { force: true });
  fs.rmSync(backupNls, { force: true });
  console.log('[package] manifest restored');
}
process.exit(exitCode);
