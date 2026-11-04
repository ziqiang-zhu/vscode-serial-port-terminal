// 校验 commit message 文件是否符合本 skill 的长度规则：
// 单行 <= 70 字符、整条 <= 500 字符。
// 用法：node .agents/skills/commit-message-format/scripts/check-commit-msg.js <file>
'use strict';
const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: check-commit-msg.js <commit-message-file>');
  process.exit(1);
}

const raw = fs.readFileSync(file, 'utf8');
// git 会忽略 message 末尾多余换行，校验时同样剔除
const text = raw.replace(/\r\n/g, '\n').replace(/\n+$/, '') + '\n';
const lines = text.split('\n');
let ok = true;
lines.forEach((line, i) => {
  if (line.length > 70) {
    ok = false;
    console.log(`LINE_TOO_LONG line ${i + 1} (${line.length}): ${line}`);
  }
});
if (text.length > 500) {
  ok = false;
  console.log(`TOTAL_TOO_LONG: ${text.length} > 500`);
}
console.log(`lines=${lines.length} total=${text.length} maxLine=${Math.max(...lines.map(l => l.length))}`);
console.log(ok ? 'COMMIT_MSG_VALID' : 'COMMIT_MSG_INVALID');
process.exit(ok ? 0 : 1);
