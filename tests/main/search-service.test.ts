import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSearchService,
  type VaultFileEvent,
  type VaultWatcherHandlers,
  type WatcherFactory
} from '../../src/main/search';
import type { SearchService } from '../../src/shared/search';
import type { WorkspaceService } from '../../src/shared/workspace';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import { createPracticeService } from '../../src/main/practice';
import { writeFileAtomic } from '../../src/main/workspace/fs-utils';
import { serializeNoteFile, type NoteRecord } from '../../src/main/workspace/records/notes';
import { serializeTaskFile, type TaskRecord } from '../../src/main/workspace/records/tasks';
import { serializeLongPlanFile } from '../../src/main/plans/records';
import { serializeKnowledgeTopicFile } from '../../src/main/knowledge/records';
import type { LongPlan } from '../../src/shared/plans';
import type { KnowledgeTopic } from '../../src/shared/knowledge';

/** Test double: records the registered handlers so tests push events synchronously. */
function createFakeWatcher() {
  let handlers: VaultWatcherHandlers | null = null;
  let closeCount = 0;
  const factory: WatcherFactory = (_vaultRoot, registered) => {
    handlers = registered;
    return {
      close: async () => {
        closeCount += 1;
      }
    };
  };
  return {
    factory,
    emit(event: VaultFileEvent, absPath: string): void {
      handlers?.onFileEvent(event, absPath);
    },
    fail(error: unknown): void {
      handlers?.onError(error);
    },
    closeCount: () => closeCount
  };
}

type FakeWatcher = ReturnType<typeof createFakeWatcher>;

function noteRecord(id: string, title: string, body: string): NoteRecord {
  const now = '2026-11-01T08:00:00.000Z';
  return {
    id,
    title,
    subject: '检索',
    tags: [],
    summary: '',
    body,
    related: [],
    source: 'user',
    created: now,
    updated: now
  };
}

const UNIQUE = '独门检索词';

let root: string;
const services: SearchService[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'search-service-'));
  services.length = 0;
});

afterEach(async () => {
  for (const service of services) await service.dispose();
  await rm(root, { recursive: true, force: true });
});

async function seedVault(): Promise<WorkspaceService> {
  const ws = createWorkspaceService(root);
  await ws.listWorkspaces(); // triggers demo-vault seeding
  return ws;
}

function startService(fake: FakeWatcher = createFakeWatcher()): { service: SearchService; fake: FakeWatcher } {
  const service = createSearchService({
    workspaceService: createWorkspaceService(root),
    vaultRoot: root,
    debounceMs: 10,
    watcherFactory: fake.factory
  });
  services.push(service);
  return { service, fake };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('indexes seeded notes at startup and returns typed results', async () => {
  await seedVault();
  const { service } = startService();
  const hits = await service.search('kaoyan', '洛必达');
  expect(hits.length).toBeGreaterThan(0);
  for (const hit of hits) {
    expect(hit.workspaceId).toBe('kaoyan');
    expect(hit.kind).toBe('note');
    expect(hit.path.startsWith('workspaces/kaoyan/')).toBe(true);
    expect(hit.score).toBeGreaterThan(0);
    expect(typeof hit.docId).toBe('string');
    expect(hit.snippet.length).toBeGreaterThan(0);
  }
  expect(hits.some((hit) => hit.docId === 'n4')).toBe(true);
});

test('covers workspace, task and memory kinds', async () => {
  await seedVault();
  const { service } = startService();
  expect((await service.search('kaoyan', '数学一')).some((hit) => hit.kind === 'workspace')).toBe(true);
  const taskHits = await service.search('kaoyan', '极限与连续');
  expect(taskHits[0]).toMatchObject({ docId: 'k1', kind: 'task' });
  expect((await service.search('kaoyan', '长难句主干')).some((hit) => hit.kind === 'memory' && hit.docId === 'm2')).toBe(true);
  expect((await service.search('english', 'poised')).some((hit) => hit.kind === 'note' && hit.docId === 'n5')).toBe(true);
});

test('searches are scoped to the requested workspace', async () => {
  await seedVault();
  const { service } = startService();
  expect(await service.search('kaoyan', 'poised')).toEqual([]);
  expect((await service.search('english', 'poised')).length).toBeGreaterThan(0);
});

test('handles limits, empty queries and invalid workspace ids', async () => {
  await seedVault();
  const { service } = startService();
  expect((await service.search('kaoyan', '极限', 2)).length).toBeLessThanOrEqual(2);
  expect(await service.search('kaoyan', '')).toEqual([]);
  expect(await service.search('kaoyan', '   ')).toEqual([]);
  expect(await service.search('kaoyan', '极限', 0)).toEqual([]);
  await expect(service.search('../evil', '极限')).rejects.toThrow('Invalid workspace id');
});

test('indexes new files from watcher add events', async () => {
  const ws = await seedVault();
  const { service, fake } = startService();
  await service.search('kaoyan', '考研'); // readiness barrier: watcher is up
  const note = await ws.createNote({
    workspaceId: 'kaoyan',
    title: '搜索测试笔记',
    subject: '检索',
    body: `全库检索应该能找到这条${UNIQUE}。`
  });
  fake.emit('add', join(root, note.path as string));
  await vi.waitFor(
    async () => {
      const hits = await service.search('kaoyan', '搜索测试');
      expect(hits.some((hit) => hit.docId === note.id)).toBe(true);
    },
    { timeout: 2000, interval: 10 }
  );
});

test('re-indexes changed files and drops stale terms', async () => {
  const ws = await seedVault();
  const { service, fake } = startService();
  await service.search('kaoyan', '考研');
  const note = await ws.createNote({
    workspaceId: 'kaoyan',
    title: '搜索测试笔记',
    subject: '检索',
    body: `初版内容${UNIQUE}`
  });
  const abs = join(root, note.path as string);
  fake.emit('add', abs);
  await vi.waitFor(
    async () => {
      expect((await service.search('kaoyan', '搜索测试')).some((hit) => hit.docId === note.id)).toBe(true);
    },
    { timeout: 2000, interval: 10 }
  );

  const revised = noteRecord(note.id, '二次修订标题', '修订后的独特内容');
  await writeFileAtomic(abs, serializeNoteFile(revised));
  fake.emit('change', abs);
  await vi.waitFor(
    async () => {
      const stale = await service.search('kaoyan', '搜索测试');
      const fresh = await service.search('kaoyan', '二次修订');
      expect(stale.some((hit) => hit.docId === note.id)).toBe(false);
      expect(fresh.some((hit) => hit.docId === note.id)).toBe(true);
    },
    { timeout: 2000, interval: 10 }
  );
});

test('removes documents on unlink events', async () => {
  const ws = await seedVault();
  const { service, fake } = startService();
  await service.search('kaoyan', '考研');
  const note = await ws.createNote({
    workspaceId: 'kaoyan',
    title: '删除目标笔记',
    subject: '检索',
    body: `删除后应当消失${UNIQUE}`
  });
  const abs = join(root, note.path as string);
  fake.emit('add', abs);
  await vi.waitFor(
    async () => {
      expect((await service.search('kaoyan', '删除目标')).length).toBeGreaterThan(0);
    },
    { timeout: 2000, interval: 10 }
  );
  await fs.rm(abs);
  fake.emit('unlink', abs);
  await vi.waitFor(
    async () => {
      expect(await service.search('kaoyan', '删除目标')).toEqual([]);
    },
    { timeout: 2000, interval: 10 }
  );
});

test('drops all docs under a directory on unlinkDir, rescans on addDir', async () => {
  const ws = await seedVault();
  const notesDir = join(root, 'workspaces', 'kaoyan', 'notes');
  const { service, fake } = startService();
  await service.search('kaoyan', '考研');
  const note = await ws.createNote({
    workspaceId: 'kaoyan',
    title: '目录内笔记',
    subject: '检索',
    body: `目录删除测试${UNIQUE}`
  });
  fake.emit('add', join(root, note.path as string));
  await vi.waitFor(
    async () => {
      expect((await service.search('kaoyan', '目录删除测试')).length).toBeGreaterThan(0);
    },
    { timeout: 2000, interval: 10 }
  );

  await fs.rm(notesDir, { recursive: true, force: true });
  fake.emit('unlinkDir', notesDir);
  await vi.waitFor(
    async () => {
      expect(await service.search('kaoyan', '目录删除测试')).toEqual([]);
    },
    { timeout: 2000, interval: 10 }
  );

  await fs.mkdir(notesDir, { recursive: true });
  const rebuilt = noteRecord('rebuilt-1', '重建笔记', '目录重建后的新内容');
  await writeFileAtomic(join(notesDir, 'rebuilt.md'), serializeNoteFile(rebuilt));
  fake.emit('addDir', notesDir);
  await vi.waitFor(
    async () => {
      expect((await service.search('kaoyan', '重建笔记')).some((hit) => hit.docId === 'rebuilt-1')).toBe(true);
    },
    { timeout: 2000, interval: 10 }
  );
});

test('rebuild() picks up cold changes and drops deleted files', async () => {
  await seedVault();
  const { service } = startService();
  expect((await service.search('kaoyan', '冷启动独门任务')).length).toBe(0);
  const tasks: TaskRecord[] = [
    {
      id: 'cold-1',
      title: '冷启动独门任务',
      subject: '数学',
      durationMin: 30,
      materialRefs: [],
      acceptance: '直接写盘，不走服务',
      status: 'pending'
    }
  ];
  const taskFile = join(root, 'workspaces', 'kaoyan', 'tasks', '2026-05-01.md');
  await writeFileAtomic(taskFile, serializeTaskFile('2026-05-01', tasks));
  expect((await service.search('kaoyan', '冷启动独门任务')).length).toBe(0);
  await service.rebuild();
  expect((await service.search('kaoyan', '冷启动独门任务')).some((hit) => hit.docId === 'cold-1')).toBe(true);

  await fs.rm(taskFile);
  await service.rebuild();
  expect(await service.search('kaoyan', '冷启动独门任务')).toEqual([]);
});

test('indexes practice records and reviews', async () => {
  const ws = await seedVault();
  const practice = createPracticeService(root);
  await practice.listSets('kaoyan'); // writes seed sets into the vault
  const set = await practice.getSet('ps1');
  expect(set).not.toBeNull();
  const first = set?.questions[0];
  expect(first).toBeDefined();
  // A wrong answer records a mistake (practice-mistake doc).
  await practice.submitAnswer({ questionId: first?.id as string, choice: ((first?.answer ?? 0) + 1) % (first?.options.length ?? 2) });
  await ws.submitReview({
    date: '2026-11-01',
    workspaceId: 'kaoyan',
    answers: { completed: '复盘独门完成项', stuck: '卡在极限', tomorrow: '做题' }
  });

  const { service } = startService();
  const questionHits = await service.search('kaoyan', '未定式');
  expect(questionHits.some((hit) => hit.kind === 'practice-question' && hit.docId === 'q2')).toBe(true);
  expect(questionHits.some((hit) => hit.kind === 'practice-set' && hit.docId === 'ps1')).toBe(true);
  expect((await service.search('kaoyan', 'sin')).some((hit) => hit.kind === 'practice-mistake')).toBe(true);
  const reviewHits = await service.search('kaoyan', '复盘独门完成项');
  expect(reviewHits.some((hit) => hit.kind === 'review' && hit.docId === '2026-11-01#0')).toBe(true);
});

test('never indexes files outside the vault root', async () => {
  await seedVault();
  const { service, fake } = startService();
  await service.search('kaoyan', '考研');
  const outside = await mkdtemp(join(tmpdir(), 'search-outside-'));
  try {
    await writeFileAtomic(join(outside, 'escape.md'), serializeNoteFile(noteRecord('escape-1', '逃逸独门词', '外部内容')));
    fake.emit('add', join(outside, 'escape.md'));
    fake.emit('change', join(root, '..', 'escape.md'));
    await sleep(50);
    expect(await service.search('kaoyan', '逃逸独门词')).toEqual([]);
    await service.rebuild();
    expect(await service.search('kaoyan', '逃逸独门词')).toEqual([]);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('skips symlinks, hidden directories and non-markdown files', async () => {
  await seedVault();
  const { service, fake } = startService();
  await service.search('kaoyan', '考研');
  const outside = await mkdtemp(join(tmpdir(), 'search-symlink-'));
  try {
    const notesDir = join(root, 'workspaces', 'kaoyan', 'notes');
    const target = join(outside, 'target.md');
    await writeFileAtomic(target, serializeNoteFile(noteRecord('outside-1', '链接独门词', '软链内容')));
    let symlinkCreated = true;
    try {
      await fs.symlink(target, join(notesDir, 'linked.md'));
    } catch (error) {
      // Creating symlinks on Windows needs Developer Mode or elevation.
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'ENOTSUP') throw error;
      symlinkCreated = false;
    }

    await writeFileAtomic(join(root, 'workspaces', 'kaoyan', '.hidden', 'secret.md'), serializeNoteFile(noteRecord('hidden-1', '隐藏独门词', '隐藏内容')));
    await writeFileAtomic(join(notesDir, 'raw.txt'), '非 markdown 独门词');

    await service.rebuild();
    if (symlinkCreated) {
      expect(await service.search('kaoyan', '链接独门词')).toEqual([]);
    }
    expect(await service.search('kaoyan', '隐藏独门词')).toEqual([]);
    expect(await service.search('kaoyan', '非 markdown 独门词')).toEqual([]);

    // Watcher events for symlinks are dropped too (lstat says "not a file").
    if (symlinkCreated) {
      fake.emit('add', join(notesDir, 'linked.md'));
      await sleep(30);
      expect(await service.search('kaoyan', '链接独门词')).toEqual([]);
    }
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('bootstraps a fresh vault root and survives watcher errors', async () => {
  const freshRoot = join(root, 'fresh-vault');
  const freshFake = createFakeWatcher();
  const service = createSearchService({
    workspaceService: createWorkspaceService(freshRoot),
    vaultRoot: freshRoot,
    debounceMs: 10,
    watcherFactory: freshFake.factory
  });
  services.push(service);
  const hits = await service.search('kaoyan', '考研');
  expect(hits.some((hit) => hit.kind === 'workspace')).toBe(true);
  freshFake.fail(new Error('watcher exploded'));
  expect((await service.search('kaoyan', '极限')).length).toBeGreaterThan(0);
});

test('dispose closes the watcher once and stops applying updates', async () => {
  await seedVault();
  const { service, fake } = startService();
  expect((await service.search('kaoyan', '极限')).length).toBeGreaterThan(0);
  await service.dispose();
  expect(fake.closeCount()).toBe(1);
  await service.dispose();
  expect(fake.closeCount()).toBe(1);

  fake.emit('add', join(root, 'workspaces', 'kaoyan', 'notes', 'late.md'));
  await sleep(50);
  expect(await service.search('kaoyan', '极限')).toEqual([]);
});

const PLAN: LongPlan = {
  id: 'lp-search',
  workspaceId: 'kaoyan',
  goal: '独门计划词：三个月转 Agent 开发',
  startDate: '2026-11-02',
  weeks: 1,
  weeklyHours: 10,
  generatedBy: 'agent',
  references: '岗位 JD 参考',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  phases: [
    {
      id: 'ph-1',
      title: '工程底座',
      subtitle: '先跑通最小闭环',
      goal: '搭好本地环境',
      weeks: [
        {
          id: 'w1',
          number: 1,
          title: '第 1 周',
          goal: '完成第一次调用',
          startDate: '2026-11-02',
          endDate: '2026-11-08',
          days: [
            {
              id: 'w1d1',
              date: '2026-11-02',
              weekday: '周一',
              tasks: ['跑通 LLM API 调用'],
              output: '可运行的调用脚本',
              done: false
            }
          ],
          checks: [{ id: 'w1c1', text: '完成最小闭环', done: false }]
        }
      ]
    }
  ]
};

const TOPIC: KnowledgeTopic = {
  id: 'kt-search',
  name: '检索主题',
  aliases: ['检索别名'],
  status: 'learning',
  summary: '独门知识摘要',
  evidence: [
    {
      id: 'e1',
      kind: 'note',
      title: '学习笔记',
      date: '2026-11-01',
      note: 'AgentExecutor 用法'
    }
  ],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z'
};

async function writeKnowledge(topic: KnowledgeTopic, noteBody: string): Promise<string> {
  await writeFileAtomic(
    join(root, 'knowledge', 'topics', `${topic.id}.md`),
    serializeKnowledgeTopicFile(topic)
  );
  const notePath = join(root, 'knowledge', 'notes', `${topic.id}.md`);
  await writeFileAtomic(notePath, noteBody);
  return notePath;
}

test('searchAll includes long plans and keeps workspace scoping', async () => {
  await seedVault();
  await writeFileAtomic(
    join(root, 'workspaces', 'kaoyan', 'plans', 'lp-search.md'),
    serializeLongPlanFile(PLAN)
  );
  const { service } = startService();

  const hits = await service.searchAll('独门计划词');
  expect(hits.some((hit) => hit.kind === 'plan' && hit.docId === 'lp-search')).toBe(true);
  expect(hits.find((hit) => hit.docId === 'lp-search')).toMatchObject({
    workspaceId: 'kaoyan',
    title: PLAN.goal,
    path: 'workspaces/kaoyan/plans/lp-search.md'
  });
  expect((await service.search('kaoyan', '独门计划词')).some((hit) => hit.kind === 'plan')).toBe(true);
  expect(await service.search('english', '独门计划词')).toEqual([]);
});

test('searchAll indexes knowledge topics with their note bodies', async () => {
  await seedVault();
  await writeKnowledge(TOPIC, '笔记正文独门词');
  const { service } = startService();

  const bySummary = await service.searchAll('独门知识摘要');
  expect(bySummary).toHaveLength(1);
  expect(bySummary[0]).toMatchObject({
    workspaceId: null,
    docId: 'kt-search',
    kind: 'knowledge-topic',
    title: '检索主题',
    path: 'knowledge/topics/kt-search.md'
  });

  const byNote = await service.searchAll('笔记正文独门词');
  expect(byNote.some((hit) => hit.docId === 'kt-search')).toBe(true);
  expect(await service.search('kaoyan', '笔记正文独门词')).toEqual([]);
});

test('re-indexes a knowledge topic when its note changes or disappears', async () => {
  await seedVault();
  const notePath = await writeKnowledge(TOPIC, '苹果香蕉');
  const { service, fake } = startService();
  expect((await service.searchAll('苹果香蕉')).some((hit) => hit.docId === 'kt-search')).toBe(true);

  await writeFileAtomic(notePath, '橘子葡萄');
  fake.emit('change', notePath);
  await vi.waitFor(
    async () => {
      expect((await service.searchAll('橘子葡萄')).some((hit) => hit.docId === 'kt-search')).toBe(true);
      expect(await service.searchAll('苹果香蕉')).toEqual([]);
    },
    { timeout: 2000, interval: 10 }
  );

  await fs.rm(notePath);
  fake.emit('unlink', notePath);
  await vi.waitFor(
    async () => {
      expect(await service.searchAll('橘子葡萄')).toEqual([]);
      expect((await service.searchAll('独门知识摘要')).some((hit) => hit.docId === 'kt-search')).toBe(true);
    },
    { timeout: 2000, interval: 10 }
  );
});

test('searchAll handles empty queries and limits', async () => {
  await seedVault();
  const { service } = startService();
  expect(await service.searchAll('')).toEqual([]);
  expect(await service.searchAll('   ')).toEqual([]);
  expect((await service.searchAll('极限', 2)).length).toBeLessThanOrEqual(2);
  expect(await service.searchAll('极限', 0)).toEqual([]);
});
