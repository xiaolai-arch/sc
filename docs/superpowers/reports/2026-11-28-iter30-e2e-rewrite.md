# iter30 问责用例按新语义改写（M2 + M1），四条 e2e 在当前 master 实跑通过

- 分支：`xiaolai/iter30-e2e-accountability`（原 HEAD `d8f4195` 已 rebase 到 master `ebfd0fd`，rebase 无冲突；本次改写为其上的一个新提交）
- 日期：2026-11-28
- 执行：sc-qa（QA，只动 tests/ 与 e2e/；产品代码零改动）
- 任务来源：sc-lead handoff「改写 iter30-e2e-accountability：M2 用例是新语义的反面，合进来会红」

---

## 1. 改写了哪些、为什么

### 1.1 `tests/main/iter30-m2-check-in-scope.test.ts`（任务书点名的两条 + 补一条守卫）

**语义依据**：主人 2026-11-22 裁定「**承诺跟人走，不跟项目走**」；iter39 据此落地
（报告 `docs/superpowers/reports/2026-11-22-iter39-m1m2.md` §3/§4）。

| 原用例（d8f4195） | 问题 | 改写后 |
| --- | --- | --- |
| `晨检跳过关闭项目里的承诺，问下一条不属于它的承诺`，断言 `not.toContain('关掉项目里的承诺')` | 与新行为相反：`readDueCommitment`（`context.ts:682-690`）的 off 过滤已被 iter39 删除，晨检**照样问**关闭项目里的承诺。实跑证实消息就是「你说今天要做「关掉项目里的承诺」，做了吗？」 | 改为正向断言 `toContain('关掉项目里的承诺')`；保留「一次只问最早一条」的断言（`not.toContain('没有归属的承诺')`） |
| `test.fails`「周复盘不应点名已关闭项目里的承诺」 | 方向相反。注意：**「意外通过而变红」的机理与任务书描述不同**（见 §2 更正）——`workspaceId` 映射修复并没有改变点名行为（无消费方），是语义本身变了：点名=如实说出本周兑现的承诺 | 改为普通 `test`，正向断言点名（`toContain('关掉项目里已经做完的承诺')` + 完整 accountability 句含「你告诉过 小林 的时间是 2026-11-21」） |
| —（无） | 新增一条守卫 | `旧语义守卫：无归属的承诺到期时晨检照问` —— 证明 off 过滤的删除没有顺带改变无项目承诺的行为 |

文件头注释写明语义依据（裁定 + iter39 落点 file:line），不是只改断言。

### 1.2 `tests/main/iter30-m1-fake-dates.test.ts`（任务书未点名，但门禁③被它挡红，一并改写）

iter39 M1 已修（`isCommitmentDate` 委托 `isLocalDate`，`isIsoDate` 同），原文件两个
`test.fails` 会「意外通过」而亮红——这正是它们当初设计的提醒机制在起作用。

| 原用例 | 改写后 |
| --- | --- |
| `test.fails` M1-a（2026-02-30 不应放行） | 普通 `test`：断言 `isCommitmentDate('2026-02-30')/('2026-11-31') === false`，且闰日 `2024-02-29` 仍放行（不是一刀切拒绝） |
| `test.fails` M1-b（承诺入口原样保存假日期） | 普通 `test`：`create({due:'2026-02-30'})` 现在 `rejects.toThrow('承诺日期必须是 YYYY-MM-DD')` 且不写盘（`list()` 为空），合法日期照常写入 |

对照组用例保留。文件头注释写明处置变更与依据（iter39 报告 §1）。

---

## 2. 对任务书第 2 点的一处更正（核实代码 + 实跑）

任务书说：「iter39 已在 context.ts 的 resolvedCommitments 映射里带上 workspaceId（:651-657），该缺陷已修——现在这条会『意外通过』而变红。」

**机理不是这样**：`workspaceId` 带进投影后**没有任何消费方**——`accountabilityLine`
（`weekly-honest.ts:156-181`）只用 `text/due/status/resolvedAt`，iter39 报告 §4
自己也写明「有没有消费方：没有」。我在 rebase 后的 master 上实跑原 `test.fails`：
结果仍是 **1 expected fail**（正文 `not.toContain` 失败 = 点名仍在发生），**不会**变红。

但任务书的**处置结论是对的**：新语义下点名是正确行为（承诺跟人走），
`test.fails` 应当翻成普通 `test` 断言应当点名。已照做，改写后绿。
「该缺陷已修」的准确说法是：**该行为在新语义下不再是缺陷**。

---

## 3. 另外四个 e2e 文件在当前 master（ebfd0fd）实跑结果

`npm run build` 后 `npx playwright test --config e2e/playwright.config.ts`（四文件定向跑）：

```
Running 8 tests using 1 worker
  ok 1 e2e\iter30-mute-and-settings.spec.ts:53   › 提醒页静音 3 天：文案、日期、重启保持、恢复 (2.7s)
  ok 2 e2e\iter30-mute-and-settings.spec.ts:109  › 今天别再提醒我 → 今天已静音，明天恢复 (2.8s)
  ok 3 e2e\iter30-mute-and-settings.spec.ts:124  › 问责对象：保存进 state.json，重启仍在，且从不写进 vault (1.7s)
  ok 4 e2e\iter30-mute-and-settings.spec.ts:174  › 问责对象清空：清掉后 state.json 也不再有名字 (1.8s)
  ok 5 e2e\iter30-packed-week.spec.ts:107        › 用户说满的那天：计划来源是 week、只给 10 分钟；自己报的时间仍以 input 为准 (1.5s)
  ok 6 e2e\iter30-promise-revisit.spec.ts:104    › 昨天的承诺出现在今天晨检的追问里 (1.5s)
  ok 7 e2e\iter30-today-focus.spec.ts:122        › 开关、折叠、展开、刷新保留、做完后的诚实文案 (2.8s)
  ok 8 e2e\iter30-today-focus.spec.ts:199        › 点「我卡住了」把原话发进日常对话并得到回复 (1.8s)
  8 passed (17.5s)
```

**8/8 全绿**，无红。iter30-promise-revisit 的日期是相对当天种的（qa-date-rot-59
修过的那份），在 11-28 实跑无 date-rot 问题。

---

## 4. 第 3 点（新语义视角的文案排查）：发现 1 处

**缺陷：承诺上的「不会主动问你」徽标与新语义相反**（产品代码，报给 sc-lead 分派，未动）

- 位置：`src/renderer/shell/ProjectSections.tsx:1714-1716`（收 checkIn=off 项目集合）→
  `:1816`（`off` 判定）→ `:1827-1831`（徽标渲染）：
  关闭检查项目里的承诺显示灰色徽标 **「不会主动问你」**。
- 矛盾：新语义下晨检**照样问**这条承诺（`readDueCommitment` 已无 off 过滤）。
  徽标现在在对用户撒谎——用户看到「不会主动问你」，第二天晨检却问了。
- 锁着这个旧行为的测试：`tests/renderer/reminders-commitments.test.tsx:160`
  `a promise of a check-in-off project is tagged 不会主动问你`——徽标改口径时它要一起改。
- 修复建议（供分派参考）：要么删徽标，要么改成中性表述（如「晨检也会问」不合适，
  更贴切是删掉或换成项目名标签）；`CommitmentsSection` 里 `checkInOff` 集合若再无
  其他用途可一并清掉。

**排查过、没问题的**：
- 设置页/项目页「参与检查」选择器（`ProjectsPage.tsx:444`「参与检查」每天/关闭）——中性，未暗示承诺行为；
- `ProjectSections.tsx:2329`「仅暂停主动检查，不影响你设的提醒。」——这是静音（snooze）文案，与项目 checkIn=off 无关；
- 全库搜索「不会主动问/不再问/就不问/不问」仅命中上述一处。

---

## 5. 五门禁实跑输出（分支 HEAD 见 §6）

```
=== 门禁1 typecheck ===
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
（无输出，退出码 0）

=== 门禁2 typecheck:e2e ===
> tsc --noEmit -p e2e/tsconfig.json
（无输出，退出码 0）

=== 门禁3 vitest run --maxWorkers=2 ===
 Test Files  219 passed | 1 skipped (220)
      Tests  2398 passed | 3 skipped (2401)
 Duration  136.16s

=== 门禁4 build ===
✓ built in 251ms

=== 门禁5 test:e2e（build + 全量 playwright）===
  34 passed (1.2m)
```

改写前基线（仅证明红因）：门禁③在改写前为 `1 failed | 2396 passed`，失败即
`iter30-m1-fake-dates.test.ts` 的 M1-a `test.fails` 意外通过；M2 文件定向跑为
`1 failed | 1 expected fail`（晨检正向断言红、周复盘 `test.fails` 仍按预期失败）。

---

## 6. 分支状态

```
ba9562c (HEAD -> xiaolai/iter30-e2e-accountability) test(qa): iter30 问责功能 e2e 覆盖 + M1/M2 回归用例   ← 原 d8f4195 rebase 后
<new>   test(qa): iter30 M2/M1 用例按新语义改写（承诺跟人走）
ebfd0fd (master) chore(release): cut 1.3.0
```

产品代码零改动（`git diff master..HEAD --stat` 仅 6 个测试文件）。未推 origin。
合并归 sc-lead。
