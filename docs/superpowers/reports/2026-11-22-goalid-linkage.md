# 任务与目标的稳定关联（§7 第 1 条 goalId）

日期：2026-11-22
分支：`xiaolai/iter29-goalid`
规范：`docs/superpowers/specs/2026-11-15-personal-assistant-core-redesign.md` §7
审计：`docs/superpowers/reports/2026-11-21-second-iteration-plan.md` §1.4 第 1 条、§3「暂不做」中的「goalId 数据模型与历史迁移」

## 做了什么

规范 §7 要求「每个任务关联 goalId、planId、planItemId」。`planId / planWeekId / planItemId` 已在 iter 内实现；本切片只补上 **goalId**：任务能指向一个**稳定的目标标识**，从长期计划条目派生出的任务会自动带上它。

### 数据形状

现有目标只有两处表示：`Workspace.goal`（自由文本）和 `LongPlan.workspaceId`。为了让稳定引用不依赖会漂移的显示文本，同时不新增第二套目标实体：

- `Workspace.goalId?: string`（`src/shared/workspace.ts:44`）——项目首次拥有目标文本时铸造一次的稳定句柄，形如 `g-xxxxxxxx`。它**不替代** `goal` 文本，只是任务的指向目标。
- `WorkspaceTask.goalId?: string`（`src/shared/workspace.ts:131`）——这条任务服务的目标。缺失即「没有记录目标」，读取时绝不臆造。
- `CreateTaskInput.goalId?: string`（`src/shared/workspace.ts:287`）——调用方可显式传；不传时由服务从计划推导。

没有引入独立的 Goal 实体（create/rename/delete 页面、历史任务迁移），原因见「取舍」。`goalId` 只出现一处来源：项目文件 `workspace.md` 的 frontmatter，任务文件通过同一个 id 指向它，不复制文本。

### 改动位置（file:line）

- 契约：`src/shared/workspace.ts:38-46`（`Workspace.goalId`）、`:127-131`（`WorkspaceTask.goalId`）、`:281-287`（`CreateTaskInput.goalId`）。
- 项目读写：`src/main/workspace/records/workspace.ts:42`（读）、`:66`（写）。
- 任务读写：`src/main/workspace/records/tasks.ts:25-29`（记录字段）、`:65`（读）、`:118`（转 `WorkspaceTask`）。
- 铸造与推导：`src/main/workspace/create-workspace-service.ts:306-315`（创建项目时铸造）、`:390-397`（更新时补铸、改名/改文案保持不变）、`:470-497`（`createTask` 在串行写内解析目标；旧项目文件此时补铸）、`:640-643`（重复任务继承 goalId，但丢弃 plan 关联）。
- IPC 校验：`src/main/ipc.ts:385-387`（`goalId` 必须是非空字符串）。
- 渲染调用点：`src/renderer/shell/Workspace.tsx:1406-1412`（加入今日安排时显式带上 `workspace.goalId`）。
- 用户可见：`src/renderer/shell/ProjectSections.tsx:653-662`（项目页任务行显示「目标：…」小标签）。
- 原型 mock：`web/mock-api.ts:548-560`（`goalIdFor`）、`:598`（onboarding 创建）、`:942`（`createWorkspace`）、`:2085-2089`（`updateWorkspace` 补铸）、`:2163`（`createTask` 写入）。

### 推导规则（单一事实源）

1. 显式 `goalId` 优先。
2. 否则，只有**计划派生**任务（同时有 `planId` 与 `planItemId`）才继承其计划的 `workspaceId` 所对应项目的 `goalId`。计划文件是它属于哪个项目的权威。
3. 普通任务即使所在项目有目标，也不带 `goalId`——没有来源就不连。
4. 旧项目文件没有 `goalId` 时，在**第一次需要它的写操作**里铸造一次并写回 `workspace.md`；这发生在 `runExclusively` 串行区内，并发加任务不会铸出两个不同目标。

## 旧数据

- 读取：缺 `goalId` 的任务/项目文件照常解析，字段缺省即「没有目标」；`coerceTask` 与 `toWorkspaceTask` 都用 `...(x ? { goalId } : {})` 展开，不会写入空值。
- 不重写：读路径不触碰文件。`tests/main/goal-linkage.test.ts` 的「a legacy task file without goalId loads and round-trips unchanged」把一份**没有 goalId 的旧任务文件**放进 vault，断言（a）读出的任务没有 `goalId` 属性、（b）磁盘文件字节不变、（c）解析后再序列化仍是原字节。
- 迁移：不做全量历史重写。旧任务保持「无目标」，直到它下次被显式写入目标；旧项目在其第一个计划派生任务到来时才补一个句柄。这与「缺失=没有目标，读取时绝不改写」一致。

## 取舍

- **只做稳定关联，不做目标实体。** 独立的 Goal（带 create/rename/delete UI、把每条历史任务迁移到一个目标 id）需要把握手语义、合并/拆分和迁移一次讲清，规模远超一个 agent-day，也会与现有 `Workspace.goal` 形成第二事实源。这里用「项目上的稳定句柄 + 任务指向它」满足「稳定引用、不随显示文本漂移」的硬要求，代价是：一个项目目前只有一个目标句柄，多个并列目标需要未来引入 Goal 实体时再扩。
- **在 createTask 内补铸，而非在 context 层读计划。** 早期写法在 `src/main/context.ts` 里先查计划再传 `goalId`，但那会在 `runExclusively` 之外读项目、无法原子补铸，且把「计划→项目」的推导摊到两个模块。最终收敛到 workspace service 的单条任务写路径：一个地方负责推导与补铸，调用方（渲染层）只是锦上添花地带上已知句柄。
- **重复任务（repeat）保留 goalId、丢弃 plan 关联。** 计划关联若被复制，后续一次勾选会回写原计划日；目标关联没有这个副作用，且重复的事仍服务同一目标，故保留。

## 测试证据

新增：

```
npx vitest run tests/main/goal-linkage.test.ts tests/renderer/goal-linkage.test.tsx tests/renderer/goal-chip.test.tsx
 Test Files  3 passed (3)
      Tests  11 passed (11)
```

覆盖：
- `tests/main/goal-linkage.test.ts`
  - 旧任务文件无 `goalId`：能读、无该属性、文件字节不变、解析→序列化字节一致。
  - 旧项目文件无 `goalId`：读到时没有，下一次写入后铸出 `g-…`，目标文本不变。
  - 改名 + 改目标文案后 `goalId` 不变。
  - 计划派生任务带上计划所属项目的 `goalId`，且持久化。
  - 普通任务（无计划）即使项目有目标也不带 `goalId`。
  - 旧项目在第一个计划任务时补铸句柄；普通任务永不补铸。
  - 同一计划条目重复加入返回同一条任务、同一 `goalId`，快照中只有 1 条。
- `tests/renderer/goal-linkage.test.tsx`：UI 路径——新建长期计划→加入今日安排，计划派生任务都指向项目目标；切到「今日安排」仍正常渲染该任务。
- `tests/renderer/goal-chip.test.tsx`：项目页给本项目的目标任务显示「任务目标：…」标签；无目标或指向别的目标的任务不显示。

回归（完整套件）：

```
npm run typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
（退出码 0）

npx vitest run
 Test Files  192 passed (192)
      Tests  1893 passed | 2 skipped (1895)

npm run build
✓ built in 216ms
```

## 刻意未做

- 独立 Goal 实体的 CRUD UI 与历史任务全量迁移（见「取舍」）。
- 今日页/时间表未按目标分组；`goalId` 目前唯一用户可见处是项目页任务行的目标标签。今日、长期计划、安排页对带/不带目标的任务渲染不变（已由回归套件证明）。
- 未动 `package.json`、`package-lock.json`、`CHANGELOG.md`。
