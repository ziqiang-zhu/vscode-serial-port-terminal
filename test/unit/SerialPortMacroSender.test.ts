import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeMacros } from '../../src/SerialPortMacroSender/SerialPortMacro';

// 契约（doc/Test/开发测试体系.md §6.14 / MacroSender设计 §8 形状守卫）：
// globalState 脏数据防御——仅接受 { label, data } 均为 string 的条目，其余静默
// 过滤；非数组整体回退空列表。纯函数（零依赖），非法条目非破坏式过滤、合法条目
// 原样保留（引用与顺序不变）。

describe('sanitizeMacros（宏存储形状守卫）', () => {
  it('#1 falls back to an empty list for non-array storage', () => {
    assert.deepEqual(sanitizeMacros(undefined), []);
    assert.deepEqual(sanitizeMacros(null), []);
    assert.deepEqual(sanitizeMacros({ label: 'x', data: 'y' }), []);
    assert.deepEqual(sanitizeMacros('macros'), []);
  });

  it('#2 passes valid entries through unchanged', () => {
    const valid = [
      { label: '重启', data: 'reboot\r\n' },
      { label: 'ATZ', data: 'ATZ' },
    ];
    assert.deepEqual(sanitizeMacros(valid), valid);
  });

  it('#3 filters entries with invalid shapes', () => {
    assert.deepEqual(
      sanitizeMacros([
        null,
        'a plain string',
        42,
        { label: 'missing data' },
        { label: 42, data: 'x' },
        { label: 'data not a string', data: 7 },
        {},
      ]),
      []
    );
  });

  it('#4 keeps the valid part of a mixed list in order', () => {
    const good1 = { label: 'keep-1', data: 'a' };
    const good2 = { label: 'keep-2', data: 'b\n' };
    const mixed = [null, good1, { label: 'bad' }, good2];
    assert.deepEqual(sanitizeMacros(mixed), [good1, good2]);
  });
});
