# Study Coach M1（基础与每日闭环）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个可运行的 Electron 桌面应用：本地 markdown 知识库、考研 onboarding、AI 生成的每日计划、晚间复盘、托盘提醒。

**Architecture:** Electron 主进程承载 vault、设置、模型调用与调度；React 渲染进程只通过类型化 IPC 访问能力。Vault 是唯一事实源，MiniSearch 索引可删除重建。

**Tech Stack:** Electron + electron-vite + React 19 + TypeScript（strict）+ Vitest + Testing Library + gray-matter + zod + minisearch + chokidar + Vercel AI SDK。

**Spec:** `/Users/Admin/orca/projects/OrcaProject/docs/superpowers/specs/2026-10-31-study-coach-design.md`

**Scope:** 本计划是 3 个计划中的第 1 个，覆盖设计文档的 M1（基础 + 每日闭环）。M2（对话老师、工具调用、错题复习）和 M3（发布、领域包扩充）在 M1 交付后单独写计划。

## Global Constraints

- macOS 优先；除托盘和通知外，业务代码保持跨平台。
- 本地优先：无账号、无服务器、无遥测；除用户配置的模型 API 外不发起网络请求。
- Vault 是唯一事实源：纯 markdown + YAML frontmatter + wikilinks；索引可删除重建。
- 永不自动删除用户笔记；删除一律移动到 `.trash/`。
- Agent 写日志/计划可直接落盘；改用户手写笔记正文必须显式 `allowUserNoteEdit`；frontmatter 元数据可更新。
- 所有 UI 文案中文；代码标识符英文。
- 每日主动模型调用上限 4 次；预算超限时降级为模板计划，不阻塞手动操作。
- API key 只经 Electron `safeStorage` 加密保存；不得写入日志、测试快照或明文配置。
- TypeScript strict；每个任务结束运行 `npm run typecheck && npm test` 并提交。
- 测试不联网；模型调用一律使用 `FakeModelClient`。

## Review Focus

1. **路径穿越**：模型或 UI 传入 `../`、绝对路径时，不能读写 vault 之外的文件。由 Task 3 的 `rejects unsafe path` 测试固定。
2. **并发编辑**：用户在 Obsidian 改文件后，agent 不能静默覆盖。由 Task 3 的 `refuses to overwrite when mtime changed` 测试固定。
3. **frontmatter 损坏**：手写笔记的 YAML 不合法时不能崩溃，正文仍可读。由 Task 2 的 `does not throw on malformed YAML` 测试固定。
4. **模型输出不是合法计划**：返回散文、截断 JSON、空任务时，重试一次后必须降级为模板计划。由 Task 9 的 `planner retries once then falls back` 测试固定。
5. **休眠/跨天错过触发**：早上 8 点没开机，10 点启动只补一次；13 点不再补早上；跨天重新触发。由 Task 12 的 catch-up 测试固定。

---

## Task 1: 搭建 Electron + React + TypeScript 骨架

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/styles.css`
- Test: `tests/setup.ts`, `tests/renderer/App.test.tsx`

**Interfaces:**
- Consumes: 无
- Produces: `App: React.FC`（命名导出），npm scripts `dev` / `build` / `test` / `typecheck`

- [ ] **Step 1: 写失败测试**

```tsx
// tests/renderer/App.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { App } from '../../src/renderer/App';

test('renders the app name', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Study Coach' })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/renderer/App.test.tsx`
Expected: FAIL，报错 `Cannot find module '../../src/renderer/App'`

- [ ] **Step 3: 创建骨架**

安装依赖（版本取当前稳定版，锁定在 package-lock）：

```bash
npm init -y
npm i react react-dom gray-matter zod minisearch chokidar ai @ai-sdk/anthropic @ai-sdk/openai-compatible
npm i -D electron electron-vite vite @vitejs/plugin-react typescript vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/react @types/react-dom
```

`package.json` 关键字段：

```json
{
  "name": "study-coach",
  "private": true,
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run"
  }
}
```

`electron.vite.config.ts`：

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] }
});
```

`src/main/index.ts`：创建 900×680 的 `BrowserWindow`，加载 renderer；macOS 关闭所有窗口时不退出。`src/preload/index.ts` 暂时只 `contextBridge.exposeInMainWorld('studyCoach', {})`。

`src/renderer/App.tsx`：

```tsx
export function App() {
  return <h1>Study Coach</h1>;
}
```

`src/renderer/index.html` 包含 `<div id="root"></div>` 和 `<script type="module" src="./main.tsx"></script>`；`src/renderer/main.tsx` 挂载 `<App />` 到 `#root`。`vitest.config.ts` 使用 `globals: true`、`environment: 'node'`、`setupFiles: ['tests/setup.ts']`、`include: ['tests/**/*.test.{ts,tsx}']`；tsconfig 的 `types` 加 `vitest/globals`。`tests/setup.ts` 引入 `@testing-library/jest-dom/vitest`。`.gitignore` 写入 `node_modules/`、`out/`、`dist/`、`.DS_Store`、`*.local`。

- [ ] **Step 4: 运行测试与类型检查**

Run: `npx vitest run tests/renderer/App.test.tsx && npm run typecheck`
Expected: 1 passed；typecheck 无错误

- [ ] **Step 5: 提交**

```bash
git add package.json package-lock.json electron.vite.config.ts tsconfig*.json vitest.config.ts .gitignore src tests
git commit -m "chore: scaffold electron react typescript app"
```

---

## Task 2: 共享类型、日期工具与笔记解析

**Files:**
- Create: `src/shared/types.ts`, `src/shared/date.ts`, `src/main/vault/note.ts`
- Test: `tests/shared/date.test.ts`, `tests/main/note.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - 类型：`NoteType`、`NoteMeta`、`Note`、`TaskStatus`、`StudyTask`、`DailyPlan`、`WeeklyPlan`、`SubjectConfig`、`ExamProfile`、`ProviderConfig`、`AppSettings`、`NotificationSettings`、`BudgetSettings`、`ReviewAnswers`
  - `formatLocalDate(date: Date): string`
  - `parseLocalDate(value: string): Date`
  - `parseNote(raw: string): { meta: NoteMeta; body: string }`
  - `serializeNote(meta: NoteMeta, body: string): string`

关键类型（写入 `src/shared/types.ts`）：

```ts
export type NoteType = 'note' | 'mistake' | 'plan' | 'log' | 'qa' | 'profile' | 'material';
export type TaskStatus = 'pending' | 'in-progress' | 'done' | 'skipped';

export interface NoteMeta {
  type: NoteType;
  subject?: string;
  status?: string;
  created?: string;
  updated?: string;
  source?: 'user' | 'agent' | 'imported';
  userTouched?: boolean;
  tags?: string[];
  review?: { next: string; interval_days: number; ease: number };
  tasks?: StudyTask[];
  [key: string]: unknown;
}

export interface Note { path: string; meta: NoteMeta; body: string; mtimeMs: number; }

export interface StudyTask {
  id: string;
  title: string;
  subject: string;
  durationMin: number;
  materialRefs: string[];
  acceptance: string;
  status: TaskStatus;
  actualMin?: number;
}

export interface DailyPlan { date: string; tasks: StudyTask[]; generatedBy: 'agent' | 'template'; }

export interface SubjectConfig { name: string; code?: string; syllabusRef?: string; }

export interface ExamProfile {
  examDate: string;
  targetSchool?: string;
  targetMajor?: string;
  subjects: SubjectConfig[];
  dailyMinutes: number;
  currentLevel: string;
}

export type ProviderConfig =
  | { kind: 'anthropic'; model: string }
  | { kind: 'openai-compatible'; baseURL: string; model: string }
  | { kind: 'ollama'; baseURL: string; model: string };

export interface NotificationSettings {
  enabled: boolean;
  morning: string;
  evening: string;
  dndStart: string;
  dndEnd: string;
}

export interface BudgetSettings { proactiveSessionsPerDay: number; dailyTokens: number; }

export interface AppSettings {
  vaultPath: string;
  provider: ProviderConfig;
  notifications: NotificationSettings;
  budget: BudgetSettings;
  launchAtLogin: boolean;
}

export interface ReviewAnswers { completed: string; stuck: string; tomorrow: string; skipped?: boolean; }
```

- [ ] **Step 1: 写失败测试**

```ts
// tests/shared/date.test.ts
import { formatLocalDate, parseLocalDate } from '../../src/shared/date';

test('formats using local date, not UTC', () => {
  expect(formatLocalDate(new Date(2026, 9, 31, 0, 30))).toBe('2026-10-31');
});

test('parses a date string to local midnight', () => {
  const d = parseLocalDate('2026-10-31');
  expect(d.getFullYear()).toBe(2026);
  expect(d.getMonth()).toBe(9);
  expect(d.getDate()).toBe(31);
  expect(d.getHours()).toBe(0);
});
```

```ts
// tests/main/note.test.ts
import { parseNote, serializeNote } from '../../src/main/vault/note';

test('parses frontmatter and body', () => {
  const note = parseNote('---\ntype: plan\ndate: 2026-10-31\nsource: agent\n---\n# 计划\n\n- 任务');
  expect(note.meta.type).toBe('plan');
  expect(note.meta.source).toBe('agent');
  expect(note.body).toContain('# 计划');
});

test('defaults missing frontmatter to a user note', () => {
  const note = parseNote('# 随手记\n内容');
  expect(note.meta).toEqual({ type: 'note', source: 'user' });
  expect(note.body).toBe('# 随手记\n内容');
});

test('does not throw on malformed YAML', () => {
  const raw = '---\ntype: [unclosed\n---\n正文';
  expect(() => parseNote(raw)).not.toThrow();
  expect(parseNote(raw).meta.type).toBe('note');
  expect(parseNote(raw).body).toContain('正文');
});

test('round-trips Chinese content', () => {
  const raw = serializeNote({ type: 'note', tags: ['数学'], source: 'agent' }, '# 极限\n\n定义：……');
  const parsed = parseNote(raw);
  expect(parsed.meta.tags).toEqual(['数学']);
  expect(parsed.body).toBe('# 极限\n\n定义：……');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/shared/date.test.ts tests/main/note.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`formatLocalDate` 用 `getFullYear/getMonth/getDate` 手动拼接，禁止 `toISOString().slice(0, 10)`（会跨时区错一天）。`parseLocalDate` 用 `new Date(y, m - 1, d)`。

`parseNote` 用 `gray-matter`；frontmatter 缺失时 `{ type: 'note', source: 'user' }`；YAML 抛错、解析结果不是对象、或 `type` 不在允许列表时，按损坏处理，返回 `{ type: 'note', source: 'user' }` 并保留正文。`serializeNote` 用 `gray-matter.stringify` 或手写 `---\n${yaml}\n---\n${body}`，确保中文不转义。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/shared/date.test.ts tests/main/note.test.ts && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/shared src/main/vault/note.ts tests/shared tests/main/note.test.ts
git commit -m "feat: add shared types and markdown note parsing"
```

---

## Task 3: Vault 服务（安全路径、写入守卫、回收站）

**Files:**
- Create: `src/main/vault/paths.ts`, `src/main/vault/vault-service.ts`
- Test: `tests/main/vault-service.test.ts`

**Interfaces:**
- Consumes: `Note`, `NoteMeta`（Task 2）
- Produces:
  - `VAULT_DIRS: Record<'goals'|'plans'|'logs'|'knowledge'|'mistakes'|'materials'|'qa'|'profile'|'trash', string>`
  - `dailyPlanPath(date: string): string`（`01-计划/日计划/YYYY-MM-DD.md`）
  - `dailyLogPath(date: string): string`（`02-日志/YYYY-MM-DD.md`）
  - `examProfilePath(): string`（`00-目标/考试档案.md`）
  - `syllabusPath(): string`（`00-目标/考试大纲.md`）
  - `assertSafeRelPath(relPath: string): string`
  - `class VaultService`：构造函数 `(root: string)`，属性 `root`，方法 `init()`、`read()`、`write()`、`list()`、`moveToTrash()`、`exists()`、`updateMeta()`
  - 错误类：`VaultPathError`、`VaultConflictError`、`UserNoteEditError`、`NoteNotFoundError`
  - `WriteOptions { expectedMtimeMs?: number; allowUserNoteEdit?: boolean }`

- [ ] **Step 1: 写失败测试**

```ts
// tests/main/vault-service.test.ts
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VAULT_DIRS, VaultService, VaultPathError, VaultConflictError, UserNoteEditError } from '../../src/main/vault/vault-service';
import { serializeNote } from '../../src/main/vault/note';

let vault: VaultService;
beforeEach(async () => {
  vault = new VaultService(await mkdtemp(join(tmpdir(), 'studycoach-')));
  await vault.init();
});

test('creates vault directories on init', async () => {
  for (const [key, dir] of Object.entries(VAULT_DIRS)) {
    if (key === 'trash') continue;
    expect((await stat(join(vault.root, dir))).isDirectory()).toBe(true);
  }
});

test('writes and reads a note', async () => {
  await vault.write('02-日志/2026-10-31.md', { type: 'log', source: 'agent' }, '内容');
  const note = await vault.read('02-日志/2026-10-31.md');
  expect(note.body).toBe('内容');
  expect(note.meta.type).toBe('log');
});

test.each(['../outside.md', '/etc/passwd', '00-目标/../../x.md'])('rejects unsafe path %s', async (p) => {
  await expect(vault.write(p, { type: 'note' }, 'x')).rejects.toThrow(VaultPathError);
});

test('moves notes to trash instead of deleting', async () => {
  await vault.write('03-知识/a.md', { type: 'note' }, 'x');
  const trashPath = await vault.moveToTrash('03-知识/a.md');
  expect(trashPath.startsWith('.trash/')).toBe(true);
  await expect(vault.read('03-知识/a.md')).rejects.toThrow();
  expect(await readFile(join(vault.root, trashPath), 'utf8')).toContain('x');
});

test('refuses to overwrite when mtime changed', async () => {
  await vault.write('03-知识/a.md', { type: 'note' }, 'v1');
  const first = await vault.read('03-知识/a.md');
  await new Promise((r) => setTimeout(r, 10));
  await writeFile(join(vault.root, '03-知识/a.md'), serializeNote({ type: 'note', source: 'user' }, 'external'));
  await expect(
    vault.write('03-知识/a.md', { type: 'note' }, 'v2', { expectedMtimeMs: first.mtimeMs })
  ).rejects.toThrow(VaultConflictError);
});

test('user note body edits need explicit permission', async () => {
  await vault.write('03-知识/a.md', { type: 'note', source: 'user' }, '原文');
  await expect(vault.write('03-知识/a.md', { type: 'note', source: 'agent' }, '改写')).rejects.toThrow(UserNoteEditError);
  await expect(
    vault.write('03-知识/a.md', { type: 'note', source: 'agent' }, '改写', { allowUserNoteEdit: true })
  ).resolves.toBeTruthy();
});

test('metadata-only updates are allowed on user notes', async () => {
  await vault.write('04-错题/a.md', { type: 'mistake', source: 'user' }, '题');
  await vault.updateMeta('04-错题/a.md', { review: { next: '2026-11-02', interval_days: 2, ease: 2.5 } });
  const note = await vault.read('04-错题/a.md');
  expect(note.meta.review?.next).toBe('2026-11-02');
  expect(note.body).toBe('题');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/vault-service.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`assertSafeRelPath`：拒绝绝对路径、`..` 段、空路径；`path.resolve(root, rel)` 后必须以 `root + path.sep` 开头。`VaultService.write`：读取旧文件（不存在则跳过）；若 `expectedMtimeMs` 与当前 mtime 不同抛 `VaultConflictError`；若旧笔记 `source === 'user' || userTouched` 且正文变化且 `allowUserNoteEdit !== true` 抛 `UserNoteEditError`；元数据变化不触发。写入用临时文件 + `rename` 原子替换。`moveToTrash` 生成 `.trash/<timestamp>-<basename>` 并 `rename`。`updateMeta` 合并 frontmatter 后写回，不检查正文守卫。`list` 递归读取 `.md`，跳过 `.trash`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/main/vault-service.test.ts && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/vault tests/main/vault-service.test.ts
git commit -m "feat: add vault service with path and edit guards"
```

---

## Task 4: 中文友好的搜索索引与文件监听

**Files:**
- Create: `src/main/index/search-index.ts`, `src/main/vault/watcher.ts`
- Test: `tests/main/search-index.test.ts`

**Interfaces:**
- Consumes: `Note`（Task 2）
- Produces:
  - `SearchResult { path: string; title: string; snippet: string; score: number }`
  - `SearchIndex { rebuild(notes: Note[]): void; upsert(note: Note): void; remove(path: string): void; search(query: string, limit?: number): SearchResult[] }`
  - `class MiniSearchIndex implements SearchIndex`
  - `cjkTokenize(text: string): string[]`
  - `startVaultWatcher(vault: VaultService, onChange: (relPath: string) => void): { close(): void; ready: Promise<void> }`

- [ ] **Step 1: 写失败测试**

```ts
// tests/main/search-index.test.ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MiniSearchIndex } from '../../src/main/index/search-index';
import { startVaultWatcher } from '../../src/main/vault/watcher';
import { VaultService } from '../../src/main/vault/vault-service';

const note = (path: string, body: string) => ({
  path, meta: { type: 'note' as const, source: 'user' as const }, body, mtimeMs: 0
});

test('finds Chinese notes by bigram', () => {
  const index = new MiniSearchIndex();
  index.upsert(note('03-知识/数学/极限.md', '极限与连续的定义'));
  expect(index.search('极限')[0]?.path).toBe('03-知识/数学/极限.md');
});

test('finds latin terms', () => {
  const index = new MiniSearchIndex();
  index.upsert(note('03-知识/agent.md', 'agent loop and tool calling'));
  expect(index.search('tool')[0]?.path).toBe('03-知识/agent.md');
});

test('remove drops a note', () => {
  const index = new MiniSearchIndex();
  index.upsert(note('a.md', '极限'));
  index.remove('a.md');
  expect(index.search('极限')).toEqual([]);
});

test('rebuild replaces old entries', () => {
  const index = new MiniSearchIndex();
  index.upsert(note('old.md', '旧内容'));
  index.rebuild([note('new.md', '新内容')]);
  expect(index.search('旧内容')).toEqual([]);
  expect(index.search('新内容')[0]?.path).toBe('new.md');
});

test('watcher reports changed markdown files', async () => {
  const vault = new VaultService(await mkdtemp(join(tmpdir(), 'sc-')));
  await vault.init();
  const events: string[] = [];
  const watcher = startVaultWatcher(vault, (p) => events.push(p));
  await watcher.ready;
  await vault.write('03-知识/a.md', { type: 'note' }, 'x');
  await vi.waitFor(() => expect(events).toContain('03-知识/a.md'), { timeout: 2000 });
  watcher.close();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/search-index.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

MiniSearch 配置 `fields: ['title', 'body', 'tags']`、`storeFields: ['path', 'title', 'body']`、`tokenize: cjkTokenize`。`cjkTokenize`：拉丁字母数字按 `/[a-z0-9]+/gi` 切；CJK 连续段生成全部单字 + 相邻双字 bigram（单字查询也能命中）；全部小写。`title` 取 frontmatter `title` 或文件名。`snippet` 取正文中首个命中词前后各 40 字符。`startVaultWatcher` 用 chokidar 监听 `vault.root/**/*.md`，`ignoreInitial: true`，100ms 防抖后回调相对路径；返回 `{ close, ready }`，`ready` 在 chokidar 的 `ready` 事件后 resolve。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/main/search-index.test.ts && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/index src/main/vault/watcher.ts tests/main/search-index.test.ts
git commit -m "feat: add cjk-aware search index and vault watcher"
```

---

## Task 5: 状态存储、设置与密钥存储

**Files:**
- Create: `src/main/state/json-store.ts`, `src/main/state/settings.ts`, `src/main/state/secrets.ts`
- Test: `tests/main/state.test.ts`

**Interfaces:**
- Consumes: `AppSettings`, `ProviderConfig`（Task 2）
- Produces:
  - `StateStore { get<T>(key: string, fallback: T): Promise<T>; set<T>(key: string, value: T): Promise<void> }`
  - `class JsonStateStore implements StateStore`（构造函数 `(filePath: string)`）
  - `SecretStore { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void> }`
  - `class MemorySecretStore implements SecretStore`
  - `class ElectronSecretStore implements SecretStore`（构造函数 `(filePath: string)`，使用 `safeStorage`）
  - `createDefaultSettings(vaultPath: string): AppSettings`
  - `class SettingsService`：构造函数 `(store: StateStore, secrets: SecretStore, defaultVaultPath: string)`，方法 `get()`、`update(patch: Partial<AppSettings>)`、`getApiKey()`、`setApiKey(key)`

- [ ] **Step 1: 写失败测试**

```ts
// tests/main/state.test.ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStateStore } from '../../src/main/state/json-store';
import { createDefaultSettings, SettingsService } from '../../src/main/state/settings';
import { MemorySecretStore } from '../../src/main/state/secrets';

test('json store persists values across reloads', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'sc-')), 'state.json');
  const store = new JsonStateStore(file);
  await store.set('settings', { a: 1 });
  const reloaded = new JsonStateStore(file);
  expect(await reloaded.get('settings', null)).toEqual({ a: 1 });
});

test('settings merge stored partials with defaults', async () => {
  const store = new JsonStateStore(join(await mkdtemp(join(tmpdir(), 'sc-')), 'state.json'));
  await store.set('settings', { budget: { proactiveSessionsPerDay: 2 } });
  const service = new SettingsService(store, new MemorySecretStore(), '/tmp/vault');
  const settings = await service.get();
  expect(settings.budget.proactiveSessionsPerDay).toBe(2);
  expect(settings.budget.dailyTokens).toBe(200000);
  expect(settings.notifications.morning).toBe('08:00');
});

test('memory secret store stores and deletes', async () => {
  const secrets = new MemorySecretStore();
  expect(await secrets.get('anthropic')).toBeNull();
  await secrets.set('anthropic', 'sk-test');
  expect(await secrets.get('anthropic')).toBe('sk-test');
  await secrets.delete('anthropic');
  expect(await secrets.get('anthropic')).toBeNull();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/state.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`JsonStateStore` 读文件为 `Record<string, unknown>`，`get` 返回 `data[key] ?? fallback`；`set` 更新后写临时文件并 `rename`。`createDefaultSettings(vaultPath)` 返回：provider `{ kind: 'anthropic', model: 'claude-sonnet-5-5' }`，通知 `{ enabled: true, morning: '08:00', evening: '21:30', dndStart: '23:00', dndEnd: '07:30' }`，预算 `{ proactiveSessionsPerDay: 4, dailyTokens: 200000 }`，`launchAtLogin: true`。`SettingsService.get` 用一层深合并（`notifications`、`budget`、`provider` 分别合并）。`getApiKey` / `setApiKey` 使用固定 key `'model-api-key'`。`ElectronSecretStore` 用 `safeStorage.encryptString` 加密后 base64 存 JSON；`safeStorage.isEncryptionAvailable()` 为 false 时抛 `SecretStorageUnavailableError`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/main/state.test.ts && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/state tests/main/state.test.ts
git commit -m "feat: add state settings and secret storage"
```

---

## Task 6: 考研领域包加载器与种子内容

**Files:**
- Create: `resources/exam-packs/kaoyan-2027/pack.json`, `src/main/domain/exam-pack.ts`
- Test: `tests/main/exam-pack.test.ts`

**Interfaces:**
- Consumes: `SubjectConfig`（Task 2）、`syllabusPath()`（Task 3）
- Produces:
  - `ExamPack { id: string; name: string; subjects: ExamPackSubject[] }`
  - `ExamPackSubject { name: string; codes: string[]; topics: string[] }`
  - `loadExamPack(dir: string): Promise<ExamPack>`
  - `renderSyllabusNote(pack: ExamPack, selected: SubjectConfig[]): string`

- [ ] **Step 1: 写失败测试**

```ts
// tests/main/exam-pack.test.ts
import { join } from 'node:path';
import { loadExamPack, renderSyllabusNote } from '../../src/main/domain/exam-pack';

const packDir = join(process.cwd(), 'resources/exam-packs/kaoyan-2027');

test('loads the kaoyan pack', async () => {
  const pack = await loadExamPack(packDir);
  expect(pack.subjects.map((s) => s.name)).toEqual(expect.arrayContaining(['政治', '英语', '数学']));
});

test('renders selected subjects into a syllabus note', async () => {
  const pack = await loadExamPack(packDir);
  const md = renderSyllabusNote(pack, [{ name: '数学', code: '数学一' }]);
  expect(md).toContain('数学一');
  expect(md).toContain('高等数学');
});

test('rejects a pack with no subjects', async () => {
  await expect(loadExamPack(join(process.cwd(), 'tests/fixtures/empty-pack'))).rejects.toThrow(/subjects/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/exam-pack.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`pack.json` 至少包含：政治（马原、毛中特、史纲、思修、时政）、英语（词汇、长难句、阅读、写作、翻译、完形，codes 英语一/英语二）、数学（高等数学、线性代数、概率论与数理统计，codes 数学一/数学二/数学三）、专业课（空 topics，用户导入）。用 zod 校验 `id`、`name`、`subjects[].name`、`codes`、`topics`；`subjects` 为空时抛错。`renderSyllabusNote` 生成 `# 考试大纲`，每个选中的科目一个 `## <name>（<code>）`，下面列 `- [ ] 话题`。

同时创建 `tests/fixtures/empty-pack/pack.json`，内容为 `{"id":"empty","name":"Empty","subjects":[]}`，供拒绝测试使用。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/main/exam-pack.test.ts && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add resources/exam-packs src/main/domain tests/main/exam-pack.test.ts tests/fixtures/empty-pack
git commit -m "feat: add kaoyan exam pack loader and seed syllabus"
```

---

## Task 7: 考试档案、Onboarding 与 IPC 骨架

**Files:**
- Create: `src/main/profile/exam-profile.ts`, `src/main/profile/onboarding-service.ts`, `src/shared/ipc.ts`, `src/main/ipc.ts`, `src/main/context.ts`, `src/renderer/global.d.ts`, `src/renderer/onboarding/Onboarding.tsx`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`
- Test: `tests/main/exam-profile.test.ts`, `tests/renderer/onboarding.test.tsx`

**Interfaces:**
- Consumes: `VaultService`（Task 3）、`SettingsService`（Task 5）、`ExamPack` / `loadExamPack` / `renderSyllabusNote`（Task 6）、`examProfilePath()` / `syllabusPath()`（Task 3）
- Produces:
  - `validateExamProfile(input: unknown): ExamProfile`
  - `renderExamProfile(profile: ExamProfile): string`
  - `parseExamProfile(raw: string): ExamProfile`
  - `class ExamProfileService`：构造函数 `(vault: VaultService)`，方法 `load(): Promise<ExamProfile | null>`、`save(profile: ExamProfile): Promise<void>`
  - `class OnboardingService`：构造函数 `(vault: VaultService, profiles: ExamProfileService, settings: SettingsService, packDir: string)`，方法 `complete(profile: ExamProfile): Promise<void>`（写档案 + 大纲 + 保存设置 + 通知已完成）
  - IPC 契约 `StudyCoachApi`：`getBootstrap()`、`completeOnboarding(profile)`（后续任务继续扩展）
  - `Bootstrap { needsOnboarding: boolean; today: string; hasApiKey: boolean }`
  - `window.studyCoach: StudyCoachApi`

- [ ] **Step 1: 写失败测试**

```ts
// tests/main/exam-profile.test.ts
import { parseExamProfile, renderExamProfile, validateExamProfile } from '../../src/main/profile/exam-profile';

const profile = {
  examDate: '2027-12-18', targetSchool: '示例大学', targetMajor: '计算机',
  subjects: [{ name: '数学', code: '数学一' }, { name: '英语', code: '英语一' }],
  dailyMinutes: 300, currentLevel: '基础一般'
};

test('round-trips the exam profile', () => {
  expect(parseExamProfile(renderExamProfile(profile))).toEqual(profile);
});

test('rejects invalid daily minutes and empty subjects', () => {
  expect(() => validateExamProfile({ ...profile, dailyMinutes: 10 })).toThrow(/dailyMinutes/);
  expect(() => validateExamProfile({ ...profile, subjects: [] })).toThrow(/subjects/);
});
```

```tsx
// tests/renderer/onboarding.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Onboarding } from '../../src/renderer/onboarding/Onboarding';

test('submits a valid exam profile', async () => {
  const complete = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = { completeOnboarding: complete } as never;
  render(<Onboarding />);
  fireEvent.change(screen.getByLabelText('考试日期'), { target: { value: '2027-12-18' } });
  await userEvent.type(screen.getByLabelText('考试科目（逗号分隔）'), '数学一,英语一,政治');
  await userEvent.clear(screen.getByLabelText('每天可用分钟数'));
  await userEvent.type(screen.getByLabelText('每天可用分钟数'), '300');
  await userEvent.click(screen.getByRole('button', { name: '生成我的学习计划' }));
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ dailyMinutes: 300, examDate: '2027-12-18' }));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/exam-profile.test.ts tests/renderer/onboarding.test.tsx`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`validateExamProfile` 用 zod：`examDate` 必须匹配 `YYYY-MM-DD`；`subjects` 至少 1 项；`dailyMinutes` 30–720；`currentLevel` 非空。`renderExamProfile` 输出 `---\ntype: profile\n---` + 标题 + 字段列表；`parseExamProfile` 用 `parseNote` 读回，缺字段抛错。

`OnboardingService.complete`：校验 → `ExamProfileService.save` → 读取 `resources/exam-packs/kaoyan-2027` 的 pack → `vault.write('00-目标/考试大纲.md', { type: 'profile', source: 'agent' }, renderSyllabusNote(...))` → `settings.update({ vaultPath })`。pack 路径在开发时用 `join(process.cwd(), 'resources/...')`，打包后由 `app.getAppPath()` 解析；封装 `resolveResourcePath(rel)`。

`src/shared/ipc.ts` 定义 `StudyCoachApi` 与 `Bootstrap`。`src/main/context.ts` 创建 `JsonStateStore`（`app.getPath('userData')/state.json`）、`ElectronSecretStore`、`SettingsService`、`VaultService`（settings.vaultPath 或 `join(app.getPath('documents'), 'StudyCoachVault')`）、`ExamProfileService`、`OnboardingService`。`src/main/ipc.ts` 注册 `getBootstrap`、`completeOnboarding`。`src/preload/index.ts` 用 `ipcRenderer.invoke` 暴露同名方法。`App.tsx` 在 `needsOnboarding` 时渲染 `<Onboarding />`，否则渲染占位标题。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/main/exam-profile.test.ts tests/renderer/onboarding.test.tsx && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/profile src/main/ipc.ts src/main/context.ts src/main/index.ts src/preload src/shared/ipc.ts src/renderer tests/main/exam-profile.test.ts tests/renderer/onboarding.test.tsx
git commit -m "feat: add exam profile onboarding and typed ipc"
```

---

## Task 8: 模型客户端与多 provider 适配

**Files:**
- Create: `src/main/agent/model-client.ts`, `src/main/agent/ai-sdk-client.ts`
- Test: `tests/main/model-client.test.ts`

**Interfaces:**
- Consumes: `ProviderConfig`（Task 2）
- Produces:
  - `ModelMessage { role: 'system' | 'user' | 'assistant'; content: string }`
  - `ModelRequest { messages: ModelMessage[]; temperature?: number; maxTokens?: number; responseFormat?: 'text' | 'json' }`
  - `ModelUsage { inputTokens: number; outputTokens: number }`
  - `ModelResponse { text: string; usage: ModelUsage }`
  - `ModelClient { complete(request: ModelRequest): Promise<ModelResponse> }`
  - `class FakeModelClient implements ModelClient`（构造函数 `(responses: Array<string | ModelResponse>)`，公开 `calls: ModelRequest[]`）
  - `createModelClient(provider: ProviderConfig, apiKey: string | null): ModelClient`
  - `class NoApiKeyError extends Error`

- [ ] **Step 1: 写失败测试**

```ts
// tests/main/model-client.test.ts
import { AiSdkModelClient } from '../../src/main/agent/ai-sdk-client';
import { createModelClient, FakeModelClient, NoApiKeyError } from '../../src/main/agent/model-client';

test('fake client returns scripted responses in order', async () => {
  const client = new FakeModelClient(['first', 'second']);
  expect((await client.complete({ messages: [] })).text).toBe('first');
  expect((await client.complete({ messages: [] })).text).toBe('second');
  expect(client.calls).toHaveLength(2);
});

test('anthropic provider requires an api key', () => {
  expect(() => createModelClient({ kind: 'anthropic', model: 'claude-sonnet-5-5' }, null)).toThrow(NoApiKeyError);
});

test('adapter maps text and usage', async () => {
  const generate = vi.fn().mockResolvedValue({ text: 'hello', usage: { inputTokens: 3, outputTokens: 2 } });
  const client = new AiSdkModelClient({ generate });
  const result = await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
  expect(result).toEqual({ text: 'hello', usage: { inputTokens: 3, outputTokens: 2 } });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/model-client.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`FakeModelClient` 按顺序返回；字符串包装为 `{ text, usage: { inputTokens: 0, outputTokens: 0 } }`。`createModelClient`：`anthropic` 要求 key，用 `@ai-sdk/anthropic` 的 `createAnthropic({ apiKey })`；`openai-compatible` 用 `@ai-sdk/openai-compatible` 的 `createOpenAICompatible({ baseURL, apiKey })`；`ollama` 用 OpenAI-compatible，`baseURL` 默认 `http://127.0.0.1:11434/v1`，`apiKey: 'ollama'`。`AiSdkModelClient` 构造函数注入 `{ generate: typeof generateText }` 以便测试；`complete` 调 `generate`，把 `responseFormat === 'json'` 映射为 `output: Output.json()` 或等效配置（按所装 AI SDK 版本），返回 text 与 usage。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/main/model-client.test.ts && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/agent tests/main/model-client.test.ts
git commit -m "feat: add model client and provider adapters"
```

---

## Task 8.5: 设置页（模型、预算、通知）

**Files:**
- Create: `src/renderer/settings/SettingsPage.tsx`
- Modify: `src/main/context.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`, `src/renderer/App.tsx`
- Test: `tests/renderer/settings.test.tsx`

**Interfaces:**
- Consumes: `SettingsService`（Task 5）、`AppSettings` / `ProviderConfig`（Task 2）
- Produces:
  - IPC：`getSettings(): Promise<AppSettings>`、`updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>`、`setApiKey(key: string): Promise<void>`
  - 组件 `SettingsPage({ onClose }: { onClose: () => void })`

- [ ] **Step 1: 写失败测试**

```tsx
// tests/renderer/settings.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../src/renderer/settings/SettingsPage';

const settings = {
  vaultPath: '/tmp/vault',
  provider: { kind: 'anthropic' as const, model: 'claude-sonnet-5-5' },
  notifications: { enabled: true, morning: '08:00', evening: '21:30', dndStart: '23:00', dndEnd: '07:30' },
  budget: { proactiveSessionsPerDay: 4, dailyTokens: 200000 },
  launchAtLogin: true
};

test('saves provider model and api key without echoing the key', async () => {
  const update = vi.fn().mockResolvedValue(settings);
  const setKey = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: update,
    setApiKey: setKey
  } as never;
  render(<SettingsPage onClose={() => {}} />);
  expect(await screen.findByLabelText('模型名称')).toHaveValue('claude-sonnet-5-5');
  await userEvent.clear(screen.getByLabelText('模型名称'));
  await userEvent.type(screen.getByLabelText('模型名称'), 'claude-opus-5-5');
  await userEvent.type(screen.getByLabelText('API Key'), 'sk-test');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ provider: expect.objectContaining({ model: 'claude-opus-5-5' }) }));
  expect(setKey).toHaveBeenCalledWith('sk-test');
  expect(screen.getByLabelText('API Key')).toHaveValue('');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/renderer/settings.test.tsx`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`SettingsPage` 挂载时 `getSettings`。字段：
- 提供商（select）：`Anthropic` / `OpenAI 兼容` / `Ollama`
- 模型名称（text）
- Base URL（仅 OpenAI 兼容 / Ollama 显示，Ollama 默认 `http://127.0.0.1:11434/v1`）
- API Key（password，占位符“已保存则留空”）
- 每日主动会话次数（number）、每日 token 上限（number）
- 早间时间、晚间时间、免打扰开始/结束（time）
- 开机自启（checkbox）
- “保存设置”按钮

保存时先 `updateSettings({ provider, budget, notifications, launchAtLogin })`，若 API Key 非空再 `setApiKey(key)`；保存成功后清空 API Key 输入并显示“已保存”。主进程 `ipc.ts` 注册三个 handler（`setApiKey` 调 `settings.setApiKey`）；`preload` 暴露；`App.tsx` 顶部加“设置”按钮，并在 `!hasApiKey` 时显示横幅“未配置模型，当前使用模板计划”+“去设置”。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/renderer/settings.test.tsx && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/renderer/settings src/renderer/App.tsx src/main/context.ts src/main/ipc.ts src/preload src/shared/ipc.ts tests/renderer/settings.test.tsx
git commit -m "feat: add settings page for model budget and notifications"
```

---

## Task 9: 计划解析、计划仓库、预算与 Planner

**Files:**
- Create: `src/main/plan/plan-parser.ts`, `src/main/plan/plan-repo.ts`, `src/main/plan/planner.ts`, `src/main/plan/budget.ts`, `src/main/plan/prompts.ts`
- Test: `tests/main/planner.test.ts`

**Interfaces:**
- Consumes: `ModelClient`、`FakeModelClient`（Task 8）、`VaultService` / `dailyPlanPath`（Task 3）、`DailyPlan` / `ExamProfile` / `StudyTask`（Task 2）、`StateStore`（Task 5）、`formatLocalDate`（Task 2）
- Produces:
  - `class PlanParseError extends Error`
  - `parseDailyPlan(text: string): DailyPlan`
  - `templateDailyPlan(profile: ExamProfile, date: string): DailyPlan`
  - `buildPlannerPrompt(ctx: PlannerContext): ModelMessage[]`
  - `PlannerContext { profile: ExamProfile; date: string; syllabus: string; lastLog?: string; unfinishedTasks: StudyTask[] }`
  - `class PlanRepo`：构造函数 `(vault: VaultService)`，方法 `read(date: string): Promise<DailyPlan | null>`、`write(plan: DailyPlan): Promise<void>`
  - `type BudgetDecision = { allowed: true } | { allowed: false; reason: 'proactive-limit' | 'token-limit'; requiresConfirmation: boolean }`
  - `class BudgetGuard`：`canRun(mode: 'proactive' | 'manual'): Promise<BudgetDecision>`、`record(usage: ModelUsage): Promise<void>`
  - `class Planner`：构造函数 `(client: ModelClient | null, repo: PlanRepo, budget: BudgetGuard, now: () => Date)`，方法 `generateDailyPlan(ctx: PlannerContext): Promise<DailyPlan>`

- [ ] **Step 1: 写失败测试**

```ts
// tests/main/planner.test.ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultService } from '../../src/main/vault/vault-service';
import { JsonStateStore } from '../../src/main/state/json-store';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { parseDailyPlan, PlanParseError } from '../../src/main/plan/plan-parser';
import { PlanRepo } from '../../src/main/plan/plan-repo';
import { BudgetGuard } from '../../src/main/plan/budget';
import { Planner } from '../../src/main/plan/planner';

const profile = {
  examDate: '2027-12-18', subjects: [{ name: '数学', code: '数学一' }],
  dailyMinutes: 120, currentLevel: '基础一般'
};
const ctx = { profile, date: '2026-10-31', syllabus: '# 大纲\n- 极限', unfinishedTasks: [] };
const valid = JSON.stringify({
  date: '2026-10-31', generatedBy: 'agent',
  tasks: [{ id: 't1', title: '极限', subject: '数学', durationMin: 45, materialRefs: [], acceptance: '10 题', status: 'pending' }]
});

test('parses a valid plan and rejects empty plans', () => {
  expect(parseDailyPlan('```json\n' + valid + '\n```').tasks).toHaveLength(1);
  expect(() => parseDailyPlan('{"date":"2026-10-31","tasks":[]}')).toThrow(PlanParseError);
});

test('writes and reads a plan note', async () => {
  const vault = new VaultService(await mkdtemp(join(tmpdir(), 'sc-')));
  await vault.init();
  const repo = new PlanRepo(vault);
  await repo.write(parseDailyPlan(valid));
  expect((await repo.read('2026-10-31'))?.tasks[0].title).toBe('极限');
});

test('planner retries once then falls back to a template', async () => {
  const client = new FakeModelClient(['not json', 'still not json']);
  const vault = new VaultService(await mkdtemp(join(tmpdir(), 'sc-')));
  await vault.init();
  const store = new JsonStateStore(join(await mkdtemp(join(tmpdir(), 'sc-')), 'state.json'));
  const planner = new Planner(client, new PlanRepo(vault), new BudgetGuard(store, { proactivePerDay: 4, dailyTokens: 200000 }, () => new Date('2026-10-31T08:00:00')), () => new Date('2026-10-31T08:00:00'));
  const plan = await planner.generateDailyPlan(ctx);
  expect(client.calls).toHaveLength(2);
  expect(plan.generatedBy).toBe('template');
  expect(plan.tasks).toHaveLength(3);
});

test('planner falls back when no model client', async () => {
  const vault = new VaultService(await mkdtemp(join(tmpdir(), 'sc-')));
  await vault.init();
  const store = new JsonStateStore(join(await mkdtemp(join(tmpdir(), 'sc-')), 'state.json'));
  const planner = new Planner(null, new PlanRepo(vault), new BudgetGuard(store, { proactivePerDay: 4, dailyTokens: 200000 }, () => new Date()), () => new Date());
  expect((await planner.generateDailyPlan(ctx)).generatedBy).toBe('template');
});

test('proactive budget exhaustion returns a template', async () => {
  const store = new JsonStateStore(join(await mkdtemp(join(tmpdir(), 'sc-')), 'state.json'));
  const budget = new BudgetGuard(store, { proactivePerDay: 0, dailyTokens: 200000 }, () => new Date('2026-10-31T08:00:00'));
  expect(await budget.canRun('proactive')).toEqual({ allowed: false, reason: 'proactive-limit', requiresConfirmation: false });
});

test('manual mode asks for confirmation after token limit', async () => {
  const store = new JsonStateStore(join(await mkdtemp(join(tmpdir(), 'sc-')), 'state.json'));
  await store.set('budget/2026-10-31', { proactiveRuns: 0, tokens: 200000 });
  const budget = new BudgetGuard(store, { proactivePerDay: 4, dailyTokens: 200000 }, () => new Date('2026-10-31T08:00:00'));
  expect(await budget.canRun('manual')).toEqual({ allowed: false, reason: 'token-limit', requiresConfirmation: true });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/planner.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`parseDailyPlan`：去掉 ```json 围栏，找到第一个 `{` 到最后一个 `}`；`JSON.parse` 后用 zod 校验 `date`、`tasks` 1–6 项、`durationMin` 10–180、`status` 合法；缺 `id` 时生成 `t1..tn`；缺 `generatedBy` 时设为 `'agent'`。任何失败抛 `PlanParseError`。

`templateDailyPlan`：按 `profile.subjects` 轮流出 3 个任务，每个 30 分钟，`acceptance: '完成本节基础练习'`，`generatedBy: 'template'`。

`PlanRepo.write`：`vault.write(dailyPlanPath(plan.date), { type: 'plan', date: plan.date, tasks: plan.tasks, source: 'agent' }, renderPlanBody(plan))`。`read` 从 `meta.tasks` 解析，缺失返回 `null`。

`buildPlannerPrompt`：system 说明“你是考研教练，只输出 JSON”；user 内容包含考试日期、科目、每日分钟、大纲、昨日未完成任务、昨日日志。要求 3–5 个任务、每个含 id/title/subject/durationMin/materialRefs/acceptance/status。

`BudgetGuard`：state key `budget/YYYY-MM-DD` 存 `{ proactiveRuns, tokens }`；`canRun('proactive')` 在 `proactiveRuns >= limit` 时拒绝；`dailyTokens` 超限时拒绝，`manual` 模式返回 `requiresConfirmation: true`。`record` 累加。

`Planner.generateDailyPlan`：若 `client` 为 null → 模板；`budget.canRun('proactive')` 不允许 → 模板；调用模型，`record` usage；解析失败时把错误信息追加到 prompt 重试一次；第二次失败 → 模板。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/main/planner.test.ts && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/plan tests/main/planner.test.ts
git commit -m "feat: add plan parser repository budget and planner"
```

---

## Task 10: 今日页、任务状态与计划 IPC

**Files:**
- Create: `src/renderer/today/TodayPage.tsx`, `src/renderer/today/TaskCard.tsx`, `src/renderer/today/Timer.tsx`, `src/renderer/today/timer-logic.ts`
- Modify: `src/main/context.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`, `src/renderer/App.tsx`
- Test: `tests/renderer/today.test.tsx`, `tests/renderer/timer.test.ts`

**Interfaces:**
- Consumes: `Planner`、`PlanRepo`、`BudgetGuard`（Task 9）、`createModelClient`（Task 8）、`SettingsService`（Task 5）、`VaultService`（Task 3）
- Produces:
  - IPC：`getTodayPlan(): Promise<DailyPlan | null>`、`generateTodayPlan(): Promise<DailyPlan>`、`updateTask(input: UpdateTaskInput): Promise<DailyPlan>`
  - `UpdateTaskInput { taskId: string; status: TaskStatus; actualMin?: number }`
  - `elapsedMinutes(start: Date, end: Date): number`
  - 组件 `TodayPage`、`TaskCard`、`Timer`

- [ ] **Step 1: 写失败测试**

```tsx
// tests/renderer/today.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TodayPage } from '../../src/renderer/today/TodayPage';

const plan = {
  date: '2026-10-31', generatedBy: 'agent' as const,
  tasks: [
    { id: 't1', title: '极限与连续', subject: '数学', durationMin: 45, materialRefs: [], acceptance: '完成 10 题', status: 'pending' as const },
    { id: 't2', title: '阅读理解', subject: '英语', durationMin: 30, materialRefs: [], acceptance: '精读 1 篇', status: 'pending' as const }
  ]
};

test('renders tasks and completes one', async () => {
  const updateTask = vi.fn().mockResolvedValue({ ...plan, tasks: [{ ...plan.tasks[0], status: 'done' }, plan.tasks[1]] });
  window.studyCoach = { getTodayPlan: vi.fn().mockResolvedValue(plan), updateTask } as never;
  render(<TodayPage />);
  expect(await screen.findByText('极限与连续')).toBeInTheDocument();
  expect(screen.getByText('完成 10 题')).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole('button', { name: '完成' })[0]);
  expect(updateTask).toHaveBeenCalledWith({ taskId: 't1', status: 'done' });
  expect(await screen.findByText('1 / 2 完成')).toBeInTheDocument();
});

test('shows a generate button when there is no plan', async () => {
  const generate = vi.fn().mockResolvedValue(plan);
  window.studyCoach = { getTodayPlan: vi.fn().mockResolvedValue(null), generateTodayPlan: generate } as never;
  render(<TodayPage />);
  await userEvent.click(await screen.findByRole('button', { name: '生成今日计划' }));
  expect(generate).toHaveBeenCalled();
});
```

```ts
// tests/renderer/timer.test.ts
import { elapsedMinutes } from '../../src/renderer/today/timer-logic';

test('counts whole minutes and never goes negative', () => {
  expect(elapsedMinutes(new Date('2026-10-31T10:00:00'), new Date('2026-10-31T10:25:30'))).toBe(25);
  expect(elapsedMinutes(new Date('2026-10-31T10:10:00'), new Date('2026-10-31T10:00:00'))).toBe(0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/renderer/today.test.tsx`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`TodayPage` 挂载时调 `getTodayPlan`；null 时显示“今天还没计划”+“生成今日计划”；有任务时渲染任务卡与进度 `X / Y 完成`。`TaskCard` 显示标题、科目、建议时长、验收标准，按钮“开始/完成/跳过”；点击“完成”调 `updateTask({ taskId, status: 'done' })`。`Timer` 显示已用分钟，点“开始”记录 `startedAt`，点“结束”用 `elapsedMinutes(startedAt, new Date())` 得到 `actualMin` 传给 `updateTask`；`elapsedMinutes` 实现为 `Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000))`。

主进程 `context.ts` 增加：`PlanRepo`、`BudgetGuard`、`Planner`（用 `settings.getApiKey()` 创建 client；无 key 则 null）。`ipc.ts` 实现三个 handler：`getTodayPlan` 读 `formatLocalDate(new Date())`；`generateTodayPlan` 收集 profile、syllabus 笔记正文、昨日日志、昨日未完成任务，调 `planner.generateDailyPlan` 并 `repo.write`；`updateTask` 读今日计划、校验任务存在、更新状态与 `actualMin`、写回并返回。`App.tsx` 在 onboarding 完成后渲染 `<TodayPage />`，保留 Task 8.5 的“设置”按钮与未配置模型横幅。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/renderer/today.test.tsx tests/renderer/timer.test.ts && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/renderer/today src/main src/preload src/shared/ipc.ts tests/renderer/today.test.tsx
git commit -m "feat: add today page and plan task ipc"
```

---

## Task 11: 晚间复盘

**Files:**
- Create: `src/main/review/review-service.ts`, `src/renderer/review/ReviewDialog.tsx`
- Modify: `src/main/context.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/ipc.ts`, `src/renderer/App.tsx`, `src/renderer/today/TodayPage.tsx`
- Test: `tests/main/review.test.ts`, `tests/renderer/review.test.tsx`

**Interfaces:**
- Consumes: `VaultService` / `dailyLogPath`（Task 3）、`ReviewAnswers`（Task 2）
- Produces:
  - `renderReviewLog(date: string, answers: ReviewAnswers): string`
  - `class ReviewService`：构造函数 `(vault: VaultService)`，方法 `save(date: string, answers: ReviewAnswers): Promise<string>`（返回日志相对路径）
  - IPC：`submitReview(input: { date: string; answers: ReviewAnswers }): Promise<void>`

- [ ] **Step 1: 写失败测试**

```ts
// tests/main/review.test.ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultService } from '../../src/main/vault/vault-service';
import { ReviewService } from '../../src/main/review/review-service';

test('writes the three review sections and appends a second review', async () => {
  const vault = new VaultService(await mkdtemp(join(tmpdir(), 'sc-')));
  await vault.init();
  const service = new ReviewService(vault);
  const answers = { completed: '数学 2 小时', stuck: '极限定义', tomorrow: '先复习极限' };
  const path = await service.save('2026-10-31', answers);
  expect(path).toBe('02-日志/2026-10-31.md');
  const first = await vault.read(path);
  expect(first.body).toContain('数学 2 小时');
  expect(first.body).toContain('极限定义');
  await service.save('2026-10-31', { ...answers, completed: '补充' });
  expect((await vault.read(path)).body).toContain('补充复盘');
});
```

```tsx
// tests/renderer/review.test.tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewDialog } from '../../src/renderer/review/ReviewDialog';
import { TodayPage } from '../../src/renderer/today/TodayPage';

test('submits review answers', async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = { submitReview: submit } as never;
  render(<ReviewDialog date="2026-10-31" onClose={() => {}} />);
  await userEvent.type(screen.getByLabelText('今天完成了什么？'), '数学');
  await userEvent.type(screen.getByLabelText('卡在哪里？'), '极限');
  await userEvent.type(screen.getByLabelText('明天想怎么调整？'), '先复习');
  await userEvent.click(screen.getByRole('button', { name: '保存复盘' }));
  expect(submit).toHaveBeenCalledWith({ date: '2026-10-31', answers: { completed: '数学', stuck: '极限', tomorrow: '先复习' } });
});

test('opens the review dialog from the today page', async () => {
  window.studyCoach = {
    getTodayPlan: vi.fn().mockResolvedValue({ date: '2026-10-31', generatedBy: 'template', tasks: [] }),
    submitReview: vi.fn()
  } as never;
  render(<TodayPage />);
  await userEvent.click(await screen.findByRole('button', { name: '复盘' }));
  expect(screen.getByLabelText('今天完成了什么？')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/review.test.ts tests/renderer/review.test.tsx`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`renderReviewLog`：首次写入 `---\ntype: log\ndate: ...\nsource: agent\n---\n# 2026-10-31 复盘\n\n## 今天完成了什么\n...`；`ReviewService.save` 若日志已存在，追加 `## 补充复盘 HH:mm` 段落，不覆盖。`ReviewDialog` 三个 textarea、保存/跳过按钮；跳过时提交 `{ skipped: true, completed: '', stuck: '', tomorrow: '' }`。主进程注册 `submitReview`，`context.ts` 创建 `ReviewService`。`TodayPage` 顶部加“复盘”按钮，点击打开 `ReviewDialog`，提交或关闭后关闭对话框。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/main/review.test.ts tests/renderer/review.test.tsx && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/review src/renderer/review src/main/context.ts src/main/ipc.ts src/preload src/shared/ipc.ts tests/main/review.test.ts tests/renderer/review.test.tsx
git commit -m "feat: add evening review flow"
```

---

## Task 12: 调度器、免打扰与托盘

**Files:**
- Create: `src/main/scheduler/scheduler.ts`, `src/main/scheduler/dnd.ts`, `src/main/tray.ts`
- Modify: `src/main/context.ts`, `src/main/index.ts`
- Test: `tests/main/scheduler.test.ts`

**Interfaces:**
- Consumes: `StateStore`（Task 5）、`formatLocalDate`（Task 2）、`Planner`（Task 9）
- Produces:
  - `type SchedulerTrigger = 'morning' | 'evening'`
  - `class Scheduler`：构造函数 `(options: SchedulerOptions)`，`start()`、`stop()`、`tick(): Promise<void>`
  - `SchedulerOptions { state: StateStore; now: () => Date; onMorning: () => Promise<void>; onEvening: () => Promise<void>; morningTime?: string; eveningTime?: string; notify: (title: string, body: string) => void; isDnd?: (now: Date) => boolean }`
  - `isWithinDnd(now: Date, start: string, end: string): boolean`
  - `createTray(actions: { open(): void; startNextTask(): void; toggleDnd(): void; quit(): void }): Tray`

- [ ] **Step 1: 写失败测试**

```ts
// tests/main/scheduler.test.ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStateStore } from '../../src/main/state/json-store';
import { Scheduler } from '../../src/main/scheduler/scheduler';
import { isWithinDnd } from '../../src/main/scheduler/dnd';

async function makeScheduler(times: string[]) {
  const store = new JsonStateStore(join(await mkdtemp(join(tmpdir(), 'sc-')), 'state.json'));
  const morning = vi.fn().mockResolvedValue(undefined);
  const evening = vi.fn().mockResolvedValue(undefined);
  const notify = vi.fn();
  let now = new Date(times[0]);
  const scheduler = new Scheduler({ state: store, now: () => now, onMorning: morning, onEvening: evening, notify });
  const tickAt = async (value: string) => { now = new Date(value); await scheduler.tick(); };
  return { scheduler, morning, evening, notify, tickAt };
}

test('morning fires once after 08:00 and not again the same day', async () => {
  const { morning, tickAt } = await makeScheduler(['2026-10-31T07:59:00']);
  await tickAt('2026-10-31T07:59:00');
  expect(morning).not.toHaveBeenCalled();
  await tickAt('2026-10-31T08:00:00');
  expect(morning).toHaveBeenCalledTimes(1);
  await tickAt('2026-10-31T08:05:00');
  expect(morning).toHaveBeenCalledTimes(1);
});

test('catch-up morning until noon, then stops', async () => {
  const { morning, tickAt } = await makeScheduler(['2026-10-31T10:00:00']);
  await tickAt('2026-10-31T10:00:00');
  expect(morning).toHaveBeenCalledTimes(1);
});

test('does not catch up morning after 12:00', async () => {
  const { morning, tickAt } = await makeScheduler(['2026-10-31T13:00:00']);
  await tickAt('2026-10-31T13:00:00');
  expect(morning).not.toHaveBeenCalled();
});

test('evening fires after 21:30', async () => {
  const { evening, tickAt } = await makeScheduler(['2026-10-31T21:30:00']);
  await tickAt('2026-10-31T21:30:00');
  expect(evening).toHaveBeenCalledTimes(1);
});

test('dnd suppresses notification but not the trigger', async () => {
  const { morning, notify, tickAt } = await makeScheduler(['2026-10-31T08:00:00']);
  const scheduler = new Scheduler({
    state: new JsonStateStore(join(await mkdtemp(join(tmpdir(), 'sc-')), 'state.json')),
    now: () => new Date('2026-10-31T08:00:00'),
    onMorning: morning, onEvening: vi.fn(), notify, isDnd: () => true
  });
  await scheduler.tick();
  expect(morning).toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
});

test('dnd window handles overnight ranges', () => {
  expect(isWithinDnd(new Date(2026, 9, 31, 23, 30), '23:00', '07:30')).toBe(true);
  expect(isWithinDnd(new Date(2026, 9, 31, 6, 0), '23:00', '07:30')).toBe(true);
  expect(isWithinDnd(new Date(2026, 9, 31, 12, 0), '23:00', '07:30')).toBe(false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/scheduler.test.ts`
Expected: FAIL，模块不存在

- [ ] **Step 3: 实现**

`Scheduler.tick`：读 `scheduler/last-morning`、`scheduler/last-evening`（日期字符串）；到 08:00 且今天未触发、且当前时间 ≤ 12:00 → 调 `onMorning`，写状态，非免打扰时 `notify('今日计划已生成', ...)`；到 21:30 且今天未触发 → `onEvening`，状态，通知“该复盘了”。`start` 每 60 秒 `tick`；`stop` 清理定时器。`isWithinDnd` 处理跨午夜区间。

`tray.ts` 用 Electron `Tray` 和 `Menu`，菜单项：打开 Study Coach、开始下一任务、免打扰开关、退出。图标暂用 `resources/iconTemplate.png`（16×16 模板图，随任务创建占位）。`main/index.ts` 启动 Scheduler：`onMorning` 调 `planner.generateDailyPlan` 并写计划、发通知；`onEvening` 发通知提醒打开复盘（不自动弹窗）。`context.ts` 暴露 `planner`、`review`、`scheduler`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/main/scheduler.test.ts && npm run typecheck`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/scheduler src/main/tray.ts src/main/context.ts src/main/index.ts resources/iconTemplate.png tests/main/scheduler.test.ts
git commit -m "feat: add scheduler dnd and tray"
```

---

## Task 13: 构建、README 与 Electron 冒烟测试

**Files:**
- Create: `README.md`, `LICENSE`, `playwright.config.ts`, `tests/e2e/app.spec.ts`
- Modify: `package.json`, `src/main/index.ts`（支持 `STUDYCOACH_USER_DATA` 环境变量）

**Interfaces:**
- Consumes: 前 12 个任务
- Produces: `npm run build` 可产出 `out/`；`npm run test:e2e` 可启动打包后的应用并验证首屏

- [ ] **Step 1: 写失败冒烟测试**

```ts
// tests/e2e/app.spec.ts
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('launches to the onboarding screen', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'sc-e2e-'));
  const vault = await mkdtemp(join(tmpdir(), 'sc-e2e-vault-'));
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, STUDYCOACH_USER_DATA: userData, STUDYCOACH_VAULT: vault }
  });
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Study Coach' })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成我的学习计划' })).toBeVisible();
  await app.close();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run build && npx playwright test tests/e2e/app.spec.ts`
Expected: FAIL（Playwright 未安装或 `STUDYCOACH_USER_DATA` 未支持）

- [ ] **Step 3: 实现**

安装 `@playwright/test`。`package.json` 增加 `"test:e2e": "npm run build && playwright test"`。`main/index.ts` 在 `app.whenReady()` 前：

```ts
if (process.env.STUDYCOACH_USER_DATA) app.setPath('userData', process.env.STUDYCOACH_USER_DATA);
```

`context.ts` 的默认 vault 路径改为 `process.env.STUDYCOACH_VAULT ?? join(app.getPath('documents'), 'StudyCoachVault')`，保证 e2e 使用独立 vault。

`playwright.config.ts`：`testDir: './tests/e2e'`，`timeout: 30000`，`workers: 1`。`README.md` 包含：项目简介、安装（Node 22+、npm）、开发（`npm run dev`）、模型配置（Anthropic / OpenAI-compatible / Ollama，key 只存本机）、隐私说明（数据在 vault、无遥测、模型调用除外）、测试（`npm test`、`npm run test:e2e`）、当前范围（M1）与路线图。`LICENSE` 用 MIT 标准文本，版权行 `Copyright (c) 2026 Study Coach contributors`。

- [ ] **Step 4: 运行构建与测试**

Run: `npm run typecheck && npm test && npm run test:e2e`
Expected: 全部 PASS；`npm run build` 产出 `out/main/index.js`、`out/preload/index.js`、`out/renderer/index.html`

- [ ] **Step 5: 提交**

```bash
git add README.md LICENSE playwright.config.ts tests/e2e src/main/index.ts package.json package-lock.json
git commit -m "chore: add build readme and electron smoke test"
```

---

## 自检记录

- **Spec 覆盖（M1）**：vault（Task 3）、onboarding（Task 7）、课程大纲（Task 6）、每日计划（Task 9/10）、晚间复盘（Task 11）、托盘提醒（Task 12）、模型设置（Task 5/8/8.5）、本地优先/无遥测（全局约束）、对话记录与 Tutor（M2，本计划不覆盖）。
- **未覆盖的 M1 细节**：Knowledge base 浏览/编辑 UI（M2）、审批队列（M2 的 agent 工具才需要）、对话老师（M2）。
- **类型一致性**：`DailyPlan.generatedBy` 在 Task 2 定义，Task 9 写入，Task 10 渲染；`UpdateTaskInput` 在 Task 10 定义并被 IPC 与组件共用；`ReviewAnswers` 在 Task 2 定义，Task 11 使用。
- **Review Focus 对应测试**：路径穿越/并发编辑/用户笔记守卫（Task 3）、YAML 损坏（Task 2）、模型输出非法（Task 9）、错过触发（Task 12）。
