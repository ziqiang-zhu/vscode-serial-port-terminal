import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

// 日志文件路径共享助手（SerialPortTerminal 与 SerialPortDataRecorder 双消费方——
// 契约见 doc/ConsumerDesign/SerialPortAssist设计.md §6：DataRecorder 复用
// logDirectory 与 logFilenameTemplate，扩展名替换为 .dat）。
// 目录配置读取在每次构建路径时进行（设置修改无需重启）。

const DEFAULT_LOG_FILENAME_TEMPLATE = '{device}_{YYYY}{MM}{DD}_{HH}{mm}{ss}.log';
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;

export function resolveLogDirectory(): string {
  const configured = vscode.workspace.getConfiguration('serialPortTerminal').get<string>('logDirectory', '');
  if (configured) {
    return configured;
  }
  return path.join(os.homedir(), 'Documents', 'SerialPortTerminal', 'Log');
}

export function getLogFilenameTemplate(): string {
  const configured = vscode.workspace
    .getConfiguration('serialPortTerminal')
    .get<string>('logFilenameTemplate', DEFAULT_LOG_FILENAME_TEMPLATE);
  return configured && configured.trim() ? configured : DEFAULT_LOG_FILENAME_TEMPLATE;
}

/**
 * 构建日志文件名：模板占位符替换 →（可选）扩展名替换（模板最后一个 `.` 之后
 * 替换为指定扩展名，无扩展名则追加）→ 清洗非法文件名字符。
 */
export function buildLogFileName(devicePath: string, template: string, extension?: string): string {
  const device = path.basename(devicePath).replace(ILLEGAL_FILENAME_CHARS, '_');
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const replacements: Record<string, string> = {
    '{device}': device,
    '{YYYY}': String(now.getFullYear()),
    '{MM}': pad(now.getMonth() + 1),
    '{DD}': pad(now.getDate()),
    '{HH}': pad(now.getHours()),
    '{mm}': pad(now.getMinutes()),
    '{ss}': pad(now.getSeconds())
  };
  let name = template.replace(
    /\{device\}|\{YYYY\}|\{MM\}|\{DD\}|\{HH\}|\{mm\}|\{ss\}/g,
    token => replacements[token] ?? token
  );
  if (extension) {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    name = `${stem}.${extension}`;
  }
  return name.replace(ILLEGAL_FILENAME_CHARS, '_');
}

/** 构建日志完整路径（目录不存在时递归创建）。extension 提供时替换模板扩展名。 */
export function buildLogFilePath(devicePath: string, extension?: string): string {
  const directory = resolveLogDirectory();
  fs.mkdirSync(directory, { recursive: true });
  return path.join(directory, buildLogFileName(devicePath, getLogFilenameTemplate(), extension));
}
