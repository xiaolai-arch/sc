import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MemoryService } from '../../src/shared/memory';
import type { PracticeService } from '../../src/shared/practice';
import type { WorkspacePlanner } from '../../src/shared/planning';
import type { SearchService } from '../../src/shared/search';
import type { ButlerService, WorkspaceService } from '../../src/shared/workspace';
import { createAppContext, type CreateAppContextOptions } from '../../src/main/context';
import { createIpcHandlers } from '../../src/main/ipc';
import { InMemorySecretStore } from '../../src/main/settings/secret-store';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fakeWorkspace(overrides: Partial<WorkspaceService> = {}): WorkspaceService {
  return {
    listWorkspaces: vi.fn().mockResolvedValue([]),
    createWorkspace: vi.fn(),
    getWorkspaceSnapshot: vi.fn(),
    createTask: vi.fn(),
    updateWorkspaceTask: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    getMemory: vi.fn().mockResolvedValue([]),
    getReminders: vi.fn().mockResolvedValue([]),
    submitReview: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as WorkspaceService;
}

function fakeButler(): ButlerService {
  return {
    send: vi.fn().mockResolvedValue({ text: 'ok' }),
    stream: vi.fn().mockResolvedValue({ text: 'ok' })
  };
}

function fakePractice(overrides: Partial<PracticeService> = {}): PracticeService {
  return {
    listSets: vi.fn().mockResolvedValue([]),
    getSet: vi.fn().mockResolvedValue(null),
    createSet: vi.fn(),
    submitAnswer: vi.fn(),
    getMistakes: vi.fn().mockResolvedValue([]),
    getDue: vi.fn().mockResolvedValue([]),
    listAttempts: vi.fn().mockResolvedValue([]),
    ...overrides
  } as PracticeService;
}

function fakeMemory(overrides: Partial<MemoryService> = {}): MemoryService {
  return {
    list: vi.fn().mockResolvedValue([]),
    synthesizeFromReview: vi.fn().mockResolvedValue({ items: [], generatedBy: 'rules' }),
    getProfile: vi.fn().mockResolvedValue({
      memoryCount: 0,
      strengths: [],
      weaknesses: [],
      preferences: [],
      plans: [],
      recent: [],
      summary: '',
      generatedAt: '2026-10-31T00:00:00.000Z'
    }),
    ...overrides
  } as MemoryService;
}

function fakeSearch(overrides: Partial<SearchService> = {}): SearchService {
  return {
    search: vi.fn().mockResolvedValue([]),
    searchAll: vi.fn().mockResolvedValue([]),
    rebuild: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as SearchService;
}

function fakePlanner(): WorkspacePlanner {
  return {
    plan: vi.fn().mockResolvedValue({ workspaceId: 'ws-1', date: '2026-10-31', tasks: [], generatedBy: 'template' })
  };
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-ipc-services-'));
  cleanup.push(dir);
  return dir;
}

async function makeContext(overrides: Partial<CreateAppContextOptions> = {}) {
  const dir = await tempDir();
  const context = await createAppContext({
    userDataPath: join(dir, 'user-data'),
    defaultVaultPath: join(dir, 'vault'),
    workspaceService: fakeWorkspace(),
    butlerService: fakeButler(),
    secretStore: new InMemorySecretStore(),
    now: () => new Date(2026, 9, 31, 10, 0, 0),
    ...overrides
  });
  return { context, dir };
}

test('routes planning, practice, memory and search channels to the services', async () => {
  const planner = fakePlanner();
  const practice = fakePractice({
    listSets: vi.fn().mockResolvedValue([{ id: 'ps-1' }]),
    getSet: vi.fn().mockResolvedValue({ id: 'ps-1' }),
    createSet: vi.fn().mockResolvedValue({ id: 'ps-2' }),
    submitAnswer: vi.fn().mockResolvedValue({ questionId: 'q-1', correct: true }),
    getMistakes: vi.fn().mockResolvedValue([{ id: 'pm-1' }]),
    getDue: vi.fn().mockResolvedValue([{ id: 'pm-2' }]),
    listAttempts: vi.fn().mockResolvedValue([{ id: 'pa-1' }])
  });
  const memory = fakeMemory({
    list: vi.fn().mockResolvedValue([{ id: 'm-1' }]),
    synthesizeFromReview: vi.fn().mockResolvedValue({ items: [], generatedBy: 'rules' }),
    getProfile: vi.fn().mockResolvedValue({ memoryCount: 1 })
  });
  const search = fakeSearch({ search: vi.fn().mockResolvedValue([{ docId: 'n-1' }]) });
  const { context } = await makeContext({
    practiceService: practice,
    memoryService: memory,
    searchService: search,
    workspacePlanner: planner
  });
  const handlers = createIpcHandlers(context.api);

  expect(await handlers.planWorkspace({ workspaceId: 'ws-1', availableMinutes: 90 })).toMatchObject({
    workspaceId: 'ws-1'
  });
  expect(planner.plan).toHaveBeenCalledWith({ workspaceId: 'ws-1', availableMinutes: 90 });

  expect(await handlers.listPracticeSets('ws-1')).toEqual([{ id: 'ps-1' }]);
  expect(await handlers.getPracticeSet('ps-1')).toEqual({ id: 'ps-1' });
  expect(
    await handlers.createPracticeSet({
      workspaceId: 'ws-1',
      title: '极限',
      questions: [{ prompt: 'p', options: ['a', 'b'], answer: 0 }]
    })
  ).toEqual({ id: 'ps-2' });
  expect(await handlers.submitPracticeAnswer({ questionId: 'q-1', choice: 0 })).toMatchObject({
    correct: true
  });
  expect(await handlers.getPracticeMistakes('ws-1')).toEqual([{ id: 'pm-1' }]);
  expect(await handlers.getPracticeDue({ workspaceId: 'ws-1', date: '2026-10-31' })).toEqual([
    { id: 'pm-2' }
  ]);
  expect(await handlers.listPracticeAttempts('ws-1')).toEqual([{ id: 'pa-1' }]);
  expect(practice.getDue).toHaveBeenCalledWith('ws-1', '2026-10-31');

  expect(await handlers.listMemory('ws-1')).toEqual([{ id: 'm-1' }]);
  const synthesizeInput = {
    workspaceId: 'ws-1',
    date: '2026-10-31',
    answers: { completed: 'a', stuck: 'b', tomorrow: 'c' }
  };
  await handlers.synthesizeMemory(synthesizeInput);
  expect(memory.synthesizeFromReview).toHaveBeenCalledWith(synthesizeInput);
  expect(await handlers.getMemoryProfile('ws-1')).toMatchObject({ memoryCount: 1 });

  expect(
    await handlers.searchWorkspace({ workspaceId: 'ws-1', query: '极限', limit: 3 })
  ).toEqual([{ docId: 'n-1' }]);
  expect(search.search).toHaveBeenCalledWith('ws-1', '极限', 3);
  expect(await handlers.searchAll({ query: '极限', limit: 3 })).toEqual([]);
  expect(search.searchAll).toHaveBeenCalledWith('极限', 3);
  await handlers.rebuildSearchIndex();
  expect(search.rebuild).toHaveBeenCalled();
});

test('rejects malformed planning, practice, memory and search inputs', async () => {
  const { context } = await makeContext({
    practiceService: fakePractice(),
    memoryService: fakeMemory(),
    searchService: fakeSearch(),
    workspacePlanner: fakePlanner()
  });
  const handlers = createIpcHandlers(context.api);

  await expect(handlers.planWorkspace({})).rejects.toThrow('工作区 ID不能为空。');
  await expect(handlers.listPracticeSets('   ')).rejects.toThrow('工作区 ID不能为空。');
  await expect(
    handlers.createPracticeSet({ workspaceId: 'ws-1', title: 't', questions: [] })
  ).rejects.toThrow('练习题目不能为空。');
  await expect(
    handlers.submitPracticeAnswer({ questionId: 'q-1', choice: -1 })
  ).rejects.toThrow('选项参数无效。');
  await expect(handlers.submitPracticeAnswer({ questionId: '', choice: 0 })).rejects.toThrow(
    '题目 ID不能为空。'
  );
  await expect(
    handlers.getPracticeDue({ workspaceId: 'ws-1', date: '' })
  ).rejects.toThrow('日期不能为空。');
  await expect(
    handlers.synthesizeMemory({ workspaceId: 'ws-1', date: '2026-10-31' })
  ).rejects.toThrow('复盘答案参数无效。');
  await expect(
    handlers.searchWorkspace({ workspaceId: 'ws-1', query: '  ' })
  ).rejects.toThrow('搜索关键词不能为空。');
  await expect(handlers.searchWorkspace({ workspaceId: 'ws-1' })).rejects.toThrow(
    '搜索关键词不能为空。'
  );
  await expect(handlers.searchAll({ query: '  ' })).rejects.toThrow('搜索关键词不能为空。');
  await expect(handlers.searchAll({})).rejects.toThrow('搜索关键词不能为空。');
});

test('submitting a review synthesizes memory for the workspace', async () => {
  const workspace = fakeWorkspace();
  const memory = fakeMemory();
  const { context } = await makeContext({ workspaceService: workspace, memoryService: memory });
  const answers = { completed: '数学', stuck: '极限', tomorrow: '复习' };

  await context.api.submitReview({ date: '2026-10-31', workspaceId: 'kaoyan', answers });
  expect(workspace.submitReview).toHaveBeenCalledWith({
    date: '2026-10-31',
    workspaceId: 'kaoyan',
    answers
  });
  expect(memory.synthesizeFromReview).toHaveBeenCalledWith({
    workspaceId: 'kaoyan',
    date: '2026-10-31',
    answers
  });

  vi.mocked(memory.synthesizeFromReview).mockClear();
  await context.api.submitReview({
    date: '2026-10-31',
    workspaceId: 'kaoyan',
    answers: { skipped: true, completed: '', stuck: '', tomorrow: '' }
  });
  expect(memory.synthesizeFromReview).not.toHaveBeenCalled();
});

test('a failing memory synthesis never loses the review record', async () => {
  const workspace = fakeWorkspace();
  const memory = fakeMemory({
    synthesizeFromReview: vi.fn().mockRejectedValue(new Error('model down'))
  });
  const { context } = await makeContext({ workspaceService: workspace, memoryService: memory });

  await expect(
    context.api.submitReview({
      date: '2026-10-31',
      workspaceId: 'kaoyan',
      answers: { completed: 'a', stuck: 'b', tomorrow: 'c' }
    })
  ).resolves.toBeUndefined();
  expect(workspace.submitReview).toHaveBeenCalled();
});

test('constructs search lazily and disposes it with the context', async () => {
  const search = fakeSearch();
  const searchServiceFactory = vi.fn().mockReturnValue(search);
  const { context } = await makeContext({ searchServiceFactory });

  expect(searchServiceFactory).not.toHaveBeenCalled();
  expect(context.search).toBe(search);
  await context.api.searchWorkspace({ workspaceId: 'ws-1', query: '极限' });
  expect(searchServiceFactory).toHaveBeenCalledTimes(1);

  await context.dispose();
  expect(search.dispose).toHaveBeenCalledTimes(1);
  await context.dispose();
  expect(search.dispose).toHaveBeenCalledTimes(1);
});

test('listReviews reads workspace and vault-wide review files newest first', async () => {
  const dir = await tempDir();
  const workspace = createWorkspaceService(join(dir, 'vault'));
  await workspace.listWorkspaces();
  await workspace.submitReview({
    date: '2026-10-30',
    workspaceId: 'kaoyan',
    answers: { completed: '数学 2 小时', stuck: '极限', tomorrow: '复习极限' }
  });
  await workspace.submitReview({
    date: '2026-10-31',
    answers: { completed: '英语阅读', stuck: '', tomorrow: '写作' }
  });

  const { context } = await makeContext({
    defaultVaultPath: join(dir, 'vault'),
    workspaceService: workspace
  });

  const kaoyan = await context.api.listReviews({ workspaceId: 'kaoyan' });
  expect(kaoyan).toHaveLength(2);
  expect(kaoyan.map((entry) => entry.date).sort()).toEqual(['2026-10-30', '2026-10-31']);
  expect(kaoyan.find((entry) => entry.workspaceId === 'kaoyan')?.completed).toBe('数学 2 小时');
  expect(kaoyan.find((entry) => entry.workspaceId === undefined)?.completed).toBe('英语阅读');

  const limited = await context.api.listReviews({ limit: 1 });
  expect(limited).toHaveLength(1);

  await expect(context.api.listReviews({ workspaceId: '../kaoyan' })).rejects.toThrow(
    /Invalid workspace id/i
  );
});
