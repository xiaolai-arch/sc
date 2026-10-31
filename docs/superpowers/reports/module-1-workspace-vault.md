# Module 1 — workspace-vault 报告

**Worker:** zcode · **Base:** `feat/personal-butler-data` @ `82e7612` · **Branch:** `xiaolai/module-1-workspace-vault`

## Commits

| Hash | Subject |
| --- | --- |
| `f6c046e` | feat: implement vault-backed workspace service |
| `2f6ac96` | test: cover workspace vault service |

## Files

```
src/main/workspace/
  create-workspace-service.ts   factory: createWorkspaceService(root): WorkspaceService（10 个契约方法全部实现）
  paths.ts                      布局常量 + 路径构造 + assertSafeSegment/assertIsoDate（拒绝 ../、绝对路径、反斜杠、非法日期）
  fs-utils.ts                   原子写（temp + rename）、安全读、目录列举、进程内写互斥
  ids.ts                        newId、slugify（保留 CJK，剔除 ./\）、uniqueFileName
  records/coerce.ts             防御性取值（string/number/array/bool/record）
  records/workspace.ts          workspace.md 编解码（type: profile）
  records/tasks.ts              tasks/YYYY-MM-DD.md 编解码（type: plan, tasks: StudyTask[]）
  records/notes.ts              notes/*.md 编解码（type: note）
  records/memory.ts             memory.md 编解码（type: log, items: []）
  records/reminders.ts          reminders.md 编解码（含 21:30 → 1290 的六十进制回转）
  records/reviews.ts            reviews/YYYY-MM-DD.md 编解码（type: log, kind: review, entries 追加）
  seed.ts                       首次启动播种（workspaces/ 不存在时才写，永不覆盖既有 vault）
  seed-data.ts                  与 renderer demoData 等价的种子内容（考研/英语/项目/生活 + 9 任务 + 9 笔记 + 5 记忆 + 3 提醒）
tests/main/workspace-service.test.ts    20 tests
tests/main/workspace-vault.test.ts      7 tests
tests/main/workspace-security.test.ts   8 tests
```

## Vault layout（实测 dump）

```
<root>/reminders.md                          # 提醒是 vault 全局的（契约 Reminder 无 workspaceId）
<root>/reviews/YYYY-MM-DD.md                 # 不带 workspaceId 的复盘
<root>/workspaces/<id>/workspace.md          # type: profile；正文 # 名称 + 目标/说明
<root>/workspaces/<id>/tasks/YYYY-MM-DD.md   # type: plan；frontmatter tasks[]，正文 `- [ ]` 清单
<root>/workspaces/<id>/notes/*.md            # type: note；frontmatter id/title/tags/summary/related，正文即笔记正文
<root>/workspaces/<id>/memory.md             # type: log；items[]，正文 `- 条目（来源：…）`
<root>/workspaces/<id>/reviews/YYYY-MM-DD.md # type: log; kind: review；entries[] 追加式（同日多次复盘不覆盖）
```

Frontmatter 是机器事实源；正文是给人看的渲染（Obsidian 可直接打开，手动新增的无 frontmatter 笔记也会出现在 snapshot 里）。所有文件通过 `src/main/vault/note.ts` 的 `parseNote`/`serializeNote` 读写；时间戳为 ISO 字符串（js-yaml 会加引号，实测精确 round-trip）。

与计划的偏差：`reminders.md` 放在 vault 根而不是 `workspaces/<id>/` 下——契约的 `getReminders()` 无 workspace 参数且 `Reminder` 无 workspaceId，全局文件是语义正确的等价布局。

## Test output

- `npx vitest run tests/main/workspace-*.test.ts` → **3 files, 35 tests passed**
- `npm run typecheck`（node + web 两个 project）→ **通过，无错误**
- `npm test`（全量）→ **16 files, 86 tests passed**（基线 51 + 本模块 35）

覆盖项对照验收标准：创建 workspace ✓、任务创建/更新 ✓、笔记创建/更新 ✓、复盘落盘（workspace 内 + 根目录、追加不覆盖）✓、记忆/提醒读取（含过滤与手写文件回读）✓、路径逃逸拒绝（`../`、反斜杠、绝对路径、含 `/` 的 id、非法日期，且断言 vault 外无写入）✓、重启（新 service 实例）读回 ✓，另加 12 并发 createTask 无丢失、无 `.tmp` 残留。

## 设计要点 / 约束遵守

- Vault 唯一事实源：每次调用都从磁盘重读，无内存缓存/索引需要失效。
- 永不删除：本模块没有任何删除路径（契约也没有删除方法）；复盘是追加式。未来加删除 API 时应移入 `.trash/`。
- 原子写：`writeFileAtomic` 先写 `<file>.<rand>.tmp` 再 `rename`；读方永远不会看到半写文件。进程内 read-modify-write 由 mutex 串行化。
- 路径安全：所有外部传入的 id/date 先过 `assertSafeSegment`/`assertIsoDate`（Unicode 字母数字起步，禁 `.` `/` `\` 空格）；`createWorkspace` 的名称只用于生成 slug id，不直接进路径。
- 无 secrets：模块不接触 API key；文件与日志只含用户内容。
- 测试离线，仅用 tmpdir + 真实 fs。

## 已知风险 / 遗留

1. **frontmatter 损坏会丢结构化数据**：用户在 Obsidian 手改坏 YAML 时 `parseNote` 回退为默认 meta——任务文件的 `tasks[]` 会读成空（正文清单仍在，人可读，但应用层丢任务）。后续可加“从正文清单抢救”或校验提示。
2. **跨进程并发**：mutex 只在进程内；两个进程同时 read-modify-write 同一文件时最后写者赢（不会产生撕裂文件，但会丢一次更新）。桌面应用单进程场景可接受。
3. **任务全库扫描**：`updateWorkspaceTask`/`updateNote` 通过扫描 `workspaces/*/tasks|notes/*.md` 定位 id；vault 长到数千文件时可加可重建索引（约束允许：索引可删除重建）。
4. **笔记重命名**：`updateNote` 改标题只更新 frontmatter，不改文件名（避免路径漂移）；文件名保留创建时 slug。UI 显示走 `title` 字段。
5. **种子只在 `workspaces/` 缺失时写入**：用户删光工作区后（目录仍在）不会重新播种——符合“不覆盖用户数据”，但要让模块 2/4 知道空 vault 是合法状态。
6. **`getMemory(未知id)` 返回 `[]` 而非报错**（文件缺失即空）；与 `getWorkspaceSnapshot` 的 not-found 行为不一致，如需统一可改成校验存在性。
