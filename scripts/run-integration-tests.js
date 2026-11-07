// 集成测试运行器（契约见 doc/Test/开发测试体系规划.md §3 P1 / §5.1）：
// 1) 探测宿主二进制：本机已安装 VS Code（resources/app/package.json 版本 ≥ engines
//    要求）优先——零下载；缺失或过低时退回 @vscode/test-electron 下载（缓存复用）。
// 2) 以测试构建编译 dist（USE_VIRTUAL_HAL=true 产物级注入）。
// 3) 编译测试（tsconfig.test.json，含 test/integration）。
// 4) runTests 启动扩展开发宿主（新开独立窗口）执行 out-test/test/integration/index.js。
// 5) 结束后恢复产品构建 dist（无论成败；中断残留由下次构建覆盖，prepublish 恒重建）。
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function readEnginesBaseline() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const match = /(\d+)\.(\d+)/.exec(String(manifest.engines?.vscode ?? '1.0.0'));
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : { major: 1, minor: 0 };
}

// 本机安装候选（安装根目录）。exe 与 app 清单可能不同层：传统布局 app 清单在
// <root>/resources/app/，新版安装器布局在 <root>/<hash>/resources/app/（根下 Code.exe
// 仅为启动器）——由 findAppManifest 统一探测。
function localCandidates() {
  if (process.platform === 'win32') {
    const roots = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code'),
      path.join('C:', 'Program Files', 'Microsoft VS Code'),
      path.join('C:', 'Program Files (x86)', 'Microsoft VS Code'),
    ].filter(Boolean);
    const dirs = [...roots];
    // 自定义安装盘等场景：PATH 上的 code（bin/code.cmd）上溯两级即安装根。
    const onPath = whereCode();
    if (onPath) {
      dirs.push(path.dirname(path.dirname(onPath)));
    }
    return dirs.map(dir => ({ exe: path.join(dir, 'Code.exe'), root: dir }));
  }
  if (process.platform === 'darwin') {
    const dir = '/Applications/Visual Studio Code.app/Contents';
    return [{ exe: path.join(dir, 'MacOS', 'Electron'), root: path.join(dir, 'Resources', 'app') }];
  }
  return [
    { exe: '/usr/share/code/code', root: '/usr/share/code' },
    { exe: '/usr/bin/code', root: '/usr/share/code' },
  ];
}

// app 清单（版本真身）：先探传统布局，再扫一层子目录兼容新版安装器的哈希目录布局。
function findAppManifest(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) {
    return undefined;
  }
  const direct = path.join(rootDir, 'resources', 'app', 'package.json');
  if (fs.existsSync(direct)) {
    return direct;
  }
  try {
    for (const name of fs.readdirSync(rootDir)) {
      const nested = path.join(rootDir, name, 'resources', 'app', 'package.json');
      if (fs.existsSync(nested)) {
        return nested;
      }
    }
  } catch {
    // 不可读视为候选缺失
  }
  return undefined;
}

// PATH 上的 code CLI（win32 返回 code.cmd 路径，其余返回 code 本身）。
function whereCode() {
  const cmd = process.platform === 'win32' ? 'where code' : 'which code';
  try {
    const output = execFileSync(cmd, { encoding: 'utf8', shell: true });
    const first = output.split(/\r?\n/).map(line => line.trim()).find(Boolean);
    return first || undefined;
  } catch {
    return undefined;
  }
}

function resolveHost() {
  const baseline = readEnginesBaseline();
  for (const candidate of localCandidates()) {
    const appPkg = findAppManifest(candidate.root);
    if (!appPkg) {
      continue;
    }
    try {
      const version = JSON.parse(fs.readFileSync(appPkg, 'utf8')).version;
      const match = /(\d+)\.(\d+)/.exec(String(version));
      if (!match) {
        continue;
      }
      const major = Number(match[1]);
      const minor = Number(match[2]);
      if (major > baseline.major || (major === baseline.major && minor >= baseline.minor)) {
        console.log(`[integration] host: local VS Code ${version} (${candidate.exe})`);
        return { vscodeExecutablePath: candidate.exe };
      }
      console.log(`[integration] local VS Code ${version} is below engines ^${baseline.major}.${baseline.minor}; falling back to download`);
    } catch {
      // 清单不可读视为候选缺失
    }
  }
  console.log('[integration] host: no usable local VS Code; @vscode/test-electron will download (cached afterwards)');
  return {};
}

function buildDist(virtualHal) {
  const env = { ...process.env };
  if (virtualHal) {
    env.USE_VIRTUAL_HAL = 'true';
  } else {
    delete env.USE_VIRTUAL_HAL;
  }
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build.js')], { stdio: 'inherit', env });
}

function compileTests() {
  // .cmd 须经 shell 调用（Node 20+ 对无 shell 的 .cmd 直接 execFileSync 抛 EINVAL）；
  // shell 模式下参数自行拼串，含空格的路径必须显式加引号。
  const tscBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  const config = path.join(root, 'tsconfig.test.json');
  if (process.platform === 'win32') {
    execFileSync(`"${tscBin}" -p "${config}"`, { stdio: 'inherit', shell: true });
  } else {
    execFileSync(tscBin, ['-p', config], { stdio: 'inherit' });
  }
}

async function main() {
  let exitCode = 0;
  try {
    const host = resolveHost();
    buildDist(true);
    compileTests();
    const { runTests } = require('@vscode/test-electron');
    await runTests({
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(root, 'out-test', 'test', 'integration', 'index.js'),
      launchArgs: ['--disable-extensions', '--disable-workspace-trust'],
      ...host,
    });
    console.log('[integration] all tests passed');
  } catch (err) {
    console.error('[integration] FAILED:', err && err.message ? err.message : err);
    exitCode = 1;
  } finally {
    try {
      buildDist(false);
    } catch (err) {
      console.error('[integration] product rebuild failed:', err && err.message ? err.message : err);
      exitCode = exitCode || 1;
    }
  }
  process.exit(exitCode);
}

void main();
