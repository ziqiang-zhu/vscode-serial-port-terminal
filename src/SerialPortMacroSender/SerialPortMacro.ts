export interface SerialPortMacro {
  label: string;
  data: string;
}

// 形状守卫：globalState 脏数据防御——仅接受 { label, data } 均为 string 的条目，
// 其余静默过滤。非破坏式：不从存储清除未知形状（未来版本可能识别）。纯函数、
// 零依赖（本文件不 import 任何模块），可无桩直接单测。
export function sanitizeMacros(raw: unknown): SerialPortMacro[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (item): item is SerialPortMacro =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as SerialPortMacro).label === 'string' &&
      typeof (item as SerialPortMacro).data === 'string'
  );
}
