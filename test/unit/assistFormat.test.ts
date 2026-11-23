import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyLineEnding,
  interpretEscapes,
  parseHexInput,
  isLineEnding,
} from '../../src/SerialPortConsumer/SerialPortAssist/assistFormat';

// 契约（doc/ConsumerDesign/SerialPortAssist设计.md §5.2）：
// 文本模式 = 字面转义解释（\r\n\t\\，对齐 MacroSender 先例，未知序列保留字面）
// + 行尾符追加（无/CR/LF/CRLF，默认 CR）；HEX 模式 = 十六进制串解析（大小写
// 不敏感、任意空白分隔、奇数半字节与非法字符拒绝、空输入 → 空字节、防 parseInt
// 对 "0x" 前缀的宽松解析）。纯函数（零依赖）。

describe('applyLineEnding（行尾符应用矩阵）', () => {
  it('#1 none 原样', () => {
    assert.equal(applyLineEnding('AT', 'none'), 'AT');
  });
  it('#2 cr 追加 \\r', () => {
    assert.equal(applyLineEnding('AT', 'cr'), 'AT\r');
  });
  it('#3 lf 追加 \\n', () => {
    assert.equal(applyLineEnding('AT', 'lf'), 'AT\n');
  });
  it('#4 crlf 追加 \\r\\n', () => {
    assert.equal(applyLineEnding('AT', 'crlf'), 'AT\r\n');
  });
  it('#5 空文本也追加（cr → 仅行尾）', () => {
    assert.equal(applyLineEnding('', 'cr'), '\r');
  });
  it('#6 默认值为 cr（设计 §5.2）', () => {
    assert.equal(applyLineEnding('A', 'cr'), 'A\r');
  });
});

describe('interpretEscapes（字面转义解释）', () => {
  it('#7 \\r \\n \\t 分别替换', () => {
    assert.equal(interpretEscapes('\\r'), '\r');
    assert.equal(interpretEscapes('\\n'), '\n');
    assert.equal(interpretEscapes('\\t'), '\t');
  });
  it('#8 \\\\ 替换为反斜杠', () => {
    assert.equal(interpretEscapes('a\\\\b'), 'a\\b');
  });
  it('#9 未知序列保留字面', () => {
    assert.equal(interpretEscapes('\\x41'), '\\x41');
  });
  it('#10 无转义原样', () => {
    assert.equal(interpretEscapes('plain text'), 'plain text');
  });
  it('#11 复合：ATZ\\r\\n → ATZ+CRLF', () => {
    assert.equal(interpretEscapes('ATZ\\r\\n'), 'ATZ\r\n');
  });
  it('#12 转义在普通字符后仅吃首个反斜杠（\\\\r → 反斜杠+r）', () => {
    assert.equal(interpretEscapes('\\\\r'), '\\r');
  });
});

describe('parseHexInput（HEX 模式解析）', () => {
  it('#13 空格分隔', () => {
    assert.deepEqual(parseHexInput('55 85 11 94'), { ok: true, bytes: Buffer.from([0x55, 0x85, 0x11, 0x94]) });
  });
  it('#14 大写与小写等价', () => {
    const upper = parseHexInput('AB CD');
    const lower = parseHexInput('ab cd');
    assert.ok(upper.ok && lower.ok);
    assert.deepEqual(upper.bytes, lower.bytes);
  });
  it('#15 无分隔连写', () => {
    assert.deepEqual(parseHexInput('a1b2'), { ok: true, bytes: Buffer.from([0xa1, 0xb2]) });
  });
  it('#16 任意空白（换行/制表/连续空格）作分隔', () => {
    assert.deepEqual(parseHexInput('55\n85\t11  94'), { ok: true, bytes: Buffer.from([0x55, 0x85, 0x11, 0x94]) });
  });
  it('#17 空 / 纯空白 → 空字节（调用方按 no-op 处理）', () => {
    assert.deepEqual(parseHexInput(''), { ok: true, bytes: Buffer.alloc(0) });
    assert.deepEqual(parseHexInput('   \n\t '), { ok: true, bytes: Buffer.alloc(0) });
  });
  it('#18 奇数半字节拒绝', () => {
    assert.deepEqual(parseHexInput('558'), { ok: false, reason: 'odd-length' });
  });
  it('#19 非法字符拒绝', () => {
    assert.deepEqual(parseHexInput('zz'), { ok: false, reason: 'invalid-char' });
    assert.deepEqual(parseHexInput('12 g4'), { ok: false, reason: 'invalid-char' });
  });
  it('#20 "0x" 前缀不走 parseInt 宽松解析（防静默错误）', () => {
    assert.deepEqual(parseHexInput('0x'), { ok: false, reason: 'invalid-char' });
  });
  it('#21 边界字节 ff 与 00', () => {
    assert.deepEqual(parseHexInput('ff00'), { ok: true, bytes: Buffer.from([0xff, 0x00]) });
  });
});

describe('isLineEnding（页上行参校验）', () => {
  it('#22 合法值放行、未知值拒绝（缺省 cr 兜底的依据）', () => {
    assert.equal(isLineEnding('crlf'), true);
    assert.equal(isLineEnding('none'), true);
    assert.equal(isLineEnding('CR'), false);
    assert.equal(isLineEnding(undefined), false);
    assert.equal(isLineEnding(42), false);
  });
});
