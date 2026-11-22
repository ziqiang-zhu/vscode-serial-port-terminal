// 数据处理类共享常量（单一事实源，纯值无依赖）。
// 收录标准：仅"多模块共用同一可调值"的常量进入本文件；单模块自用的常量
// 留在各自模块内（内聚优先）。

// PENDING_LIMIT：行缓冲半行保护上限——「永不换行的流」防 pending 无界增长，
// 超限即按整段刷出（内容不丢失，仅提前断行）。AnsiStripper 与
// LineTimestampBuffer 共用（契约见 doc/ConsumerDesign/SerialPortDataParsers设计.md §4）。
export const PENDING_LIMIT = 64 * 1024;
