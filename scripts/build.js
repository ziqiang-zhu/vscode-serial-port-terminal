// 原子构建：编译到 .tmp-build，成功后整体替换 dist。
// 目标（doc 约定）：tsc 失败或被中断时退出码非零，VS Code 拒绝启动调试宿主；
// dist 任何时刻只存在「上一个完整版本」或「本次完整版本」，杜绝半成品与孤儿产物。
// 编译形态由环境变量 USE_VIRTUAL_HAL 决定（默认产品构建）：为 true 时在产物级注入
// 测试开关——源码字面量恒为 false，运行期不存在切换（原理见 doc/编译指导.md §4.1）。
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tmpDir = path.join(root, '.tmp-build');
const distDir = path.join(root, 'dist');

// 编译形态：仅显式 USE_VIRTUAL_HAL=true（.vscode/tasks.json 的 compile:test-hal 任务注入）
// 才是测试构建；不带参数的一切路径（prepublish、CI、直接 npm run compile）均为产品构建。
const virtualHal = process.env.USE_VIRTUAL_HAL === 'true';
const selectionMarker = 'exports.USE_VIRTUAL_HAL = false;';

// 1. 清理上次中断可能残留的临时目录（半成品，无人加载）。
fs.rmSync(tmpDir, { recursive: true, force: true });

// 2. 编译到临时目录，透传 tsc 退出码（失败即中止，dist 不受影响）。
const tscBin = path.join('node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
try {
  execSync(`"${tscBin}" -p ./ --outDir .tmp-build`, { cwd: root, stdio: 'inherit' });
} catch (err) {
  const code = err && typeof err.status === 'number' ? err.status : 1;
  console.error(`[build] compile failed (exit ${code}), dist left unchanged`);
  process.exit(code);
}

// 3. 测试构建：产物级注入开关值（源码不变）。替换后断言恰好命中 1 处——
// tsc 发射格式变化时在此响亮失败，而非让开关静默失效（错形态产物可能带进发布包）。
if (virtualHal) {
  const target = path.join(tmpDir, 'hal', 'halSelection.js');
  const parts = fs.readFileSync(target, 'utf8').split(selectionMarker);
  if (parts.length !== 2) {
    console.error('[build] USE_VIRTUAL_HAL marker not found exactly once in halSelection.js — aborting, dist left unchanged');
    process.exit(1);
  }
  fs.writeFileSync(target, `${parts[0]}exports.USE_VIRTUAL_HAL = true;${parts[1]}`, 'utf8');
}

// 4. 写构建指纹（调试控制台首行输出，用于核对宿主加载的版本与形态）。
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
} catch {
  // 无 git 环境时回退
}
const builtAt = new Date().toISOString();
fs.writeFileSync(
  path.join(tmpDir, 'build-info.json'),
  JSON.stringify({ builtAt, commit, virtualHal }, null, 2) + '\n',
  'utf8'
);

// 5. 原子交换：删旧完整版 + rename（毫秒级窗口）。
fs.rmSync(distDir, { recursive: true, force: true });
fs.renameSync(tmpDir, distDir);
console.log(`[build] dist updated ${builtAt} @ ${commit} (virtualHal: ${virtualHal})`);
