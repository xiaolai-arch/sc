import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseNote } from '../../src/main/vault/note';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import { formatLocalDate } from '../../src/shared/date';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workspace-vault-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('seed produces the documented vault layout', async () => {
  await createWorkspaceService(root).listWorkspaces();
  const today = formatLocalDate(new Date());

  await expect(fs.access(join(root, 'workspaces', 'kaoyan', 'workspace.md'))).resolves.toBeUndefined();
  await expect(fs.access(join(root, 'workspaces', 'kaoyan', 'tasks', `${today}.md`))).resolves.toBeUndefined();
  await expect(fs.access(join(root, 'workspaces', 'kaoyan', 'memory.md'))).resolves.toBeUndefined();
  await expect(fs.access(join(root, 'workspaces', 'life', 'workspace.md'))).resolves.toBeUndefined();
  await expect(fs.access(join(root, 'reminders.md'))).resolves.toBeUndefined();

  const notes = await fs.readdir(join(root, 'workspaces', 'kaoyan', 'notes'));
  expect(notes.length).toBe(4);
  expect(notes[0]).toMatch(/\.md$/);
});

test('workspace.md is Obsidian-readable markdown with frontmatter', async () => {
  const service = createWorkspaceService(root);
  const [workspace] = await service.listWorkspaces();
  const raw = await fs.readFile(join(root, 'workspaces', workspace.id, 'workspace.md'), 'utf8');

  expect(raw.startsWith('---\n')).toBe(true);
  const { meta, body } = parseNote(raw);
  expect(meta.type).toBe('profile');
  expect(meta.name).toBe('考研');
  expect(meta.kind).toBe('exam');
  expect(meta.color).toBe('#0071e3');
  expect(body).toContain('# 考研');
  expect(body).toContain('- 目标：');
});

test('task files render as markdown checklists', async () => {
  const service = createWorkspaceService(root);
  const today = formatLocalDate(new Date());
  await service.createTask({
    workspaceId: 'kaoyan',
    title: '打卡任务',
    subject: '数学',
    durationMin: 25,
    acceptance: '做完收工'
  });
  const raw = await fs.readFile(join(root, 'workspaces', 'kaoyan', 'tasks', `${today}.md`), 'utf8');

  const { meta, body } = parseNote(raw);
  expect(meta.type).toBe('plan');
  expect(Array.isArray(meta.tasks)).toBe(true);
  expect(body).toMatch(/^- \[ \] 打卡任务（数学 · 25 分钟） — 做完收工$/m);

  const english = await fs.readFile(join(root, 'workspaces', 'english', 'tasks', `${today}.md`), 'utf8');
  expect(english).toMatch(/^- \[x\] 单词 30 个/m);
});

test('seed notes keep their markdown structure and frontmatter', async () => {
  const snapshot = await createWorkspaceService(root).getWorkspaceSnapshot('kaoyan');
  const note = snapshot.notes.find((entry) => entry.title === '极限的定义与性质');
  expect(note).toBeDefined();

  const raw = await fs.readFile(join(root, note!.path!), 'utf8');
  const { meta, body } = parseNote(raw);
  expect(meta.type).toBe('note');
  expect(meta.tags).toEqual(['极限', '定义']);
  expect(meta.id).toBe('n1');
  expect(body).toContain('## 核心定义');
  expect(body).toContain('对任意 ε > 0');
});

test('memory.md carries the butler memory log', async () => {
  await createWorkspaceService(root).getMemory('kaoyan');
  const raw = await fs.readFile(join(root, 'workspaces', 'kaoyan', 'memory.md'), 'utf8');
  const { meta, body } = parseNote(raw);
  expect(meta.type).toBe('log');
  expect(body).toContain('# 记忆');
  expect(body).toContain('极限定义还不稳');
});

test('reminders.md is markdown with the three demo reminders', async () => {
  await createWorkspaceService(root).getReminders();
  const raw = await fs.readFile(join(root, 'reminders.md'), 'utf8');
  const { meta, body } = parseNote(raw);
  expect(meta.type).toBe('plan');
  expect(body).toContain('- 08:00 早间计划');
  expect(body).toContain('- 21:30 晚间复盘');
});

test('a hand-written Obsidian note shows up in snapshots', async () => {
  const service = createWorkspaceService(root);
  await service.listWorkspaces();
  const notesDir = join(root, 'workspaces', 'english', 'notes');
  await fs.writeFile(join(notesDir, '随手记.md'), '# 随手记\n\n用 Obsidian 写的笔记，没有 frontmatter。', 'utf8');

  const snapshot = await createWorkspaceService(root).getWorkspaceSnapshot('english');
  const note = snapshot.notes.find((entry) => entry.title === '随手记');
  expect(note).toBeDefined();
  expect(note?.body).toContain('用 Obsidian 写的笔记');
});
