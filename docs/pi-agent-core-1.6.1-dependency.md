# `@earendil-works/pi-agent-core` 1.6.1 — 依赖核实与许可证清单（item 61 批次 3/5）

> 2026-11-27，P2 PiEngine 交付批。本文件是 spec 默认决定 1 的落点：「package.json
> 精确版本（非 `^`），锁文件入库存许可证与依赖清单」。逐包清单见
> `pi-agent-core-deps-raw.json`（机器生成自安装树）。

## 1. 包名核实（spec 原文的名称不精确处，留档）

spec/任务书把上游包写作 `pi-agent-core`，方案 v1（`2026-11-27-agent-runtime-plan-v1.md`
:159/:189）已明确写全名 **`@earendil-works/pi-agent-core`**（仓库
`github.com/earendil-works/pi`，`packages/agent`）。npm 上两个名字的事实：

| npm 名 | 现状 | 结论 |
|---|---|---|
| `pi-agent-core`（无 scope） | 仅 `0.0.1`（2026-04-07 发布），README 自述 **"Placeholder package name reservation for pi-agent-core."**，maintainer Armin Ronacher，486 字节 3 文件 | 占位包，不是本项目要的 Pi |
| `@earendil-works/pi-agent-core` | `latest=1.6.1`（2026-11-25 发布），author Mario Zechner，repo `git+https://github.com/earendil-works/pi.git`（directory `packages/agent`） | 上游本体，本批锁定的包 |

`npm view @earendil-works/pi-agent-core@1.6.1` 输出的三项标记与 spec 所记「上游 main
标 **1.6.1、MIT、Node ≥ 22.19.0**」逐字相符（version 1.6.1 / license MIT / engines
`node: ">=22.19.0"`）。sc-lead 2026-11-27 已裁定按此包名继续（回执 msg_6a58c7f251d0）。

同版本家族（同一仓库 monorepo、同一 1.6.1）：`@earendil-works/pi-ai`（运行时被
pi-agent-core import；`pi-fake-model.ts` 也直接 import 其
`createAssistantMessageEventStream` 工厂）、`@earendil-works/pi-schema`、
`@earendil-works/pi-telemetry`。**package.json 只声明 pi-agent-core 一个直接依赖**；
pi-ai 是它 package.json 里声明的生产依赖（经 npm 扁平化提升到顶层 node_modules，已
实测可解析），直接 import 属于使用其声明的依赖面，未新增任何直接依赖条目。

## 2. Node 兼容性核对（spec 风险段要求的实测）

| 项 | 值 | 来源 |
|---|---|---|
| 上游要求 | Node ≥ **22.19.0** | `engines` 字段（npm view 实测） |
| 本仓库 Electron | **45.2.1** | package.json devDependencies + 安装实测 |
| Electron 45.2.1 内置 Node | **24.22.1**（release 元数据 node=24.22.1 / chrome=156.0.8078.75 / v8=15.6.75.25） | releases.electronjs.org |
| 打包产物运行时实测 | `process.versions.node = 24.22.1`、`process.versions.electron = 45.2.1` | 打包产物自测 JSON（`dist/pi-selftest-result.json`，见交付报告） |

24.22.1 ≥ 22.19.0，**无需升级 Electron 本体**（spec：「不为此升级整个产品」）。

## 3. ESM-only 与接入形态

上游 `package.json` `"type": "module"`，`exports` 只有 `import` 条件（无
`default`/`require`）。实测：

- CJS `require('@earendil-works/pi-agent-core')` → `ERR_PACKAGE_PATH_NOT_EXPORTED`
  （Node 24.18 开发机与 Electron 24.22.1 相同）；
- 动态 `await import(...)` 在两种运行时都加载成功。

因此 PiEngine（`src/main/runtime/engine-pi/pi-engine.ts`）对 Pi 包只有 `import type`
（编译期擦除）与 `loadPiAgentCore()` 里唯一的动态 `import()`。electron-vite 打包后
CJS 产物里该动态 import **保留为原生 `import()`**（out/main 的 chunk 里逐字
`await import("@earendil-works/pi-agent-core")`；rollup `dynamicImportInCjs` 默认
true，未降级为 require）——打包产物实跑通过（验收 11 自测 JSON）。

## 4. 许可证与依赖清单（安装树实测）

- 直接依赖：`@earendil-works/pi-agent-core@1.6.1`（package.json 精确版本，非 `^`）。
- 传递闭包（扁平化后唯一 name@version）：**86 个包**，许可证分布：
  MIT=38、Apache-2.0=35、BSD-3-Clause=11、Unlicense=1、0BSD=1。**全部为宽松许可，
  无 copyleft（无 GPL/AGPL）**；逐包清单见同目录 `pi-agent-core-deps-raw.json`。
- 直接链（pi-agent-core 的 package.json dependencies）：`@earendil-works/pi-ai@1.6.1`、
  `@earendil-works/pi-schema@1.6.1`；pi-ai 再带 provider SDK（`@anthropic-ai/sdk` 0.129.0
  MIT、`@aws-sdk/client-bedrock-runtime` 3.1127.0 Apache-2.0、`@google/genai` 3.6.1
  Apache-2.0、`openai` 7.59.0 Apache-2.0 等）。
- 分发义务（MIT/Apache/BSD 通用）：随发行包保留各包的版权与许可声明。本仓库打包产物
  electron-builder 默认打进 node_modules（各包 LICENSE 随包分发），满足义务；如后续
  需要 THIRD-PARTY-NOTICES 汇总文件，由 sc-release 在正式发行批生成。

## 5. 可测性（假模型注入）

上游 `Agent` 构造参数 `streamFn`（`AgentOptions.streamFn`，`StreamFn` 类型）是模型
传输层的一等注入槽位；不需要 fork、不需要 provider catalog 即可用脚本化假模型驱动
真实上游循环。落点：`src/main/runtime/engine-pi/pi-fake-model.ts`
（`scriptedPiModel`），单测（`tests/main/runtime/pi-engine.test.ts`）与打包自测
（`src/main/runtime/pi-selftest.ts`）共用。
