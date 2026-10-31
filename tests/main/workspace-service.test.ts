import { promises as fs } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import { formatLocalDate } from '../../src/shared/date';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workspace-service-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Collects every file path under `dir` (relative paths joined with '/'). */
async function walkFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(child)));
    } else {
      files.push(child);
    }
  }
  return files;
}

test('seeds the demo vault on first use', async () => {
  const service = createWorkspaceService(root);
  const workspaces = await service.listWorkspaces();
  expect(workspaces.map((workspace) => workspace.id)).toEqual(['kaoyan', 'english', 'project', 'life']);
  expect(workspaces.map((workspace) => workspace.name)).toEqual(['考研', '英语', '项目', '生活']);

  const snapshot = await service.getWorkspaceSnapshot('kaoyan');
  expect(snapshot.workspace.goal).toContain('2027 考研');
  expect(snapshot.tasks.length).toBe(3);
  expect(snapshot.tasks.map((task) => task.id).sort()).toEqual(['k1', 'k2', 'k3']);
  expect(snapshot.notes.length).toBe(4);
  expect(snapshot.memory.length).toBe(2);
  expect(snapshot.reminders.map((reminder) => reminder.label)).toEqual(['早间计划', '晚间复盘', '免打扰']);
});

test('seeding does not duplicate on a second service instance', async () => {
  await createWorkspaceService(root).listWorkspaces();
  const workspaces = await createWorkspaceService(root).listWorkspaces();
  expect(workspaces).toHaveLength(4);
});

test('does not seed when a vault already exists', async () => {
  await fs.mkdir(join(root, 'workspaces'), { recursive: true });
  const service = createWorkspaceService(root);
  expect(await service.listWorkspaces()).toEqual([]);
  expect(await service.getReminders()).toEqual([]);
});

test('creates a workspace and persists it for fresh instances', async () => {
  const service = createWorkspaceService(root);
  const created = await service.createWorkspace({
    name: '日语',
    kind: 'study',
    goal: '年底考 N3',
    description: '每天 30 分钟'
  });
  expect(created.id).toMatch(/^[\p{L}\p{N}_][\p{L}\p{N}_-]*$/u);
  expect(created.color).toBe('#34c759');

  const again = await createWorkspaceService(root).listWorkspaces();
  expect(again.map((workspace) => workspace.name)).toContain('日语');
  expect(again).toHaveLength(5);
});

test('gives duplicate workspace names distinct ids', async () => {
  const service = createWorkspaceService(root);
  const first = await service.createWorkspace({ name: '日语', kind: 'study', goal: '', description: '' });
  const second = await service.createWorkspace({ name: '日语', kind: 'study', goal: '', description: '' });
  expect(first.id).not.toBe(second.id);
  expect(await service.listWorkspaces()).toHaveLength(6);
});

test('createTask writes into today’s task file and returns the task', async () => {
  const service = createWorkspaceService(root);
  const today = formatLocalDate(new Date());
  const task = await service.createTask({
    workspaceId: 'kaoyan',
    title: '线性代数：行列式',
    subject: '数学',
    durationMin: 40,
    acceptance: '完成例题 5 道'
  });
  expect(task.status).toBe('pending');
  expect(task.workspaceId).toBe('kaoyan');

  const file = join(root, 'workspaces', 'kaoyan', 'tasks', `${today}.md`);
  const raw = await fs.readFile(file, 'utf8');
  expect(raw).toContain('线性代数：行列式');
  const snapshot = await service.getWorkspaceSnapshot('kaoyan');
  expect(snapshot.tasks.map((entry) => entry.id)).toContain(task.id);
});

test('createTask with a due date files the task under that date', async () => {
  const service = createWorkspaceService(root);
  await service.createTask({
    workspaceId: 'kaoyan',
    title: '模拟卷',
    subject: '数学',
    durationMin: 120,
    acceptance: '限时 2 小时',
    due: '2026-12-20'
  });
  const raw = await fs.readFile(join(root, 'workspaces', 'kaoyan', 'tasks', '2026-12-20.md'), 'utf8');
  expect(raw).toContain('模拟卷');
  // The seeded kaoyan tasks still live in today's file; the new task must not leak into it.
  const today = formatLocalDate(new Date());
  const todayRaw = await fs.readFile(join(root, 'workspaces', 'kaoyan', 'tasks', `${today}.md`), 'utf8');
  expect(todayRaw).not.toContain('模拟卷');
});

test('updateWorkspaceTask persists status and actual minutes', async () => {
  const service = createWorkspaceService(root);
  const created = await service.createTask({
    workspaceId: 'english',
    title: '精读',
    subject: '英语',
    durationMin: 30,
    acceptance: '1 篇'
  });
  const updated = await service.updateWorkspaceTask({
    taskId: created.id,
    status: 'done',
    actualMin: 26
  });
  expect(updated.status).toBe('done');
  expect(updated.actualMin).toBe(26);

  const snapshot = await service.getWorkspaceSnapshot('english');
  const task = snapshot.tasks.find((entry) => entry.id === created.id);
  expect(task?.status).toBe('done');
  expect(task?.actualMin).toBe(26);
});

test('updateWorkspaceTask on a seeded task survives a restart', async () => {
  const service = createWorkspaceService(root);
  await service.updateWorkspaceTask({ taskId: 'k1', status: 'in-progress' });
  const snapshot = await createWorkspaceService(root).getWorkspaceSnapshot('kaoyan');
  const task = snapshot.tasks.find((entry) => entry.id === 'k1');
  expect(task?.status).toBe('in-progress');
});

test('updateWorkspaceTask rejects an unknown task id', async () => {
  const service = createWorkspaceService(root);
  await expect(
    service.updateWorkspaceTask({ taskId: 'does-not-exist', status: 'done' })
  ).rejects.toThrow(/not found/i);
});

test('createNote stores body and metadata; updateNote patches them', async () => {
  const service = createWorkspaceService(root);
  const note = await service.createNote({
    workspaceId: 'kaoyan',
    title: '泰勒展开速查',
    subject: '数学',
    tags: ['泰勒', '速查'],
    summary: '常用展开式',
    body: '## 常用展开\n\nsin x ≈ x - x³/6',
    related: []
  });
  expect(note.path).toMatch(/^workspaces\/kaoyan\/notes\/.+\.md$/);

  const updated = await service.updateNote({
    noteId: note.id,
    tags: ['泰勒'],
    body: '## 常用展开\n\n更新过的正文'
  });
  expect(updated.tags).toEqual(['泰勒']);

  const snapshot = await createWorkspaceService(root).getWorkspaceSnapshot('kaoyan');
  const stored = snapshot.notes.find((entry) => entry.id === note.id);
  expect(stored?.body).toBe('## 常用展开\n\n更新过的正文');
  expect(stored?.tags).toEqual(['泰勒']);
});

test('createNote uniquifies file names for duplicate titles', async () => {
  const service = createWorkspaceService(root);
  const first = await service.createNote({ workspaceId: 'kaoyan', title: '同题笔记', subject: '', body: '一' });
  const second = await service.createNote({ workspaceId: 'kaoyan', title: '同题笔记', subject: '', body: '二' });
  expect(first.path).not.toBe(second.path);
  const snapshot = await service.getWorkspaceSnapshot('kaoyan');
  expect(snapshot.notes.filter((note) => note.title === '同题笔记')).toHaveLength(2);
});

test('updateNote rejects an unknown note id', async () => {
  const service = createWorkspaceService(root);
  await expect(service.updateNote({ noteId: 'nope', body: 'x' })).rejects.toThrow(/not found/i);
});

test('getMemory returns per-workspace and vault-wide memory', async () => {
  const service = createWorkspaceService(root);
  const kaoyan = await service.getMemory('kaoyan');
  expect(kaoyan).toHaveLength(2);
  expect(kaoyan.every((item) => item.workspaceId === 'kaoyan')).toBe(true);
  const all = await service.getMemory();
  expect(all).toHaveLength(5);
});

test('getReminders returns seeded reminders with enabled flags', async () => {
  const reminders = await createWorkspaceService(root).getReminders();
  expect(reminders).toEqual([
    { id: 'r1', time: '08:00', label: '早间计划', enabled: true },
    { id: 'r2', time: '21:30', label: '晚间复盘', enabled: true },
    { id: 'r3', time: '23:00', label: '免打扰', enabled: true }
  ]);
});

test('coerces hand-edited sexagesimal reminder times back to HH:MM', async () => {
  await fs.mkdir(join(root, 'workspaces'), { recursive: true });
  await fs.writeFile(
    join(root, 'reminders.md'),
    '---\ntype: plan\nitems:\n  - id: x1\n    time: 21:30\n    label: 手写提醒\n---\n\n# 提醒\n',
    'utf8'
  );
  const reminders = await createWorkspaceService(root).getReminders();
  expect(reminders).toEqual([{ id: 'x1', time: '21:30', label: '手写提醒', enabled: true }]);
});

test('submitReview appends the review under the workspace reviews folder', async () => {
  const service = createWorkspaceService(root);
  await service.submitReview({
    date: '2026-10-31',
    workspaceId: 'kaoyan',
    answers: { completed: '数学 2 小时', stuck: '级数收敛判断', tomorrow: '继续线代' }
  });
  await service.submitReview({
    date: '2026-10-31',
    workspaceId: 'kaoyan',
    answers: { completed: '补了笔记', stuck: '', tomorrow: '英语精读' }
  });
  const raw = await fs.readFile(
    join(root, 'workspaces', 'kaoyan', 'reviews', '2026-10-31.md'),
    'utf8'
  );
  expect(raw).toContain('数学 2 小时');
  expect(raw).toContain('补了笔记');
  expect((raw.match(/## 第 \d+ 次复盘/g) ?? []).length).toBe(2);
});

test('submitReview without a workspace writes to the vault root', async () => {
  const service = createWorkspaceService(root);
  await service.submitReview({
    date: '2026-10-31',
    answers: { completed: 'a', stuck: 'b', tomorrow: 'c' }
  });
  const raw = await fs.readFile(join(root, 'reviews', '2026-10-31.md'), 'utf8');
  expect(raw).toContain('completed: a');
});

test('everything created is readable from a fresh service instance', async () => {
  const service = createWorkspaceService(root);
  const workspace = await service.createWorkspace({ name: '读书', kind: 'life', goal: '12 本', description: '' });
  const task = await service.createTask({ workspaceId: workspace.id, title: '读 30 页', subject: '阅读', durationMin: 30, acceptance: '' });
  const note = await service.createNote({ workspaceId: workspace.id, title: '摘录', subject: '阅读', body: '金句' });
  await service.submitReview({ date: '2026-11-01', workspaceId: workspace.id, answers: { completed: '开卷', stuck: '', tomorrow: '继续' } });

  const fresh = createWorkspaceService(root);
  const snapshot = await fresh.getWorkspaceSnapshot(workspace.id);
  expect(snapshot.workspace.name).toBe('读书');
  expect(snapshot.tasks.map((entry) => entry.id)).toContain(task.id);
  expect(snapshot.notes.map((entry) => entry.id)).toContain(note.id);
  expect(await fresh.getMemory(workspace.id)).toEqual([]);
  const reviewRaw = await fs.readFile(
    join(root, 'workspaces', workspace.id, 'reviews', '2026-11-01.md'),
    'utf8'
  );
  expect(reviewRaw).toContain('开卷');
});

test('concurrent createTask calls all persist and leave no temp files', async () => {
  const service = createWorkspaceService(root);
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      service.createTask({
        workspaceId: 'kaoyan',
        title: `并发任务 ${index + 1}`,
        subject: '测试',
        durationMin: 5,
        acceptance: ''
      })
    )
  );
  const snapshot = await service.getWorkspaceSnapshot('kaoyan');
  expect(snapshot.tasks.filter((task) => task.title.startsWith('并发任务'))).toHaveLength(12);
  const files = await walkFiles(root);
  expect(files.filter((file) => file.includes('.tmp'))).toEqual([]);
  expect((await readdir(join(root, 'workspaces', 'kaoyan', 'tasks'))).length).toBeGreaterThanOrEqual(1);
});
