// 发布防线：校验编译期 HAL 开关已复位为生产值（false），防止测试构建误打包发布。
// 作为 vscode:prepublish 的前置步骤执行，非零退出即中止 vsce package / publish。
'use strict';

const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'src', 'hal', 'halSelection.ts');
const source = fs.readFileSync(target, 'utf8');

if (!/USE_VIRTUAL_HAL\s*=\s*false\b/.test(source)) {
  console.error(
    '[verify-hal-selection] USE_VIRTUAL_HAL is not false — reset src/hal/halSelection.ts before packaging.'
  );
  process.exit(1);
}
console.log('[verify-hal-selection] production HAL selected (USE_VIRTUAL_HAL = false)');
