// @vitest-environment jsdom
import { createMockApi, MOCK_STORAGE_KEY } from '../../web/mock-api';
import type { ButlerStreamEvent } from '../../src/shared/butler-stream';

test('starts in onboarding and completes it with a workspace', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  expect((await api.getBootstrap()).needsOnboarding).toBe(true);
  await api.completeWorkspaceOnboarding({
    name: '我的学习',
    kind: 'study',
    goal: '把今天的下一步做完',
    description: ''
  });
  const bootstrap = await api.getBootstrap();
  expect(bootstrap.needsOnboarding).toBe(false);
  const workspaces = await api.listWorkspaces();
  expect(workspaces.some((workspace) => workspace.name === '我的学习')).toBe(true);
});

test('updates a workspace task and keeps settings', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  await api.completeWorkspaceOnboarding({
    name: '我的学习',
    kind: 'study',
    goal: 'g',
    description: ''
  });
  const task = await api.createTask({
    workspaceId: 'kaoyan',
    title: '极限 10 题',
    subject: '数学',
    durationMin: 45,
    acceptance: '完成 10 题'
  });
  const updated = await api.updateWorkspaceTask({ taskId: task.id, status: 'done' });
  expect(updated.status).toBe('done');
  const settings = await api.getSettings();
  expect(settings.budget.proactiveSessionsPerDay).toBe(4);
});

test('keeps the api key out of storage and flips hasApiKey', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  expect((await api.getBootstrap()).hasApiKey).toBe(false);
  await api.setApiKey('sk-test');
  expect((await api.getBootstrap()).hasApiKey).toBe(true);
  expect(localStorage.getItem(MOCK_STORAGE_KEY) ?? '').not.toContain('sk-test');
});

test('falls back to memory when storage is unavailable', async () => {
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    }
  } as unknown as Storage;
  const api = createMockApi(blocked);
  await api.completeWorkspaceOnboarding({
    name: '内存工作区',
    kind: 'study',
    goal: 'g',
    description: ''
  });
  expect((await api.listWorkspaces()).some((workspace) => workspace.name === '内存工作区')).toBe(
    true
  );
});

test('seeds workspaces, snapshots, memory and reminders from the demo data', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  const workspaces = await api.listWorkspaces();
  expect(workspaces.map((workspace) => workspace.name)).toEqual(['考研', '英语', '项目', '生活']);

  const snapshot = await api.getWorkspaceSnapshot('kaoyan');
  expect(snapshot.workspace.name).toBe('考研');
  expect(snapshot.tasks.length).toBeGreaterThan(0);
  expect(snapshot.notes[0]?.body).toContain('极限是描述');
  expect((await api.getMemory('kaoyan')).length).toBeGreaterThan(0);
  expect((await api.getReminders()).map((reminder) => reminder.time)).toContain('21:30');
});

test('creates and updates a task through the workspace API', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  const task = await api.createTask({
    workspaceId: 'english',
    title: '精读第二篇',
    subject: '英语',
    durationMin: 25,
    acceptance: '摘 5 个表达'
  });
  expect(task.status).toBe('pending');

  const updated = await api.updateWorkspaceTask({ taskId: task.id, status: 'done', actualMin: 20 });
  expect(updated.status).toBe('done');
  expect(updated.actualMin).toBe(20);
  const snapshot = await api.getWorkspaceSnapshot('english');
  expect(snapshot.tasks.find((entry) => entry.id === task.id)?.status).toBe('done');
});

test('creates and updates a note and persists it across API instances', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  const note = await api.createNote({
    workspaceId: 'project',
    title: '周会记录',
    subject: '项目',
    tags: ['周会'],
    body: '本周先完成首页。'
  });
  const updated = await api.updateNote({
    noteId: note.id,
    title: '周会记录（已整理）',
    body: '本周先完成首页。\n- 下周接项目列表'
  });
  expect(updated.title).toBe('周会记录（已整理）');
  expect(updated.body).toContain('下周接项目列表');

  const reopened = createMockApi(localStorage);
  const snapshot = await reopened.getWorkspaceSnapshot('project');
  expect(snapshot.notes.find((entry) => entry.id === note.id)?.title).toBe('周会记录（已整理）');
});

test('returns a canned butler reply and records notes from chat', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  const priority = await api.send({ message: '帮我排一下今天的优先级' });
  expect(priority.text).toContain('我先按截止时间和精力排');

  const recorded = await api.send({ workspaceId: 'kaoyan', message: '记一下：今天数学卡在极限' });
  expect(recorded.text).toContain('记下了');
  const snapshot = await api.getWorkspaceSnapshot('kaoyan');
  expect(snapshot.notes.some((note) => note.title === '今天数学卡在极限')).toBe(true);
});

test('serves seeded practice sets and records answers, mistakes and attempts', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  const sets = await api.listPracticeSets('kaoyan');
  expect(sets.map((set) => set.title)).toEqual(['极限基础 3 题', '马原易错 3 题']);
  const set = await api.getPracticeSet(sets[0]!.id);
  const question = set!.questions[0]!;

  const wrong = await api.submitPracticeAnswer({ questionId: question.id, choice: 0 });
  expect(wrong.correct).toBe(false);
  expect(wrong.mistake?.status).toBe('active');
  expect(wrong.due).toBeTruthy();

  const mistakes = await api.getPracticeMistakes('kaoyan');
  expect(mistakes).toHaveLength(1);
  expect(mistakes[0]?.questionId).toBe(question.id);
  const due = await api.getPracticeDue({
    workspaceId: 'kaoyan',
    date: new Date().toISOString().slice(0, 10)
  });
  expect(due).toHaveLength(0);

  const right = await api.submitPracticeAnswer({ questionId: question.id, choice: question.answer });
  expect(right.correct).toBe(true);
  expect(right.mistake?.correctStreak).toBe(1);
  expect(await api.listPracticeAttempts('kaoyan')).toHaveLength(2);

  const created = await api.createPracticeSet({
    workspaceId: 'english',
    title: '自建练习',
    questions: [{ prompt: 'p', options: ['a', 'b'], answer: 1 }]
  });
  expect((await api.listPracticeSets('english')).some((entry) => entry.id === created.id)).toBe(true);
});

test('synthesizes memory from reviews and builds a learner profile', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  const result = await api.synthesizeMemory({
    workspaceId: 'kaoyan',
    date: '2026-10-31',
    answers: { completed: '数学两小时', stuck: '极限定义', tomorrow: '先复习极限' }
  });
  expect(result.generatedBy).toBe('rules');
  expect(result.items.map((item) => item.kind).sort()).toEqual(['plan', 'strength', 'weakness']);

  await api.submitReview({
    date: '2026-10-31',
    workspaceId: 'kaoyan',
    answers: { completed: '数学两小时', stuck: '极限定义', tomorrow: '先复习极限' }
  });
  const records = await api.listMemory('kaoyan');
  expect(records.some((record) => record.source === 'review:2026-10-31')).toBe(true);
  expect(records.some((record) => record.text.includes('极限定义'))).toBe(true);

  const profile = await api.getMemoryProfile('kaoyan');
  expect(profile.memoryCount).toBeGreaterThan(0);
  expect(profile.weaknesses.some((entry) => entry.includes('极限定义'))).toBe(true);
  expect(profile.plans.some((entry) => entry.includes('先复习极限'))).toBe(true);

  const skipped = await api.synthesizeMemory({
    workspaceId: 'kaoyan',
    date: '2026-11-01',
    answers: { skipped: true, completed: '', stuck: '', tomorrow: '' }
  });
  expect(skipped.items).toHaveLength(0);
});

test('lists review records and plans and searches the mock workspace', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  await api.submitReview({
    date: '2026-10-30',
    workspaceId: 'kaoyan',
    answers: { completed: '数学', stuck: '极限', tomorrow: '复习' }
  });
  await api.submitReview({
    date: '2026-10-31',
    answers: { completed: '英语', stuck: '', tomorrow: '写作' }
  });

  const reviews = await api.listReviews({ workspaceId: 'kaoyan' });
  expect(reviews.map((review) => review.date).sort()).toEqual(['2026-10-30', '2026-10-31']);
  expect((await api.listReviews({ limit: 1 })).length).toBe(1);

  const plan = await api.planWorkspace({ workspaceId: 'project', availableMinutes: 90 });
  expect(plan.generatedBy).toBe('template');
  expect(plan.workspaceId).toBe('project');
  expect(plan.tasks.length).toBeGreaterThan(0);
  expect(plan.tasks.every((task) => task.durationMin >= 15)).toBe(true);

  const found = await api.searchWorkspace({ workspaceId: 'kaoyan', query: '洛必达' });
  expect(found.length).toBeGreaterThan(0);
  expect(found.some((hit) => hit.kind === 'practice-question')).toBe(true);
  expect(found[0]?.snippet).toContain('洛必达');
  expect(await api.searchWorkspace({ workspaceId: 'kaoyan', query: '  ' })).toEqual([]);
  await expect(api.rebuildSearchIndex()).resolves.toBeUndefined();
});

test('streams reasoning, a tool step and the final reply', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  const events: ButlerStreamEvent[] = [];
  const result = await api.stream(
    { workspaceId: 'kaoyan', message: '记一下：今天数学卡在极限' },
    (event) => events.push(event)
  );

  expect(events.some((event) => event.type === 'reasoning')).toBe(true);
  expect(events.some((event) => event.type === 'narration')).toBe(true);
  expect(
    events.some((event) => event.type === 'tool-start' && event.name === 'write_note')
  ).toBe(true);
  expect(events.at(-1)).toEqual({ type: 'done', text: result.text });

  const snapshot = await api.getWorkspaceSnapshot('kaoyan');
  expect(snapshot.notes.some((note) => note.title.includes('今天数学卡在极限'))).toBe(true);
});

test('streams a plain answer without a tool step', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  const events: ButlerStreamEvent[] = [];
  const result = await api.stream(
    { workspaceId: 'kaoyan', message: '帮我排一下今天的优先级' },
    (event) => events.push(event)
  );

  expect(events.some((event) => event.type === 'tool-start')).toBe(false);
  expect(events.filter((event) => event.type === 'text').length).toBeGreaterThan(1);
  expect(result.text.length).toBeGreaterThan(0);
});
