// @vitest-environment jsdom
import { createMockApi, DEMO_PROFILE, MOCK_STORAGE_KEY } from '../../web/mock-api';

test('starts in onboarding and completes it with a demo plan', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  expect((await api.getBootstrap()).needsOnboarding).toBe(true);
  await api.completeOnboarding(DEMO_PROFILE);
  const bootstrap = await api.getBootstrap();
  expect(bootstrap.needsOnboarding).toBe(false);
  const plan = await api.getTodayPlan();
  expect(plan?.tasks.length).toBeGreaterThan(0);
});

test('updates a task and keeps settings', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  await api.completeOnboarding(DEMO_PROFILE);
  const plan = await api.getTodayPlan();
  const updated = await api.updateTask({ taskId: plan!.tasks[0].id, status: 'done' });
  expect(updated.tasks.find((task) => task.id === plan!.tasks[0].id)?.status).toBe('done');
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
  await api.completeOnboarding(DEMO_PROFILE);
  expect((await api.getTodayPlan())?.tasks.length).toBeGreaterThan(0);
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
