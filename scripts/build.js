// 原子构建：编译到 .tmp-build，成功后整体替换 dist。
// 目标（doc 约定）：tsc 失败或被中断时退出码非零，VS Code 拒绝启动调试宿主；
// dist 任何时刻只存在「上一个完整版本」或「本次完整版本」，杜绝半成品与孤儿产物。
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const tmpDir = path.join(root, '.tmp-build');
const distDir = path.join(root, 'dist');

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

// 3. 写构建指纹（调试控制台首行输出，用于核对宿主加载的版本）。
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
} catch {
  // 无 git 环境时回退
}
const builtAt = new Date().toISOString();
fs.writeFileSync(
  path.join(tmpDir, 'build-info.json'),
  JSON.stringify({ builtAt, commit }, null, 2) + '\n',
  'utf8'
);

// 4. 原子交换：删旧完整版 + rename（毫秒级窗口）。
fs.rmSync(distDir, { recursive: true, force: true });
fs.renameSync(tmpDir, distDir);
console.log(`[build] dist updated ${builtAt} @ ${commit}`);
