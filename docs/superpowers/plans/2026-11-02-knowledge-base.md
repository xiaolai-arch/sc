# 知识库（Knowledge Base）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 ASAKI 一套本地知识库：主题 + 证据 + 状态，自动从任务/笔记/复盘中积累，并进入长期规划与管家上下文，避免重复规划已学内容。

**Architecture:** 新增 `knowledge/` vault 模块（一个主题一个 markdown 文件，frontmatter 为事实源），通过 `KnowledgeService` 暴露 CRUD、`record()` 与 `linkTask/linkNote/linkReview`。主进程在任务/笔记/复盘的两条写入路径（IPC 与管家工具）后 best-effort 追加证据；`LongPlanService` 与 `ButlerContext` 读取活跃主题。

**Tech Stack:** Electron 45 + React 19 + TypeScript strict + Vitest + Testing Library；无新依赖。

**Spec:** `docs/superpowers/specs/2026-11-01-knowledge-base-design.md`

## Global Constraints

- 不新增依赖；不发网络请求；不接触 API key。
- Vault 文件是纯 markdown + YAML frontmatter；路径段必须过 `assertSafeSegment`，写入用 `writeFileAtomic`。
- 知识库读写失败绝不能阻断任务完成、笔记保存、复盘提交、规划生成或管家回复。
- 界面文案用中文，沿用现有 Tailwind/PageFrame 样式。
- 验证命令：`npm run typecheck`、`npm test`、`npm run typecheck:e2e`、`npm run test:e2e`。
- 除非用户明确要求，不要创建 git commit。

## Review Focus

以下是最容易出问题、且必须由某个任务的测试钉住的行为（对应任务见括号）：

1. 同一任务重复标记 done 只能产生一条证据（Task 3）。
2. 损坏的主题文件不能让列表/规划崩溃，也不能被当作空库清空（Task 2、Task 5）。
3. 连续两次 `record_knowledge` 说同一主题必须追加两条证据，不能因为去重而丢第二条（Task 3）。
4. 没有 `workspaceId` 的 vault 级复盘必须能匹配主题而不是抛错（Task 3）。
5. 按工作区筛选知识库时全局主题仍要显示，且页面能新建全局主题（Task 2、Task 7）。

---

### Task 1: 共享契约与匹配规则

**Files:**
- Create: `src/shared/knowledge.ts`
- Test: `tests/shared/knowledge.test.ts`

**Interfaces:**
- Produces: `KnowledgeStatus`, `KnowledgeEvidence`, `KnowledgeTopic`, `CreateKnowledgeTopicInput`, `UpdateKnowledgeTopicInput`, `RecordKnowledgeInput`, `KnowledgeService`, `KnowledgeApi`, `topicMatches(text: string, topic: KnowledgeTopic): boolean`, `isActiveKnowledgeTopic(topic: KnowledgeTopic): boolean`。
- `KnowledgeApi` 方法名：`listKnowledgeTopics(workspaceId?: string)`, `createKnowledgeTopic(input)`, `updateKnowledgeTopic(input)`, `deleteKnowledgeTopic(planId: string)`（参数名 `id`，返回 void）。

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/knowledge.test.ts
import { isActiveKnowledgeTopic, topicMatches, type KnowledgeTopic } from '../../src/shared/knowledge';

function topic(overrides: Partial<KnowledgeTopic> = {}): KnowledgeTopic {
  return {
    id: 'kt-1', name: 'Java', aliases: [], status: 'learning', summary: '',
    evidence: [], createdAt: '', updatedAt: '', ...overrides
  };
}

test('matches CJK substrings and Latin word boundaries', () => {
  expect(topicMatches('今天复习 Java 集合', topic())).toBe(true);
  expect(topicMatches('学 JavaScript 的闭包', topic())).toBe(false);
  expect(topicMatches('LangChain 的 AgentExecutor', topic({ name: 'LangChain', aliases: ['LC'] }))).toBe(true);
  expect(topicMatches('练了 lc 一小时', topic({ name: 'LangChain', aliases: ['LC'] }))).toBe(true);
});

test('only mastered and learning topics are active', () => {
  expect(isActiveKnowledgeTopic(topic({ status: 'mastered' }))).toBe(true);
  expect(isActiveKnowledgeTopic(topic({ status: 'learning' }))).toBe(true);
  expect(isActiveKnowledgeTopic(topic({ status: 'planned' }))).toBe(false);
  expect(isActiveKnowledgeTopic(topic({ status: 'paused' }))).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/knowledge.test.ts`
Expected: FAIL — cannot resolve `src/shared/knowledge`.

- [ ] **Step 3: Implement `src/shared/knowledge.ts`**

Types exactly as the spec's contract. Matching rules:
- 归一化：`toLowerCase()`，把连续空白折叠成单个空格。
- 中文（含 CJK 字符）名称用 `includes`。
- 纯拉丁名称/别名两侧要求非字母数字边界（正则 `(^|[^a-z0-9])name([^a-z0-9]|$)`），并给名称转义正则特殊字符。
- 逐条检查 `name` 与 `aliases`；任一命中即 true。
- `isActiveKnowledgeTopic` 只认 `mastered` 与 `learning`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/knowledge.test.ts`
Expected: PASS

---

### Task 2: Vault 记录与主题 CRUD

**Files:**
- Modify: `src/main/workspace/paths.ts`（注释 + `knowledgeDir(root)`、`knowledgeTopicFile(root, topicId)`）
- Create: `src/main/knowledge/records.ts`
- Create: `src/main/knowledge/create-knowledge-service.ts`
- Test: `tests/main/knowledge-service.test.ts`

**Interfaces:**
- Produces: `createKnowledgeService(options: { root: string; now?: () => Date }): KnowledgeService`。
- 存储路径：`<root>/knowledge/topics/<id>.md`；frontmatter `kind: knowledge-topic`，字段与 `KnowledgeTopic` 同名。
- 排序：`updatedAt` 倒序，同时间按 `name` 本地化升序。
- 作用域：`list(workspaceId)` 返回该工作区 + 全局；不传返回全部。

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/knowledge-service.test.ts
test('creates, filters, updates and deletes topics in the vault', async () => {
  const { dir, service } = await setup();
  const local = await service.create({ name: 'LangChain', workspaceId: 'agent', status: 'learning', level: 2, summary: '会调用' });
  const global = await service.create({ name: '番茄工作法', aliases: ['Pomodoro'] });

  expect((await service.list('agent')).map((t) => t.id).sort()).toEqual([local.id, global.id].sort());
  expect((await service.list('other')).map((t) => t.name)).toEqual(['番茄工作法']);
  expect((await service.get(local.id))?.level).toBe(2);

  const updated = await service.update({ id: local.id, status: 'mastered', level: null, workspaceId: null });
  expect(updated.status).toBe('mastered');
  expect(updated.level).toBeUndefined();
  expect(updated.workspaceId).toBeUndefined();
  expect((await service.list('agent')).map((t) => t.name)).toEqual(['番茄工作法']);

  await service.delete(global.id);
  expect(await service.get(global.id)).toBeNull();
});

test('ignores broken topic files and rejects invalid input', async () => {
  const { dir, service } = await setup();
  await mkdir(join(dir, 'knowledge', 'topics'), { recursive: true });
  await writeFile(join(dir, 'knowledge', 'topics', 'kt-broken.md'), 'not: [valid', 'utf8');
  expect(await service.list()).toEqual([]);
  await expect(service.create({ name: '  ' })).rejects.toThrow(/名称/);
  await expect(service.create({ name: 'X', level: 6 })).rejects.toThrow(/程度/);
  await expect(service.get('../../etc/passwd')).resolves.toBeNull();
});
```

`setup()` 用 `mkdtemp` 建临时 root，返回 `{ dir, service }`；`afterEach` 清理。第二个测试里的 `mkdir/writeFile` 从 `node:fs/promises` 导入。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/knowledge-service.test.ts`
Expected: FAIL — module not found。

- [ ] **Step 3: Implement records and CRUD**

`records.ts`：
- `parseKnowledgeTopicFile(raw, fallbackId): KnowledgeTopic | null`：`parseNote` 后要求 `meta.kind === 'knowledge-topic'`；名称非空；status 只接受四值；level 取 1–5 整数否则丢弃；aliases 去重、非空、最多 8 条；evidence 逐条校验（kind 枚举、date `YYYY-MM-DD`、title 非空），最多 50 条。
- `serializeKnowledgeTopicFile(topic): string`：frontmatter 写全部字段（无值则省略），正文渲染 `# {name}`、`summary`、`## 证据` 列表（`- {date} · {title}`）。正文不参与解析。

`create-knowledge-service.ts`：
- `create`：校验名称（trim 后非空、≤60）、status 默认 `learning`、level 1–5、aliases ≤8（每条 ≤40）、summary ≤400；`workspaceId` 若给出则 `assertSafeSegment`。id 用 `newId('kt')`。
- `update`：按 id 跨文件查找；`level: null` 删除 level，`workspaceId: null` 改为全局；其余字段按传入校验覆盖；`updatedAt = now().toISOString()`。
- `get`/`delete`：安全 id（`assertSafeSegment`），找不到返回 null / 静默。
- `list`：枚举 `knowledge/topics/*.md`，跳过解析失败；按 workspace 过滤时保留 `workspaceId === undefined`。
- 互斥：所有写操作用 `createMutex()`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/knowledge-service.test.ts`
Expected: PASS

---

### Task 3: 证据记录与自动匹配

**Files:**
- Modify: `src/main/knowledge/create-knowledge-service.ts`
- Test: `tests/main/knowledge-service.test.ts`（追加）

**Interfaces:**
- Produces: `record(input: RecordKnowledgeInput): Promise<KnowledgeTopic>`、`linkTask(task: WorkspaceTask): Promise<void>`、`linkNote(note: WorkspaceNote): Promise<void>`、`linkReview(input: { workspaceId?: string; date: string; answers: ReviewAnswers }): Promise<void>`。
- 证据规则（spec）：去重键 `kind + refId`，仅当 refId 存在；上限 50；`planned` 收到证据变 `learning`；自动证据不新建主题。
- `record()`：在作用域内按名称/别名精确匹配（归一化后相等），存在则追加 `kind: 'chat'` 证据（无 refId），不存在则新建主题（status 默认 `learning`，无 workspaceId 即全局）。

- [ ] **Step 1: Write the failing tests**

```ts
test('record creates a learning topic and appends later mentions', async () => {
  const { service } = await setup();
  const first = await service.record({ name: 'LangGraph', workspaceId: 'agent', note: '今天学了状态图' });
  expect(first.status).toBe('learning');
  expect(first.evidence.map((e) => e.kind)).toEqual(['chat']);

  const second = await service.record({ name: 'LangGraph', workspaceId: 'agent', status: 'mastered' });
  expect(second.id).toBe(first.id);
  expect(second.status).toBe('mastered');
  expect(second.evidence).toHaveLength(2);
});

test('links a completed task once and only within workspace or global scope', async () => {
  const { service } = await setup();
  const topic = await service.create({ name: 'LangChain', workspaceId: 'agent' });
  const task = { id: 't1', workspaceId: 'agent', title: 'LangChain AgentExecutor 练习', subject: 'Agent', durationMin: 30, acceptance: '', status: 'done' as const };

  await service.linkTask(task);
  await service.linkTask(task);
  const reloaded = await service.get(topic.id);
  expect(reloaded?.evidence).toHaveLength(1);
  expect(reloaded?.evidence[0]).toMatchObject({ kind: 'task', refId: 't1', date: '2026-11-02' });

  const other = await service.create({ name: 'RAG', workspaceId: 'english' });
  await service.linkTask({ ...task, title: 'RAG 检索练习', workspaceId: 'agent' });
  expect((await service.get(other.id))?.evidence).toHaveLength(0);
});

test('links notes, reviews, and vault-wide reviews', async () => {
  const { service } = await setup();
  const topic = await service.create({ name: '向量数据库', status: 'planned' });

  await service.linkNote({ id: 'n1', workspaceId: 'agent', title: '向量数据库选型', subject: '', tags: ['向量数据库'], updated: '', summary: '', body: '', related: [] });
  expect((await service.get(topic.id))?.status).toBe('learning');
  expect((await service.get(topic.id))?.evidence[0]).toMatchObject({ kind: 'note', refId: 'n1' });

  await service.linkReview({ date: '2026-11-02', answers: { completed: '复习了向量数据库', stuck: 'HNSW 参数', tomorrow: '' } });
  const evidence = (await service.get(topic.id))?.evidence ?? [];
  expect(evidence.some((e) => e.kind === 'review' && e.refId === '2026-11-02')).toBe(true);
  expect(evidence.some((e) => e.note?.includes('HNSW'))).toBe(true);
});

test('auto-linking never throws for missing topics or broken files', async () => {
  const { service } = await setup();
  await expect(service.linkTask({ id: 't1', workspaceId: 'agent', title: '无关任务', subject: '', durationMin: 10, acceptance: '', status: 'done' })).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/knowledge-service.test.ts`
Expected: FAIL — `record`/`linkTask`/`linkNote`/`linkReview` is not a function。

- [ ] **Step 3: Implement evidence logic**

- 抽出 `appendEvidence(topic, evidence)`：refId 存在时按 `kind:refId` 去重；push 后 `slice(-50)`；`planned → learning`。
- `linkTask`：标题 + 科目拼成文本；候选 = `list(task.workspaceId)`；`topicMatches` 命中的每个主题追加 `{ kind:'task', refId: task.id, title: task.title, date: 今天 }`；整个函数 try/catch 吞掉错误。
- `linkNote`：文本 = 标题 + tags；证据 `{ kind:'note', refId: note.id, title: note.title, date: 今天 }`。
- `linkReview`：completed 与 stuck 分别匹配（候选作用域同上，无 workspaceId 用全部主题）；证据 `{ kind:'review', refId: date, title: '复盘 ' + date }`；stuck 命中时把 stuck 文本放进 `note`。
- `record`：作用域内查归一化名称/别名相等；新建时 id `newId('kt')`，summary 用 `note ?? ''`，证据 title 用 `note` 或「对话记录」。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/knowledge-service.test.ts`
Expected: PASS

---

### Task 4: IPC、API 与主进程接入

**Files:**
- Modify: `src/shared/ipc.ts`（`StudyCoachApi extends ... KnowledgeApi`）
- Modify: `src/main/ipc.ts`（channel 表、校验、handler、bridge）
- Modify: `src/main/context.ts`（`knowledgeService` option/ActiveServices/AppContext/api、任务/笔记/复盘 wrapper）
- Modify: `tests/main/ipc-preload.test.ts`、`tests/main/ipc-handlers.test.ts`、`tests/main/ipc-context.test.ts`
- Test: `tests/main/ipc-knowledge.test.ts`（新建）

**Interfaces:**
- Channels: `listKnowledgeTopics: 'study-coach:knowledge:list'`、`createKnowledgeTopic: 'study-coach:knowledge:create'`、`updateKnowledgeTopic: 'study-coach:knowledge:update'`、`deleteKnowledgeTopic: 'study-coach:knowledge:delete'`。
- `createAppContext` options 新增 `knowledgeService?: KnowledgeService`（测试注入）；`AppContext`/`ActiveServices` 新增 `knowledge`。
- `buildServices` 用 `createKnowledgeService({ root: vaultPath, now })` 创建。
- 包装：`updateWorkspaceTask` 返回后若 `status === 'done'` 调 `knowledge.linkTask(task)`；`createNote`/`updateNote` 调 `linkNote`；`submitReview` 调 `linkReview`。全部 `try/catch`，失败不影响返回值。

- [ ] **Step 1: Write failing IPC tests**

```ts
// tests/main/ipc-knowledge.test.ts
test('routes knowledge channels and validates payloads', async () => {
  const { api, calls } = fakeApi(); // 复用 tests/main/ipc-memory.test.ts 的模式
  const handlers = createIpcHandlers(api);
  await handlers.listKnowledgeTopics('agent');
  await handlers.deleteKnowledgeTopic('kt-1');
  expect(calls).toEqual([['list', 'agent'], ['delete', 'kt-1']]);
  await expect(handlers.createKnowledgeTopic({ name: '  ' })).rejects.toThrow(/知识主题名称/);
  await expect(handlers.createKnowledgeTopic({ name: 'X', level: 6 })).rejects.toThrow(/掌握程度/);
  await expect(handlers.updateKnowledgeTopic({ id: '' })).rejects.toThrow(/主题 ID/);
});

// tests/main/ipc-context.test.ts 追加
test('auto-links completed tasks, notes and reviews without blocking', async () => {
  const dir = await tempDir();
  const { workspace, butler } = services();
  const linkTask = vi.fn(async () => undefined);
  const linkNote = vi.fn(async () => undefined);
  const linkReview = vi.fn(async () => undefined);
  const context = await createAppContext({
    userDataPath: dir,
    defaultVaultPath: join(dir, 'vault'),
    workspaceService: workspace,
    butlerService: butler,
    knowledgeService: { list: async () => [], get: async () => null, create: async () => { throw new Error('unused'); }, update: async () => { throw new Error('unused'); }, delete: async () => undefined, record: async () => { throw new Error('unused'); }, linkTask, linkNote, linkReview },
    secretStore: new InMemorySecretStore(),
    now: () => new Date(2026, 10, 2, 9, 0, 0)
  });
  workspace.updateWorkspaceTask = async (input) => ({ id: input.taskId, workspaceId: 'ws-1', title: 't', subject: '', durationMin: 1, acceptance: '', status: 'done' });
  await context.api.updateWorkspaceTask({ taskId: 't1', status: 'done' });
  expect(linkTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', status: 'done' }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/ipc-knowledge.test.ts tests/main/ipc-context.test.ts`
Expected: FAIL — 方法/option 不存在。

- [ ] **Step 3: Implement channels, bridge, context**

- `requireKnowledgeTopicCreate/Update`：name trim 非空 ≤60；status 枚举；level 可选 1–5 整数；aliases 可选 string[] ≤8 且每条 ≤40；workspaceId 可选非空字符串；summary 可选 ≤400；update 的 `id` 必填，`level`/`workspaceId` 允许 `null`。
- handlers 四件套 + bridge 四件套；`deleteKnowledgeTopic` 入参是 id 字符串。
- `context.ts`：新增 `createKnowledge` 工厂（支持 options 注入）、API 四方法；三个 wrapper 按上文接入。`AppContext` getter 暴露 `knowledge`。

- [ ] **Step 4: Update preload/handler index assertions**

`tests/main/ipc-preload.test.ts` 新增 4 个 bridge 调用断言，并把后续索引整体 +4；`tests/main/ipc-handlers.test.ts` 增加知识库非法参数用例。运行：
`npx vitest run tests/main/ipc-preload.test.ts tests/main/ipc-handlers.test.ts tests/main/ipc-knowledge.test.ts tests/main/ipc-context.test.ts`
Expected: PASS

---

### Task 5: 长期规划接入知识库

**Files:**
- Modify: `src/shared/plans.ts`（`LongPlanKnowledge`、`LongPlan.knowledge?`）
- Modify: `src/shared/plan-template.ts`（`LongPlanGenerationInput.knownTopics?`）
- Modify: `src/main/plans/prompt.ts`（接收 `knownTopics` + system 规则）
- Modify: `src/main/plans/generate.ts`（透传）
- Modify: `src/main/plans/long-plan-service.ts`（options 增加 `knowledgeService?`，生成前取主题并写快照）
- Modify: `src/main/plans/records.ts`（读写 `knowledge`）
- Modify: `src/renderer/shell/LongPlanPage.tsx`（显示「已参考知识库」）
- Test: `tests/main/long-plan-service.test.ts`、`tests/renderer/long-plan-page.test.tsx`

**Interfaces:**
- `LongPlanKnowledge { name: string; status: KnowledgeStatus }`；`LongPlan.knowledge?: LongPlanKnowledge[]`。
- `LongPlanServiceOptions.knowledgeService?: KnowledgeService | null`。
- 选择规则：`knowledge.list(workspaceId)` 过滤 `isActiveKnowledgeTopic`，mastered 在前，其余按 `updatedAt` 倒序，最多 20 条。
- Prompt 行：`已掌握：LangChain、RAG` / `正在学：LangGraph`（无内容省略）；system 增加一条「已掌握的主题不要从头安排，最多安排一次复习检查；在学主题从当前进度继续」。

- [ ] **Step 1: Write failing service test**

```ts
test('grounds plan generation in mastered topics and records the snapshot', async () => {
  const knowledge = createKnowledgeService({ root: dir, now: () => NOW });
  await knowledge.create({ name: 'LangChain', workspaceId, status: 'mastered' });
  const client = new FakeModelClient([modelReply(1)]);
  const { service } = await setup(client, { knowledgeService: knowledge });

  const plan = await service.create({ workspaceId, goal: '系统学习 AI Agent', weeks: 1 });
  expect(client.calls[0]?.messages[1]?.content).toContain('已掌握：LangChain');
  expect(client.calls[0]?.messages[1]?.content).toContain('不要从头安排');
  expect(plan.knowledge).toEqual([{ name: 'LangChain', status: 'mastered' }]);
  const file = await readFile(join(dir, 'workspaces', workspaceId, 'plans', `${plan.id}.md`), 'utf8');
  expect(file).toContain('knowledge:');
  expect(file).toContain('name: LangChain');
});
```

`setup()` 增加第二参数 `{ knowledgeService }` 并传给 `createLongPlanService`。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/long-plan-service.test.ts -t "grounds plan generation"`
Expected: FAIL — prompt 不含「已掌握」/`knowledge` 为 undefined。

- [ ] **Step 3: Implement plan grounding**

- `long-plan-service.create`：生成前 `const known = knowledge ? ... : []`；`generation.knownTopics = known`；plan 写 `...(known.length ? { knowledge: known.map(({name,status}) => ({name,status})) } : {})`。
- `prompt.ts`：`LongPlanPromptInput` 增加 `knownTopics?: LongPlanKnowledge[]`，按 status 分组渲染；system 规则追加。
- `generate.ts`：把 `input.knownTopics` 传给 prompt。
- `records.ts`：serialize 写 `knowledge`；parse 读回（校验 status）。
- `LongPlanPage`：`selectedPlan.knowledge?.length` 时显示一行 `已参考知识库：LangChain（已掌握）、RAG（在学）`（状态中文映射：planned 计划中 / learning 在学 / mastered 已掌握 / paused 暂停）。

- [ ] **Step 4: Add renderer test and run**

```ts
test('shows knowledge used by the plan', () => {
  renderPage({ plans: [{ ...plan, knowledge: [{ name: 'LangChain', status: 'mastered' }] }] });
  expect(screen.getByText(/已参考知识库：LangChain（已掌握）/)).toBeInTheDocument();
});
```

Run: `npx vitest run tests/main/long-plan-service.test.ts tests/renderer/long-plan-page.test.tsx`
Expected: PASS

---

### Task 6: 管家工具与上下文

**Files:**
- Modify: `src/main/butler/tools.ts`（`record_knowledge`、`ButlerToolContext.knowledge`、写后链接）
- Modify: `src/main/butler/context.ts`（`ButlerContext.knowledge`、`gatherContext` 接收 knowledge 服务）
- Modify: `src/main/butler/prompt.ts`（渲染知识库摘要）
- Modify: `src/main/butler/butler-service.ts`（options 字段、gatherContext 调用、tool context）
- Modify: `src/main/butler/create-butler-service.ts`（透传 option）
- Modify: `src/main/context.ts`（buildServices 把 knowledge 传给 butler）
- Test: `tests/main/butler-tools.test.ts`、`tests/main/butler-prompt.test.ts`

**Interfaces:**
- `RecordKnowledgeInput` 已由 Task 1 定义；工具参数：`name`（必填）、`status`、`level`、`note`、`workspaceId`。
- `ButlerContext.knowledge: KnowledgeTopic[]`，选择规则同 Task 5（mastered + learning，最多 15）。
- 工具名 `record_knowledge`，description：「记录用户已经学过或正在学的主题，供长期规划和回答参考。」
- 写后链接：`update_task` 结果 `status === 'done'` 时 `linkTask`；`write_note` 后 `linkNote`；`save_review` 后 `linkReview`（`workspaceId` 可选）。

- [ ] **Step 1: Write failing tests**

```ts
// butler-tools.test.ts
test('record_knowledge creates or appends a topic through the service', async () => {
  const record = vi.fn(async (input) => ({ id: 'kt-1', name: input.name, aliases: [], status: input.status ?? 'learning', summary: input.note ?? '', evidence: [], createdAt: '', updatedAt: '' }));
  const tools = createButlerTools();
  const result = await executeButlerTool({ id: '1', name: 'record_knowledge', arguments: { name: 'LangGraph', status: 'mastered', note: '今天学了状态图' } }, tools, { workspace, knowledge: { record, linkTask: vi.fn(), linkNote: vi.fn(), linkReview: vi.fn() }, now });
  expect(record).toHaveBeenCalledWith({ name: 'LangGraph', status: 'mastered', note: '今天学了状态图' });
  expect(result.content).toContain('已记录');
});

// butler-prompt.test.ts
test('renders mastered and learning topics from the knowledge base', () => {
  const prompt = buildSystemPrompt({ ...baseContext, knowledge: [topic({ name: 'LangChain', status: 'mastered' }), topic({ name: 'LangGraph', status: 'learning' })] });
  expect(prompt).toContain('已掌握：LangChain');
  expect(prompt).toContain('正在学：LangGraph');
});
```

复用现有测试里的 `executeButlerTool`/`baseContext` 构造方式；`knowledge` 用完整 `KnowledgeService` 的最小桩（`vi.fn()` 补齐其余方法）。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/butler-tools.test.ts tests/main/butler-prompt.test.ts`
Expected: FAIL — 工具不存在 / prompt 无知识库行。

- [ ] **Step 3: Implement tool and context**

- `tools.ts`：在 `get_memory` 之后加 `record_knowledge`；`execute` 调 `context.knowledge?.record({...})`，未连接时抛 `ToolInputError('知识库未连接。')`；返回 `{ ok: true, topic: result }`，由现有执行器渲染文本。
- 三个写工具在成功后 `await context.knowledge?.linkX(...)`，包在 try/catch。
- `gatherContext(workspaceService, input, now, knowledgeService?)`：`list(input.workspaceId)` 失败则 `[]`；过滤活跃、排序、截 15。
- `prompt.ts`：`renderContext` 追加「知识库」段：`已掌握：…`、`正在学：…`；空则不输出。
- `butler-service.ts`：`knowledgeService` 字段、`ButlerServiceOptions` 类型、构造赋值、两处 `gatherContext(..., this.knowledgeService)`、`runTool` 传 `knowledge`。
- `create-butler-service.ts` 与 `context.ts` 透传。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/butler-tools.test.ts tests/main/butler-prompt.test.ts`
Expected: PASS

---

### Task 7: 知识库页面、导航与 mock API

**Files:**
- Create: `src/renderer/shell/KnowledgePage.tsx`
- Modify: `src/renderer/shell/useWorkspaceData.ts`（`knowledgeTopics` + 三个回调）
- Modify: `src/renderer/shell/Workspace.tsx`（`section === 'knowledge'`）
- Modify: `src/renderer/shell/NavigationSidebar.tsx`（`Section`/`NavSection` 加 `knowledge`，导航项「知识库」用 `SparklesIcon`，位于「记忆」之前）
- Modify: `web/mock-api.ts`（`MockState.knowledgeTopics`、四个方法）
- Modify: `tests/renderer/navigation.test.tsx`、`tests/renderer/mobile-drawers.test.tsx`、`tests/web/mock-api.test.ts`
- Test: `tests/renderer/knowledge-page.test.tsx`（新建）

**Interfaces:**
- `KnowledgePage` props：`topics`, `workspaces`, `defaultWorkspaceId?`, `onOpenSidebar`, `onCreateTopic`, `onUpdateTopic`, `onDeleteTopic`。
- `useWorkspaceData` 返回 `knowledgeTopics`、`createKnowledgeTopic`、`updateKnowledgeTopic`、`deleteKnowledgeTopic`。
- mock 状态字段 `knowledgeTopics: KnowledgeTopic[]`，默认 `[]`；`listKnowledgeTopics(workspaceId?)` 过滤规则同主进程（含全局）。

- [ ] **Step 1: Write failing renderer tests**

```ts
test('lists topics, filters by workspace and keeps global topics', async () => {
  renderPage();
  expect(screen.getByText('LangChain')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('按工作区筛选知识主题'), 'english');
  expect(screen.getByText('LangChain')).toBeInTheDocument();       // global
  expect(screen.queryByText('RAG')).not.toBeInTheDocument();        // agent only
});

test('creates a global topic from the dialog', async () => {
  const { onCreateTopic } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: '新增主题' }));
  await userEvent.type(screen.getByLabelText('主题名称'), 'LangGraph');
  await userEvent.selectOptions(screen.getByLabelText('所属工作区'), '');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(onCreateTopic).toHaveBeenCalledWith({ name: 'LangGraph' });
});

test('shows the evidence timeline when a topic is expanded', async () => {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: '展开 LangChain' }));
  expect(screen.getByText(/11\/1 · 完成任务/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/knowledge-page.test.tsx`
Expected: FAIL — 页面不存在。

- [ ] **Step 3: Implement page, data, nav, mock**

- 页面：`PageFrame title="知识库" subtitle="主题 · 证据 · 掌握程度"`；工具条含搜索输入（`aria-label="搜索知识主题"`）、工作区筛选（`aria-label="按工作区筛选知识主题"`）、「新增主题」按钮；卡片显示名称、状态中文、level、工作区名、摘要、证据数；展开按钮 `aria-label={`展开 ${topic.name}`}` 显示证据时间线；卡片操作「编辑」「删除」。
- 对话框：主题名称、别名（逗号分隔）、所属工作区（含「全局（所有工作区）」）、状态、掌握程度（空或 1–5）、摘要；保存调用 create/update。
- 删除用 `window.confirm`。
- `useWorkspaceData`：加载 `api.listKnowledgeTopics().catch(() => [])`；回调更新本地状态。
- `Workspace.tsx` 新增 section 渲染；导航测试与移动抽屉测试的标签列表加入「知识库」。
- mock API 方法实现（create 校验名称；update/delete 持久化）。

- [ ] **Step 4: Run renderer and mock tests**

Run: `npx vitest run tests/renderer/knowledge-page.test.tsx tests/renderer/navigation.test.tsx tests/renderer/mobile-drawers.test.tsx tests/web/mock-api.test.ts`
Expected: PASS

---

### Task 8: 文档、e2e 与全量验证

**Files:**
- Modify: `README.md`（功能行、架构树 `knowledge/`、vault 布局 `knowledge/topics/*.md`）
- Modify: `e2e/desktop.spec.ts`（导航到知识库、新建主题、看到卡片）
- Modify: 可能受影响的既有测试（navigation 标签、preload 索引等已在前面任务处理）

- [ ] **Step 1: Update README and e2e**

- README 功能列表加：「知识库：主题 + 证据，自动从任务/笔记/复盘积累，长期规划据此跳过已学内容」。
- vault 布局加 `knowledge/topics/*.md`；架构树 `knowledge/` 一行。
- e2e 在长期计划步骤后追加：点击「知识库」→ 空状态 → 新增主题「LangChain」→ 卡片与「在学」可见。

- [ ] **Step 2: Run e2e typecheck and suite**

Run: `npm run typecheck:e2e && npm run test:e2e`
Expected: 1 passed。

- [ ] **Step 3: Run full verification**

Run: `npm run typecheck && npm test`
Expected: typecheck 无输出错误；所有测试文件通过。

- [ ] **Step 4: Package for manual check**

Run: `CSC_IDENTITY_AUTO_DISCOVERY=false npm run package`
Expected: 构建成功，`dist/mac-arm64/ASAKI.app` 更新。

---

## Self-Review Notes

- Spec coverage：数据模型/存储（Task 1–2）、自动积累（Task 3–4、6）、规划接地（Task 5）、管家（Task 6）、页面（Task 7）、非目标（未实现）、文档/e2e（Task 8）。
- 作用域、去重、默认状态、vault 级复盘、全局主题均已落进 Task 2/3/7 的测试。
- 类型一致性：`KnowledgeTopic` / `KnowledgeService` / `KnowledgeApi` 在 Task 1 定义，后续任务只引用；`linkReview` 的 `workspaceId` 始终可选。
