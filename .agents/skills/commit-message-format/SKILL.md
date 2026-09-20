---
name: commit-message-format
description: 本仓库的 commit message 格式约定：类型前缀标题、英文正文、Test 结果行（Pass / Fail / N/A / 省略），以及产品版本与测试套件版本并列 trailer。凡在本仓库被要求提供 commit message、准备提交或执行提交时，一律按本格式生成——即使用户没有明确提到"格式"或"约定"。
---

# Commit Message 格式约定

本约定定义本仓库 commit message 的固定格式。语言使用英文。完整的工作流程（何时准备提交、版本 bump 时机、CHANGELOG 规则、提交需用户明确许可）见 agent-work-agreement skill，两者在提交准备阶段同时生效。

## 格式模板

```
<type>: <简短描述>

<正文：说明改动内容与理由，1–4 行，手动换行控制在约 72 字符>

Test Run: Pass

version: v<x.y.z>
unit test version: v<x.y.z>
```

空行分隔不可省略；`Test` 行的取值与省略规则见下文；正文足够表达的小改动可省略正文（标题后直接空行接 `Test` 行与 trailer）。

## 标题

- 类型前缀按改动性质从 `feat` / `fix` / `refactor` / `docs` / `test` / `chore` 中选择，多类型混合时以最主要改动为准；
- 简短描述用英文小写祈使句，不加句号。

## Test 行

`Test Run` 表示结果来自**执行测试套件**（`npm test`），不是手动验证：

| 情形 | 写法 |
|---|---|
| 执行了测试套件且全部通过 | `Test Run: Pass` |
| 执行了测试套件但未通过 | `Test Run: Fail`（禁止以此状态提交，除非用户明确接受） |
| 修改了代码，但改动有限或尚无可用测试，未执行测试套件 | `Test: N/A` |
| 纯文档、纯配置等完全无需测试的改动 | 整行省略 |

## 版本 trailer（并列两行，固定顺序）

| Trailer | 取值 |
|---|---|
| `version: v<x.y.z>` | 产品版本，取 `package.json` 的 `version` 字段并加 `v` 前缀。仅随功能发布 bump，测试与文档改动不 bump |
| `unit test version: v<x.y.z>` | 测试套件版本，取 `test/package.json` 的 `version` 字段并加 `v` 前缀；minor / patch 升级时机见 `doc/Test/开发测试体系规划.md` §5.4 |

## 示例

```
feat: add serial number to the device hover tooltip

Add the device serial number line to the device tree item tooltip
and update the English and Chinese localization bundles.

Test Run: Pass

version: v1.3.3
unit test version: v0.1.0
```
