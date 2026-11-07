import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';

// 扩展宿主内测试引导（@vscode/test-electron 的 extensionTestsPath 契约：导出 run()）。
// 组装 mocha（bdd，与单测 describe/it 风格一致）并加载 suite/ 下全部用例文件；
// 任一用例失败经异常上抛，runTests 以非零退出呈现。
export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 15000 });
  const suiteDir = path.resolve(__dirname, 'suite');
  for (const name of fs.readdirSync(suiteDir).filter(file => file.endsWith('.test.js'))) {
    mocha.addFile(path.join(suiteDir, name));
  }
  const failures = await new Promise<number>(resolve => mocha.run(resolve));
  if (failures > 0) {
    throw new Error(`${failures} integration test(s) failed`);
  }
}
