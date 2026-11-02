# 知识库可视化与主题笔记 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把知识库改造成「目录 + 可编辑 markdown 笔记 + 证据/反向链接」三栏页面，笔记独立存储、自动保存，`[[主题名]]` 可在预览中跳转。

**Architecture:** 笔记存放在 `knowledge/notes/<topicId>.md`，与自动生成的主题文件完全分离；主进程新增 `getNote` / `saveNote` / `getBacklinks`，通过 IPC 暴露给渲染进程。渲染层新增 `useKnowledgeNote` 管理加载、草稿、防抖保存和切换竞态，`KnowledgePage` 负责目录与选中状态，笔记与右栏拆成独立组件。

**Tech Stack:** Electron + React 19 + TypeScript strict + Tailwind v4 + Vitest/Testing Library；复用现有 `PageFrame`、`Dialog`、`MarkdownText`、`gray-matter`、`writeFileAtomic`。不新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-02-knowledge-visual-notes-design.md`

## Global Constraints

- 本地优先：不联网、不上传、不加账号；本轮不涉及 API key。
- 不新增依赖或 UI 库；复用现有组件和 Tailwind 样式。
- 所有 vault 写入走 `writeFileAtomic`；文件名/id 用 `assertSafeSegment` 校验。
- 笔记正文逐字节保留；保存时保留未知 frontmatter 键。
- 笔记上限 200,000 字符；自动保存防抖 600ms。
- 目录 260px、右栏 240px、笔记最小约 360px；断点 `md`（768）与 `xl`（1280）。
- 保存状态文案：`未保存` / `保存中…` / `已保存` / `保存失败`。
- 中文 UI 文案；产品功能名不出现 Obsidian 商标。
- 提交信息用 `feat(knowledge): ...` / `test(knowledge): ...` 风格，并以 `Co-Authored-By: Claude Code <noreply@anthropic.com>` 结尾。
- **Pre-flight:** 当前 `master` 工作区有一批未提交的 bug 修复改动，不能丢弃。执行前从当前工作区创建功能分支（如 `feat/knowledge-visual-notes`）或 worktree，带着这些改动继续；不要 `reset`/`clean`。

## Review Focus

1. 保存失败后切换主题再回来：未保存正文必须还在（内存草稿），并且可以重试。
2. 手写笔记缺少 `type`/`kind`、或带 `tags`/`cssclass` 等未知键：仍能读正文，保存后未知键不丢。
3. 快速切换主题时保存与加载交错：旧请求不能覆盖新主题，新主题的反向链接要能看到刚保存的链接。
4. 主题重名/别名冲突：`[[...]]` 不可点击、不产生假反向链接，不能随机跳转。
5. 空正文与 200,000 字符边界：空正文可保存，200,001 字符被拒绝且不写文件。

---

### Task 1: 共享笔记类型与 wiki 链接纯函数

**Files:**
- Modify: `src/shared/knowledge.ts`
- Test: `tests/shared/knowledge.test.ts`

**Interfaces:**
- Consumes: existing `KnowledgeTopic`.
- Produces:
  - `interface KnowledgeNote { topicId: string; body: string; updatedAt: string }`
  - `interface SaveKnowledgeNoteInput { topicId: string; body: string }`
  - `interface KnowledgeBacklink { topicId: string; name: string }`
  - `const MAX_KNOWLEDGE_NOTE_LENGTH = 200_000`
  - `interface WikiLink { target: string; label: string }`
  - `function normalizeKnowledgeTerm(value: string): string`
  - `function parseWikiLink(token: string): WikiLink | null`
  - `function wikiLinkTargets(text: string): string[]`
  - `function resolveKnowledgeLink(topics: KnowledgeTopic[], target: string): KnowledgeTopic | null`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/shared/knowledge.test.ts
import {
  parseWikiLink,
  resolveKnowledgeLink,
  wikiLinkTargets,
  type KnowledgeTopic
} from '../../src/shared/knowledge';

function topic(id: string, name: string, aliases: string[] = []): KnowledgeTopic {
  return {
    id, name, aliases, status: 'learning', summary: '', evidence: [],
    createdAt: '', updatedAt: ''
  };
}

test('extracts wiki link targets and ignores code', () => {
  const text =
    'A [[LangGraph]] B [[LangChain|LC]]\n\n`[[Inline]]`\n\n```md\n[[Fenced]]\n```\n';
  expect(wikiLinkTargets(text)).toEqual(['LangGraph', 'LangChain']);
});

test('parses display labels and rejects malformed tokens', () => {
  expect(parseWikiLink('[[LangChain|LC]]')).toEqual({ target: 'LangChain', label: 'LC' });
  expect(parseWikiLink('[[ LangGraph ]]')).toEqual({ target: 'LangGraph', label: 'LangGraph' });
  expect(parseWikiLink('[[|blank]]')).toBeNull();
  expect(parseWikiLink('[[]]')).toBeNull();
});

test('resolves only a unique name or alias, ignoring case and spacing', () => {
  const topics = [topic('kt-1', 'LangChain'), topic('kt-2', 'Lang Graph', ['LangGraph'])];
  expect(resolveKnowledgeLink(topics, '  langgraph ')?.id).toBe('kt-2');
  expect(resolveKnowledgeLink(topics, 'LC')).toBeNull();
});

test('treats duplicate names or aliases as ambiguous', () => {
  const topics = [topic('kt-1', 'RAG'), topic('kt-2', '检索增强', ['RAG'])];
  expect(resolveKnowledgeLink(topics, 'rag')).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/knowledge.test.ts`

Expected: FAIL — `parseWikiLink`/`wikiLinkTargets`/`resolveKnowledgeLink` are not exported.

- [ ] **Step 3: Implement the types and helpers**

Add to `src/shared/knowledge.ts`. `wikiLinkTargets` must first remove fenced code blocks (lines between ``` fences) and inline code spans (`` `...` ``), then match `/\[\[[^\]\n]+\]\]/g` and run each token through `parseWikiLink`, returning non-null `target`s in source order. `resolveKnowledgeLink` normalizes the target and returns a topic only when exactly one topic has a matching `name` or alias.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/knowledge.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/knowledge.ts tests/shared/knowledge.test.ts
git commit -m "feat(knowledge): add note types and wiki-link helpers"
```

---

### Task 2: 笔记文件解析与序列化（保留未知 frontmatter）

**Files:**
- Create: `src/main/knowledge/notes.ts`
- Test: `tests/main/knowledge-notes.test.ts`

**Interfaces:**
- Consumes: `NoteMeta` from `src/shared/types`, `parseNote` from `src/main/vault/note`, `gray-matter`.
- Produces:
  - `interface KnowledgeNoteFile { topicId: string; title: string; aliases: string[]; body: string; updatedAt: string; meta: NoteMeta }`
  - `function parseKnowledgeNoteFile(raw: string, fallbackTopicId: string): KnowledgeNoteFile`
  - `function serializeKnowledgeNoteFile(file: KnowledgeNoteFile): string`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/main/knowledge-notes.test.ts
import matter from 'gray-matter';
import {
  parseKnowledgeNoteFile,
  serializeKnowledgeNoteFile
} from '../../src/main/knowledge/notes';

test('reads the body verbatim and preserves unknown frontmatter keys', () => {
  const raw = [
    '---',
    'type: note',
    'kind: knowledge-note',
    'topicId: kt-1',
    'title: LangGraph',
    'aliases: [LangGraph]',
    'tags: [ai]',
    'cssclass: wide',
    '---',
    '',
    'line one',
    'line two',
    ''
  ].join('\n');
  const file = parseKnowledgeNoteFile(raw, 'kt-1');
  expect(file.body).toBe('\nline one\nline two\n');

  const out = serializeKnowledgeNoteFile({
    ...file,
    title: 'LangGraph.js',
    aliases: ['LangGraph.js', 'LG'],
    updatedAt: '2026-11-02T10:00:00.000Z'
  });
  const parsed = matter(out);
  expect(parsed.content).toBe('\nline one\nline two\n');
  expect(parsed.data.tags).toEqual(['ai']);
  expect(parsed.data.cssclass).toBe('wide');
  expect(parsed.data.title).toBe('LangGraph.js');
  expect(parsed.data.aliases).toEqual(['LangGraph.js', 'LG']);
});

test('reads hand-written notes without type or kind', () => {
  const file = parseKnowledgeNoteFile('---\ntags: [x]\n---\nbody only', 'kt-9');
  expect(file.topicId).toBe('kt-9');
  expect(file.body).toBe('body only');
  expect(file.meta.tags).toEqual(['x']);
});

test('ignores a forged topicId in frontmatter', () => {
  const file = parseKnowledgeNoteFile('---\nkind: knowledge-note\ntopicId: ../../x\n---\nbody', 'kt-1');
  expect(file.topicId).toBe('kt-1');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/knowledge-notes.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser and serializer**

Use `matter(raw, {})` directly so unknown keys and files without `type` survive. On a parse error, fall back to `parseNote(raw)` for the body and a default meta `{ type: 'note', source: 'user' }`. `topicId` always comes from the path argument, never from frontmatter. `serializeKnowledgeNoteFile` spreads the original `meta`, then overwrites `type/source/kind/topicId/title/aliases/updated`, and calls `serializeNote(meta, body)` so the body is untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/knowledge-notes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/knowledge/notes.ts tests/main/knowledge-notes.test.ts
git commit -m "feat(knowledge): parse and serialize per-topic note files"
```

---

### Task 3: 服务层读取/保存笔记、删除级联、改名同步

**Files:**
- Modify: `src/main/workspace/paths.ts`
- Modify: `src/shared/knowledge.ts` (extend `KnowledgeService`)
- Modify: `src/main/knowledge/create-knowledge-service.ts`
- Modify: `tests/main/butler-tools.test.ts` (knowledge stub)
- Test: `tests/main/knowledge-service.test.ts`

**Interfaces:**
- Consumes: Task 1 types/constants, Task 2 parser/serializer, existing `assertSafeSegment`, `writeFileAtomic`, `readFileOrNull`, `knowledgeTopicFile`.
- Produces:
  - `function knowledgeNotesDir(root: string): string`
  - `function knowledgeNoteFile(root: string, topicId: string): string`
  - `KnowledgeService.getNote(topicId: string): Promise<KnowledgeNote>`
  - `KnowledgeService.saveNote(input: SaveKnowledgeNoteInput): Promise<KnowledgeNote>`

- [ ] **Step 1: Write the failing tests**

Add to `tests/main/knowledge-service.test.ts` (reuse its temp-vault setup):

```ts
test('saves and reads a note without touching the topic body', async () => {
  const topic = await service.create({ name: 'LangGraph' });
  const topicBefore = await readFile(knowledgeTopicFile(dir, topic.id), 'utf8');

  const saved = await service.saveNote({ topicId: topic.id, body: '# hi\n\n[[LangChain]]' });
  expect(saved.body).toBe('# hi\n\n[[LangChain]]');
  expect(await service.getNote(topic.id)).toMatchObject({ body: '# hi\n\n[[LangChain]]' });

  const noteRaw = await readFile(join(dir, 'knowledge', 'notes', `${topic.id}.md`), 'utf8');
  expect(noteRaw).toContain('kind: knowledge-note');
  expect(noteRaw).toContain('[[LangChain]]');
  expect(await readFile(knowledgeTopicFile(dir, topic.id), 'utf8')).toBe(topicBefore);
});

test('keeps hand-added frontmatter keys when saving', async () => { /* write a note with tags, save, parse back, expect tags */ });
test('accepts empty and 200000-character bodies, rejects 200001', async () => { /* ... */ });
test('rejects saving to a missing topic', async () => { /* expect /知识主题不存在/ */ });
test('deleting a topic removes its note file', async () => { /* ... */ });
test('renaming a topic updates note frontmatter but not its body', async () => { /* ... */ });
test('getNote returns an empty body for missing or unsafe ids', async () => { /* ... */ });
```

Also update `knowledgeStub` in `tests/main/butler-tools.test.ts` with:

```ts
getNote: async (topicId) => ({ topicId, body: '', updatedAt: '' }),
saveNote: async (input) => ({ ...input, updatedAt: '' }),
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/knowledge-service.test.ts`

Expected: FAIL — `service.saveNote` is not a function.

- [ ] **Step 3: Implement**

- Add `knowledgeNotesDir(root)` / `knowledgeNoteFile(root, topicId)` in `paths.ts` and update the vault layout comment.
- Extend `KnowledgeService` in `src/shared/knowledge.ts`.
- In `create-knowledge-service.ts`:
  - `readNote(topicId)` returns `{ topicId, body: '', updatedAt: '' }` for unsafe/missing files; otherwise parse via `parseKnowledgeNoteFile`.
  - `saveNote` validates `topicId` with `assertSafeSegment`, `body` is a string ≤ `MAX_KNOWLEDGE_NOTE_LENGTH`, and the topic exists; inside `runExclusively`, read the existing raw note for its `meta`, set `updatedAt = now().toISOString()`, serialize with the topic's current `name`/`aliases`, write atomically, return `{ topicId, body, updatedAt }`.
  - `delete` removes the note file after the topic file (ignore note-removal errors).
  - `update` records whether name or aliases changed; after `writeTopic(next)`, call a best-effort `syncNoteMeta(next)` that rewrites only title/aliases (same body and updatedAt). Never let note sync failure fail the topic update.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/knowledge-service.test.ts tests/main/butler-tools.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/workspace/paths.ts src/shared/knowledge.ts src/main/knowledge/create-knowledge-service.ts tests/main/knowledge-service.test.ts tests/main/butler-tools.test.ts
git commit -m "feat(knowledge): read and save per-topic notes in the vault"
```

---

### Task 4: 反向链接计算

**Files:**
- Modify: `src/shared/knowledge.ts` (extend `KnowledgeService`)
- Modify: `src/main/knowledge/create-knowledge-service.ts`
- Modify: `tests/main/butler-tools.test.ts` (stub `getBacklinks`)
- Test: `tests/main/knowledge-service.test.ts`

**Interfaces:**
- Consumes: Task 1 `wikiLinkTargets` / `resolveKnowledgeLink`, Task 3 `getNote`.
- Produces: `KnowledgeService.getBacklinks(topicId: string): Promise<KnowledgeBacklink[]>`

- [ ] **Step 1: Write the failing tests**

```ts
test('lists topics whose notes link to the target', async () => {
  const target = await service.create({ name: 'LangChain' });
  const source = await service.create({ name: 'LangGraph' });
  await service.saveNote({ topicId: source.id, body: '相关 [[LangChain]]' });
  expect(await service.getBacklinks(target.id)).toEqual([
    { topicId: source.id, name: 'LangGraph' }
  ]);
});

test('ignores links inside code and ambiguous aliases', async () => {
  const target = await service.create({ name: 'RAG' });
  await service.create({ name: '检索增强', aliases: ['RAG'] }); // makes RAG ambiguous
  const source = await service.create({ name: 'Source' });
  await service.saveNote({ topicId: source.id, body: '`[[RAG]]`\n```\n[[RAG]]\n```' });
  expect(await service.getBacklinks(target.id)).toEqual([]);
});

test('ignores self-links and broken note files', async () => {
  const topic = await service.create({ name: 'LangGraph' });
  await service.saveNote({ topicId: topic.id, body: '[[LangGraph]]' });
  expect(await service.getBacklinks(topic.id)).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/knowledge-service.test.ts`

Expected: FAIL — `service.getBacklinks` is not a function.

- [ ] **Step 3: Implement**

Add `getBacklinks` to the interface and service. Read the target topic (return `[]` if missing); list all topics; for each other topic read its note, extract `wikiLinkTargets`, and include the source when any target uniquely resolves to the requested topic. Swallow per-note read errors, dedupe by topic id, sort by `name` using `localeCompare(..., 'zh')`. Update the butler stub with `getBacklinks: async () => []`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/knowledge-service.test.ts tests/main/butler-tools.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/knowledge.ts src/main/knowledge/create-knowledge-service.ts tests/main/knowledge-service.test.ts tests/main/butler-tools.test.ts
git commit -m "feat(knowledge): compute backlinks from note wiki links"
```

---

### Task 5: IPC、桥接与 mock API

**Files:**
- Modify: `src/shared/knowledge.ts` (extend `KnowledgeApi`)
- Modify: `src/main/ipc.ts`
- Modify: `src/main/context.ts` (delegate three methods)
- Modify: `web/mock-api.ts`
- Test: `tests/main/ipc-knowledge.test.ts`
- Test: `tests/main/ipc-handlers.test.ts`
- Test: `tests/web/mock-api.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4 service methods, Task 1 types/constant.
- Produces on `KnowledgeApi`:
  - `getKnowledgeNote(topicId: string): Promise<KnowledgeNote>`
  - `saveKnowledgeNote(input: SaveKnowledgeNoteInput): Promise<KnowledgeNote>`
  - `getKnowledgeBacklinks(topicId: string): Promise<KnowledgeBacklink[]>`
- Channels: `study-coach:knowledge:note:get`, `study-coach:knowledge:note:save`, `study-coach:knowledge:backlinks`.

- [ ] **Step 1: Write the failing tests**

In `tests/main/ipc-knowledge.test.ts`, extend `fakeApi` with the three methods (recording calls), then:

```ts
await handlers.getKnowledgeNote('kt-1');
await handlers.saveKnowledgeNote({ topicId: 'kt-1', body: '' });
await handlers.getKnowledgeBacklinks('kt-1');
expect(calls).toContainEqual(['note-get', 'kt-1']);
expect(calls).toContainEqual(['note-save', { topicId: 'kt-1', body: '' }]);
expect(calls).toContainEqual(['backlinks', 'kt-1']);

await expect(handlers.getKnowledgeNote('  ')).rejects.toThrow(/知识主题 ID/);
await expect(handlers.saveKnowledgeNote({ topicId: 'kt-1', body: 42 })).rejects.toThrow(/笔记内容/);
await expect(
  handlers.saveKnowledgeNote({ topicId: 'kt-1', body: 'x'.repeat(200_001) })
).rejects.toThrow(/200000/);
```

In `tests/web/mock-api.test.ts`, add a test that `saveKnowledgeNote` + `getKnowledgeNote` survive a `createMockApi` reload using the same localStorage, and that `getKnowledgeBacklinks` reflects a `[[...]]` link.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/main/ipc-knowledge.test.ts tests/web/mock-api.test.ts`

Expected: FAIL — handlers/methods missing.

- [ ] **Step 3: Implement**

- Add channel entries and `createIpcHandlers` cases. Add `requireSaveKnowledgeNote` using `requireObject`, `requireString` for `topicId`, a raw `typeof body === 'string'` check (empty is valid), and the length limit.
- Add bridge methods in `createStudyCoachBridge`.
- Add `context.ts` delegations to `(await getServices()).knowledge`.
- Extend `web/mock-api.ts` state with `knowledgeNotes: Record<string, KnowledgeNote>` (default `{}` on load), and implement the three methods using Task 1 helpers for backlinks. Persist after save.
- No preload change is needed: `src/preload/index.ts` exposes the whole bridge.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/main/ipc-knowledge.test.ts tests/main/ipc-handlers.test.ts tests/web/mock-api.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/knowledge.ts src/main/ipc.ts src/main/context.ts web/mock-api.ts tests/main/ipc-knowledge.test.ts tests/main/ipc-handlers.test.ts tests/web/mock-api.test.ts
git commit -m "feat(knowledge): expose note and backlink APIs over IPC"
```

---

### Task 6: MarkdownText 支持可选 wiki 链接

**Files:**
- Modify: `src/renderer/shell/MarkdownText.tsx`
- Test: `tests/renderer/markdown-text.test.tsx`

**Interfaces:**
- Consumes: Task 1 `parseWikiLink`.
- Produces:
  - `MarkdownTextProps.resolveWikiLink?: (target: string) => { id: string } | null`
  - `MarkdownTextProps.onWikiLink?: (id: string) => void`

- [ ] **Step 1: Write the failing tests**

```tsx
test('renders wiki links as buttons when a resolver is provided', async () => {
  const onWikiLink = vi.fn();
  render(
    <MarkdownText
      text="相关 [[LangChain|LC]] 和 [[Missing]]"
      resolveWikiLink={(target) => (target === 'LangChain' ? { id: 'kt-1' } : null)}
      onWikiLink={onWikiLink}
    />
  );
  await userEvent.click(screen.getByRole('button', { name: '打开知识主题 LangChain' }));
  expect(onWikiLink).toHaveBeenCalledWith('kt-1');
  expect(screen.getByText('Missing')).toHaveAttribute('title', '没有这个知识点');
  expect(screen.queryByRole('button', { name: /Missing/ })).not.toBeInTheDocument();
});

test('keeps wiki syntax literal without a resolver', () => {
  render(<MarkdownText text="相关 [[LangChain]]" />);
  expect(screen.getByText('相关 [[LangChain]]')).toBeInTheDocument();
});

test('does not parse wiki links inside code', () => {
  render(<MarkdownText text={'`[[A]]`\n\n```\n[[B]]\n```'} resolveWikiLink={() => ({ id: 'x' })} onWikiLink={vi.fn()} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/markdown-text.test.tsx`

Expected: FAIL — no wiki-link button / literal behavior.

- [ ] **Step 3: Implement**

Extend the inline token regex with `\[\[[^\]\n]+\]\]`. When the token starts with `[[`, call `parseWikiLink`; if both callbacks exist and `resolveWikiLink(target)` returns an id, render a `<button type="button">` with `aria-label={`打开知识主题 ${target}`}` and the parsed label. If unresolved, render a `<span title="没有这个知识点">` with a dashed bottom border. If no resolver is provided, push the raw token text exactly as before.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/markdown-text.test.tsx`

Expected: PASS, including the existing chat rendering tests.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shell/MarkdownText.tsx tests/renderer/markdown-text.test.tsx
git commit -m "feat(knowledge): render wiki links in markdown previews"
```

---

### Task 7: `useKnowledgeNote` 加载、草稿、防抖与切换竞态

**Files:**
- Create: `src/renderer/shell/useKnowledgeNote.ts`
- Test: `tests/renderer/use-knowledge-note.test.tsx`

**Interfaces:**
- Consumes: `KnowledgeNote`, `SaveKnowledgeNoteInput`, `KnowledgeBacklink`, `friendlyErrorMessage`.
- Produces:

```ts
export type KnowledgeNoteStatus = 'loading' | 'dirty' | 'saving' | 'saved' | 'error';

export function useKnowledgeNote(options: {
  topicId: string;
  getNote(topicId: string): Promise<KnowledgeNote>;
  saveNote(input: SaveKnowledgeNoteInput): Promise<KnowledgeNote>;
  getBacklinks(topicId: string): Promise<KnowledgeBacklink[]>;
  debounceMs?: number; // default 600
}): {
  body: string;
  status: KnowledgeNoteStatus;
  error: string | null;      // save failure
  loadError: string | null;  // note load failure
  backlinks: KnowledgeBacklink[];
  backlinksError: string | null;
  setBody(body: string): void;
  flush(): Promise<void>;
  retrySave(): Promise<void>;
  reloadNote(): Promise<void>;
  reloadBacklinks(): Promise<void>;
};
```

- [ ] **Step 1: Write the failing tests**

Use `renderHook`/`act` from `@testing-library/react` and `vi.useFakeTimers()`. Include these five behaviors:

```tsx
test('loads the note and backlinks for the selected topic', async () => {
  // getNote -> { body: 'disk', ... }; getBacklinks -> [{ topicId: 'kt-2', name: 'B' }]
  // expect body 'disk', status 'saved', backlinks length 1
});

test('debounces typing and saves once with the latest body', async () => {
  // setBody('a'); setBody('ab'); advance 599ms -> no save; advance 1ms -> save({ body: 'ab' })
  // status 'saving' then 'saved'
});

test('switching topics awaits the previous save before loading the new note', async () => {
  // saveNote returns a deferred; rerender with topic B
  // expect getNote(B) not called until the deferred resolves
});

test('keeps an unsaved draft when saving fails and restores it on return', async () => {
  // saveNote rejects; switch to B then back to A
  // body is still the draft; status 'error'
});

test('shows and retries a note load failure', async () => {
  // getNote rejects once, then resolves; expect loadError and reloadNote() recovers
});

test('ignores a stale load that resolves after switching topics', async () => {
  // getNote(A) deferred; switch to B; resolve B; resolve A late; body stays B
});
```

Also test: unchanged body does not call `saveNote`; `flush()` saves immediately; unmount triggers a best-effort flush.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/use-knowledge-note.test.tsx`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Store API callbacks in a ref so the main effect depends only on `topicId`. Keep `bodyRef`, `savedBodyRef`, `topicRef`, a `Map<topicId, string>` draft ref, a failed-save set, and a request token.

On `topicId` change: capture the previous topic/body; if the previous body differs from its saved body, `await saveNote` for the previous topic (catch and keep its draft); then load the new topic. Loading prefers the draft map; otherwise call `getNote`, and after it resolves call `getBacklinks` (same token). Apply results only if the token is current. A `getNote` failure sets `loadError` (friendly message), clears the body, and leaves the topic header usable; `reloadNote` retries the current topic. Typing updates body + draft and sets `dirty`; a 600ms timer calls save. Save success updates `savedBody`, deletes the draft, clears the error, sets `saved`; failure keeps the draft, sets `error` with `friendlyErrorMessage`. `flush` clears the timer and saves when dirty; `retrySave` saves immediately; `reloadBacklinks` re-fetches for the current topic. On unmount, call `void flush()` as a best-effort save (no async cleanup).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/use-knowledge-note.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shell/useKnowledgeNote.ts tests/renderer/use-knowledge-note.test.tsx
git commit -m "feat(knowledge): manage note drafts and autosave in a hook"
```

---

### Task 8: 笔记面板、右栏与共享样式常量

**Files:**
- Create: `src/renderer/shell/knowledge-ui.ts`
- Create: `src/renderer/shell/KnowledgeNotePane.tsx`
- Create: `src/renderer/shell/KnowledgeSidePanel.tsx`
- Test: `tests/renderer/knowledge-note-pane.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 6, 7.
- Produces:
  - `knowledge-ui.ts`: `STATUS_LABELS`, `STATUS_DOT_CLASS`（mastered 绿 / learning 蓝 / planned 灰 / paused 橙）、`evidenceDate(date: string): string`、`workspaceName(workspaces, workspaceId): string`（无 id 返回「全局」），从现有 `KnowledgePage.tsx` 搬过去。
  - `KnowledgeNotePane` props:

```ts
type KnowledgeNotePaneProps = {
  topic: KnowledgeTopic;
  topics: KnowledgeTopic[];
  workspaceLabel: string;
  getNote(topicId: string): Promise<KnowledgeNote>;
  saveNote(input: SaveKnowledgeNoteInput): Promise<KnowledgeNote>;
  getBacklinks(topicId: string): Promise<KnowledgeBacklink[]>;
  onOpenTopic(topicId: string): void;
  onEdit(): void;
  onDelete(): void;
  onBack?(): void;
};
```

- [ ] **Step 1: Write the failing tests**

```tsx
test('loads the note and switches between edit and preview', async () => {
  // getNote resolves '# LangGraph\n\n正文'; expect textarea value
  // click 预览; expect heading/paragraph text, not a textarea
});

test('saves on Cmd+S and shows the saved status', async () => {
  // type into 知识笔记; press Meta+S / Ctrl+S
  // expect saveNote called with the typed body; findByText('已保存')
});

test('opens a resolved wiki link and renders unresolved ones inert', async () => {
  // preview body '[[LangChain]] [[Missing]]'
  // click 打开知识主题 LangChain -> onOpenTopic('kt-1')
  // Missing has title 没有这个知识点 and is not a button
});

test('renders evidence and backlinks and opens a backlink target', async () => {
  // evidence title visible; click 打开知识主题 LangGraph -> onOpenTopic
});

test('shows a save error with retry', async () => {
  // saveNote rejects; expect 保存失败 and 重试保存; retry resolves -> 已保存
});

test('shows a load error with retry while keeping the topic header', async () => {
  // getNote rejects; expect 笔记加载失败。 and 重试加载; header still shows the topic name
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/knowledge-note-pane.test.tsx`

Expected: FAIL — components not found.

- [ ] **Step 3: Implement**

`KnowledgeNotePane` renders the topic header (name, status pill, level, workspace, summary subtitle, 编辑/删除, mobile back button), the `编辑`/`预览` toggle, the autosave status (`role="status"`: `未保存` / `保存中…` / `已保存` / `保存失败`), the `<textarea aria-label="知识笔记">` or `MarkdownText`, and the side panel. Empty note preview shows `还没有笔记。点「编辑」开始写。`. While loading, the editor area shows `加载中…`. A load failure shows `笔记加载失败。` inside the editor area with a `重试加载` button (calls `reloadNote`) while the header stays usable. Use `useKnowledgeNote`; wire `onBlur`, switching to 预览, and Cmd/Ctrl+S to `flush`. The preview resolver uses `resolveKnowledgeLink(topics, target)`.

`KnowledgeSidePanel` renders `证据 {n} 条` (reverse chronological, newest first) and `反向链接 {n} 条`; empty states `还没有证据。` / `还没有反向链接。`; a backlinks error shows `反向链接暂时不可用。` with a reload button. Backlink buttons use `aria-label={`打开知识主题 ${name}`}`. Place the note and panel in one flex/grid container so there is **one** DOM instance of the panel: at `xl+` it is a 240px right column; below `xl` it sits under the note inside a `<details open>` whose `<summary className="xl:hidden">` reads `证据与反向链接` (so it is collapsible on narrow windows).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/knowledge-note-pane.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/shell/knowledge-ui.ts src/renderer/shell/KnowledgeNotePane.tsx src/renderer/shell/KnowledgeSidePanel.tsx tests/renderer/knowledge-note-pane.test.tsx
git commit -m "feat(knowledge): add note editor and evidence sidebar"
```

---

### Task 9: 知识库页面改为目录 + 内容，接通数据层

**Files:**
- Modify: `src/renderer/shell/PageFrame.tsx`
- Modify: `src/renderer/shell/useWorkspaceData.ts`
- Modify: `src/renderer/shell/Workspace.tsx`
- Modify: `src/renderer/shell/KnowledgePage.tsx`
- Test: `tests/renderer/knowledge-page.test.tsx`
- Test: `tests/renderer/chat-knowledge-refresh.test.tsx`

**Interfaces:**
- Consumes: Tasks 3–8.
- Produces:
  - `PageFrameProps.fill?: boolean`
  - `useWorkspaceData` adds `getKnowledgeNote`, `saveKnowledgeNote`, `getKnowledgeBacklinks` (same signatures as `KnowledgeApi`).
  - `KnowledgePage` props add the same three functions.

- [ ] **Step 1: Write the failing tests**

Rewrite `tests/renderer/knowledge-page.test.tsx` around the new layout. Its `renderPage` passes `getKnowledgeNote`, `saveKnowledgeNote`, `getKnowledgeBacklinks` mocks. Cover:

```tsx
test('groups topics by workspace with the global group last');
test('search filters the directory but keeps the selected topic visible');
test('selects the first topic and renders its note');
test('clicking a wiki link clears the search and selects the target');
test('creates a topic and selects it', async () => {
  // render with a stateful wrapper whose onCreateTopic prepends the new topic
  // to the topics prop; after saving, expect the note pane for kt-new
});
test('edits a topic through the dialog');
test('deletes a topic after confirmation and selects the next one');
test('shows 没有匹配的主题 when the search matches nothing');
```

Update `tests/renderer/chat-knowledge-refresh.test.tsx`: after navigating to 知识库, wait for the auto-selected topic and assert `证据 1 条` (the side panel header) and the evidence title, rather than the old card expansion.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/knowledge-page.test.tsx tests/renderer/chat-knowledge-refresh.test.tsx`

Expected: FAIL — new props/components/selectors missing.

- [ ] **Step 3: Implement**

- `PageFrame`: when `fill` is true, render children directly inside `<div className="min-h-0 flex-1 overflow-hidden">` with no padding/max-width.
- `useWorkspaceData`: add the three passthroughs via `apiOrThrow()` and include them in `WorkspaceData`/the return object.
- `Workspace`: pass them to `KnowledgePage`.
- `KnowledgePage`: use `PageFrame fill` with an inner `mx-auto flex h-full w-full max-w-[1160px]`. Implement directory (260px, grouped by workspace, global group last, status dots, search over name/alias/summary, stats), selection + `mobilePane` state, content pane with `KnowledgeNotePane`, empty states, and keep the existing create/edit/delete `Dialog`. Empty copy: no topics → `还没有知识主题。完成学习任务、写笔记，或对阿咲说“今天学了 X”。`; search misses → `没有匹配的主题。`. Auto-select the first topic when the current id disappears; do not change selection when only the search hides it. Track previously seen topic ids in a ref: a selected id that was seen before and is now missing means deletion → select the first; a selected id that has never been seen (just created) means wait for the parent's topics prop, do not fall back. On a wiki-link jump, clear the query and select the target. On create, select the returned topic and clear the query. Remove the old workspace filter `<select>`. On mobile, `mobilePane` starts as `list`; selecting a topic switches to `note`; the pane's back button returns to `list`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/knowledge-page.test.tsx tests/renderer/chat-knowledge-refresh.test.tsx tests/renderer/navigation.test.tsx`

Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/shell/PageFrame.tsx src/renderer/shell/useWorkspaceData.ts src/renderer/shell/Workspace.tsx src/renderer/shell/KnowledgePage.tsx tests/renderer/knowledge-page.test.tsx tests/renderer/chat-knowledge-refresh.test.tsx
git commit -m "feat(knowledge): replace the card list with a directory and note pane"
```

---

### Task 10: 端到端验证、文档与最终检查

**Files:**
- Modify: `e2e/desktop.spec.ts`
- Modify: `README.md`
- Verify: whole repo

**Interfaces:**
- Consumes: all previous tasks.
- Produces: no new API.

- [ ] **Step 1: Update the e2e knowledge step**

After creating `LangChain`, assert the note pane is visible via `getByLabel('知识笔记')`, type `会搭 AgentExecutor`, trigger save (blur or `Meta+S`), expect `已保存`, then read `knowledge/notes` and assert one `.md` contains the typed text. Replace the ambiguous `getByText('在学', { exact: true })` assertion with a scoped locator (e.g. the directory button `打开知识主题 LangChain`).

- [ ] **Step 2: Update README**

Add one short line under the knowledge-base section: 每个主题有一篇可编辑笔记，存放在 `knowledge/notes/`，支持 `[[主题名]]` 跳转与反向链接。

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: all files/tests pass; no unhandled errors.

- [ ] **Step 4: Run typechecks and build**

Run: `npm run typecheck && npm run typecheck:e2e && npm run build`

Expected: all exit 0.

- [ ] **Step 5: Run the desktop e2e**

Run: `npm run test:e2e`

Expected: PASS. If the environment cannot launch Electron, report the exact failure and do not claim it passed.

- [ ] **Step 6: Commit**

```bash
git add e2e/desktop.spec.ts README.md
git commit -m "test(knowledge): cover note editing in the desktop flow"
```

---

## Self-Review

- **Spec coverage:** layout (Task 9), note storage (Tasks 2–3), autosave/drafts (Task 7), wiki links (Tasks 1, 6, 8), backlinks (Tasks 4, 8), IPC (Task 5), search/selection (Task 9), responsive (Tasks 8–9), unknown frontmatter (Task 2), code-block link exclusion (Tasks 1, 4), delete/rename (Task 3), e2e/docs (Task 10). No gaps found.
- **Step scan:** each task has a failing test, a run, an implementation step with exact signatures, a passing run, and a commit. Test bodies are given for non-obvious cases; straightforward CRUD tests are named with their assertions.
- **Type consistency:** `KnowledgeNote` / `SaveKnowledgeNoteInput` / `KnowledgeBacklink` / `MAX_KNOWLEDGE_NOTE_LENGTH` / `resolveKnowledgeLink` are defined once in Task 1 and referenced by name thereafter. `KnowledgeService` methods are added in Tasks 3–4; `KnowledgeApi` in Task 5; renderer props in Tasks 8–9.
- **Review Focus:** each of the five risks has a named test in Tasks 7, 2, 7, 1/4, and 3/5 respectively.
