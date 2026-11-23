// 发送侧纯函数（无 vscode 依赖——契约见 doc/ConsumerDesign/SerialPortAssist设计.md §5.2）：
// 文本模式 = 字面转义解释 + 行尾符追加 + UTF-8 编码；HEX 模式 = 十六进制串解析
//（大小写不敏感、任意空白分隔、奇数半字节与非法字符拒绝、空输入 → 空字节、
// 不加行尾符——字节原文精确语义）。

export type AssistLineEnding = 'none' | 'cr' | 'lf' | 'crlf';

export const DEFAULT_LINE_ENDING: AssistLineEnding = 'cr';

const LINE_ENDINGS: Record<AssistLineEnding, string> = {
  none: '',
  cr: '\r',
  lf: '\n',
  crlf: '\r\n'
};

export function isLineEnding(value: unknown): value is AssistLineEnding {
  return typeof value === 'string' && value in LINE_ENDINGS;
}

/** 文本模式行尾符应用：在选择的位置把对应行尾追加到文本末尾（none → 原样）。 */
export function applyLineEnding(text: string, ending: AssistLineEnding): string {
  return text + (LINE_ENDINGS[ending] ?? '');
}

/** 字面转义解释（对齐 MacroSender §4 先例）：\r → CR、\n → LF、\t → TAB、\\ → 反斜杠；其余序列不识别、按原字面保留。 */
export function interpretEscapes(text: string): string {
  return text.replace(/\\([rnt\\])/g, (_, c: string) => {
    if (c === 'r') {
      return '\r';
    }
    if (c === 'n') {
      return '\n';
    }
    if (c === 't') {
      return '\t';
    }
    return '\\';
  });
}

export type ParseHexResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: 'odd-length' | 'invalid-char' };

const HEX_PAIR = /^[0-9a-fA-F]{2}$/;

/**
 * HEX 模式解析：任意空白（含换行/制表）作分隔；逐对校验（防 parseInt 对
 * "0x" 前缀的宽松解析静默出错）；空 / 纯空白输入返回空字节（调用方按 no-op 处理）。
 */
export function parseHexInput(text: string): ParseHexResult {
  const cleaned = text.replace(/\s+/g, '');
  if (cleaned.length === 0) {
    return { ok: true, bytes: Buffer.alloc(0) };
  }
  if (cleaned.length % 2 !== 0) {
    return { ok: false, reason: 'odd-length' };
  }
  const bytes = Buffer.alloc(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) {
    const pair = cleaned.slice(i, i + 2);
    if (!HEX_PAIR.test(pair)) {
      return { ok: false, reason: 'invalid-char' };
    }
    bytes[i / 2] = Number.parseInt(pair, 16);
  }
  return { ok: true, bytes };
}
