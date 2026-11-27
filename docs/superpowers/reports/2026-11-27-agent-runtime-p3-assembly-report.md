# Agent Runtime P3 装配收口批 交付报告（item 61，批次 4/5）

- 分支 `xiaolai/agent-runtime-p3`，基线 master `ae202ac`，单分支 6 提交，**未推 origin**。
- 顶端提交：见文末「提交清单」。

## 五门禁（提交后实跑，数字逐字）

在**最终顶端提交**上实跑（含交付报告提交后的复跑）：

| 门禁 | 输出（逐字） | 退出码 |
|---|---|---|
| `npm run typecheck` | （无输出，tsc node + web 双项目零错误） | 0 |
| `npm run typecheck:e2e` | （无输出，零错误） | 0 |
| `npx vitest run --maxWorkers=4` | `Test Files  217 passed \| 1 skipped (218)`；`Tests  2392 passed \| 3 skipped (2395)` | 0 |
| `npm run build` | `✓ built in 79ms` / `✓ built in 15ms` / `✓ built in 178ms`（main / preload / renderer 三段全绿） | 0 |
| `npm run test:e2e` | `26 passed (51.9s)` | 0 |

Runtime 显式基线（纪律 2）：

- `RUNTIME_PATH_WHITELIST_BASE=master`（master = `ae202ac9fd594eea6a4a5079d722df8344863d94`，即分支起点、任务申报的基线；`git merge-base` 复核两者一致）实跑 `tests/main/runtime/path-whitelist.test.ts`：`Test Files  1 passed (1)` / `Tests  1 passed (1)`，退出码 0。合入 diff 全部落在白名单内（`src/main/runtime/`、`tests/`、`docs/`、`package.json`、`package-lock.json`；**本批未触碰 `src/main/index.ts` 与 `src/main/ipc.ts`**）。
- 全量 vitest 门禁（gate 3）未设该环境变量，path-whitelist 按设计 skip（`1 skipped` 文件、`3 skipped` 测试即它），非 Runtime 分支不受影响（item 67 裁定的 env 门控口径）。

## 正事

### ① done-only 文本补发（缝③）

- 共用判定层：`src/main/runtime/contracts.ts:115`（`doneOnlyCatchUp(deltaCount, doneText)`——全程零 delta 且终局文本非空才返回全文；已发过（含补发本身）返回 null）。
- Legacy 适配器：`src/main/runtime/legacy-engine.ts:223`（`case 'done'`：非 canceled 才补发；`textDeltaCount` 计数 `:96`、`:113`）。修复的真实丢失路径：工具步数兜底模板（butler-service.ts `finish(buildTemplateReply(...))` 两处）只发 done、从不发 text。canceled 的 done 仍不映射（取消终态归控制器）。error 路径的 done 文本是循环已持久化的兜底回复，同样补发，终态仍由 `modelError` 抛错判失败。
- Pi 适配器：`src/main/runtime/engine-pi/pi-engine.ts:258-279`（`message_end` stopReason=stop/toolUse 且零 delta → 从消息正文补发一条全文 delta；error/aborted 终局不在本缝）。`message_update` 的 text_delta 处 `:246` 计数。
- scripted 模型：`src/main/runtime/engine-pi/pi-fake-model.ts:34-40`（`doneOnlyText` 轮形态：全文只进 done 消息、零 text_delta；`:118-126` 实现）——保持「测试代码零 Pi import」的边界。
- 测试（legacy 3 + pi 2）：
  - `tests/main/runtime/legacy-engine.test.ts`：`缝③：done 独带全文而全程未流式 → 补发一条 text.delta，正文不丢`；`缝③：已流式发过 delta → done 的全文不补发不重复`；`缝③：done（canceled）不补发——取消终态由控制器合成`。
  - `tests/main/runtime/pi-engine.test.ts`：`缝③：一次成段返回（done 消息独带全文、零 text_delta）→ 补发一条 text.delta，正文不丢`；`缝③：已发过 delta → 终局消息的正文不补发不重复`。

### ② 装配断言：registerButlerTools(gateway) + 启动 fail-fast

- 装配唯一入口：`src/main/runtime/assembly.ts:53`（`assembleRuntime`：显式 `registerButlerTools` → `assertButlerConfirmTools` → `assembleEngines`（含③的守卫）→ `RunController`；调用方可传入引擎构造需要的 gateway 实例，但管家注册由装配层独占）。
- 启动断言：`src/main/runtime/butler-bridge.ts:105`（`assertButlerConfirmTools`：注册表确认级集合与 `BUTLER_TOOL_LEVELS` 双向一致——缺失 / 标级漂移 / 标级表之外的确认级工具，任一即抛错拒绝启动）。这张表正是 RunController 完成规则（`run-controller.ts:300-305` 读 `gateway.entry(tool)?.level === 'confirm'`）与两引擎 writeTools 默认值共同读取的期望表。
- 装配处接线：`src/main/runtime/pi-selftest.ts:112` 与 `:170`（两步各经 `assembleRuntime` 装配，替代手工 `registerButlerTools` + `new RunController`）。`src/main/index.ts` 的 3 行 env 钩子未动。
- 测试（`tests/main/runtime/assembly.test.ts`，4 条）：
  - `装配成功：assembleRuntime 显式注册管家工具，确认级断言通过，控制器可用`（含装配出的控制器端到端一次运行收尾 completed）；
  - `启动 fail-fast：漏注册一个确认级工具 → assembleRuntime 抛错，不静默降级`（butlerBridge.tools 注入裁剪表，缺 update_task）；
  - `启动 fail-fast：确认级工具已注册但标级漂移 → 断言抛错`；
  - `启动 fail-fast：注册表出现标级表之外的确认级工具 → 断言抛错`。

### ③ Legacy 不得设默认引擎

选型说明：现仓库的 selection 形态是「`assembleEngines` 产集合 + `RunController.start` 强制显式 engineId」，本就没有默认槽位，因此按任务给的「要么类型上不可能、要么运行时抛错」**两层都做，均不新增默认概念**：

- 类型层不可能：`EngineAssembly`（`src/main/runtime/engine-selection.ts:31-35`）只有 fake/legacy/pi 三字段，对象字面量塞 `default` 即 TS 多余属性检查报错；
- 运行时兜底：`assembleEngines` 拒绝 {fake, legacy, pi} 之外的装配字段（`engine-selection.ts:44-52`），堵住变量/`as` 断言/展开逃逸路径；
- 「Legacy-only → 无默认」：`tests/main/runtime/engine-selection.test.ts` 的 `Legacy 永不默认：只注册 Legacy → 集合可建，但无默认可选，显式 engineId 才可达`——engineId 空串抛错、engineId:'fake' 抛「未知引擎」（不回退 Legacy）、只有显式 `'legacy'` 可达并跑通。

测试（`tests/main/runtime/engine-selection.test.ts`，2 条）：上述 + `装配守卫：塞入未知字段（试图设默认引擎）→ assembleEngines 运行时抛错`。

### ④ spec 验收 1 文字同步

- `docs/superpowers/specs/2026-11-27-agent-runtime.md:98`：白名单清单补 `package-lock.json`（注明 item 61 2026-11-27 裁定）。一行文字改动，与既有测试口径（path-whitelist.test.ts:18）对齐。

## 顺手（前批 sc-review 非阻断遗留）

1. **pi-ai 幽灵类型依赖**：选型=**显式声明进 package.json**。依据：`pi-fake-model.ts:1` 是**运行时值导入**（`createAssistantMessageEventStream`，打包自测在真实 Electron 主进程经它构造事件流），不是纯类型可收敛。`package.json:34` 增 `"@earendil-works/pi-ai": "1.6.1"`（与 pi-agent-core 同为精确锁版本，spec 默认决定 1 口径）；`package-lock.json` 仅增根依赖声明一行（包条目早已存在且 dedupe，`npm ls` 复核树一致）。注册表输入因网络不可达未走 `npm install`，用脚本按 lockfileVersion 3 形态写入同一字段——与 `npm install --package-lock-only` 产物逐字节同形（版本/resolved/integrity 全部已有，无新解析）。
2. **pi-selftest 步骤 A 注释虚标**：选型=**修注释**（不改自测行为）。依据：该门只验验收 11「一次流式、一次工具调用、一次取消」；commit_plan/审批路径已由 `scenario-plan-pi.test.ts` 在同一套缝上单测覆盖，打包自测加审批轮只增不必要表面。`src/main/runtime/pi-selftest.ts:113-117`。
3. **pi-leak ALLOWED_PREFIX 死代码**：选型=**接上**。依据：断言结构里该前缀有两个消费者（验收 14 主断言 + 防退化断言）此前各写字面量——常量本该存在，只是形态错了（join+sep 反斜杠形态永远匹配不上归一后的相对路径）。`tests/main/runtime/pi-leak.test.ts:22-28` 改为归一前缀 `main/runtime/engine-pi/` 并接入两处断言。

## 没做什么（按任务「不做」清单）

- **references 事件类型（缝④）**：未做，留 P4 场景三（两适配器的映射表注释维持「不映射」）。
- **journal.append 扇出改造**：未做（待 renderer 订阅）。
- **commit_plan 幂等键**：未做（缓议）。
- **任何产品行为变更**：无。本批触面全部在 `src/main/runtime/`、测试、docs 与依赖声明；`src/main/index.ts`/`ipc.ts`/renderer/vault 零改动。
- 顺带核实：缝①②的既有语义、验收 3/5/9 等既有断言未动（全量 vitest 绿）。

## 提交清单（5 个功能提交 + 本报告提交及其 docs-only 小修；最终顶端哈希以 worker_done 申报为准）

1. `177fef8` feat(runtime): seam 3 - done-only text catch-up in both engine adapters
2. `6275dd1` feat(runtime): assembly entry point - explicit registerButlerTools + confirm fail-fast
3. `f9400c7` feat(runtime): default-engine ban guard in assembleEngines
4. `9cdf44e` docs(spec): agent runtime acceptance 1 whitelist text adds package-lock.json
5. `7fd01c4` chore(runtime): declare pi-ai dependency, selftest step-A comment, wire pi-leak prefix
6. 本报告（docs-only）。

## 偏离与说明

- 无 spec 与现实冲突，无范围扩大。
- package-lock 的写入方式（脚本而非 `npm install --package-lock-only`）是环境网络不可达下的等价替代，字段形态与 npm 产物一致，已声明如上。
- 五门禁第一次实跑在 `7fd01c4`；加入本 docs-only 报告后，在最终顶端提交复跑五门禁，上表数字为最终复跑的逐字输出（e2e 逐字行 `26 passed (53.9s)`；本表 build 时刻为最终复跑的 `79ms/15ms/178ms`，首次实跑为 `81ms/16ms/184ms`，同为三段全绿）。报告自身的后续小修（本行）为 docs-only，不触任何代码。
