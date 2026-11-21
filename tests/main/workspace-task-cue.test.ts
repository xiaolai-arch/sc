import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import {
  parseTaskFile,
  serializeTaskFile
} from '../../src/main/workspace/records/tasks';
import { formatLocalDate } from '../../src/shared/date';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workspace-task-cue-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function taskFilePath(workspaceId: string, date: string): string {
  return join(root, 'workspaces', workspaceId, 'tasks', `${date}.md`);
}

test('createTask round-trips the cue through the vault', async () => {
  const service = createWorkspaceService(root);
  const today = formatLocalDate(new Date());
  const task = await service.createTask({
    workspaceId: 'kaoyan',
    title: '极限基础',
    subject: '数学',
    durationMin: 45,
    acceptance: '完成 10 题',
    cue: '  晚饭后  '
  });
  expect(task.cue).toBe('晚饭后');

  // The cue is stored in the frontmatter, not the checklist line.
  const raw = await fs.readFile(taskFilePath('kaoyan', today), 'utf8');
  expect(raw).toContain('cue: 晚饭后');

  const reopened = await createWorkspaceService(root).getWorkspaceSnapshot('kaoyan');
  expect(reopened.tasks.find((entry) => entry.id === task.id)?.cue).toBe('晚饭后');
});

test('updateWorkspaceTask sets, replaces and clears the cue', async () => {
  const service = createWorkspaceService(root);
  const created = await service.createTask({
    workspaceId: 'kaoyan',
    title: '真题',
    subject: '数学',
    durationMin: 60,
    acceptance: '一套'
  });
  expect(created.cue).toBeUndefined();

  const set = await service.updateWorkspaceTask({ taskId: created.id, cue: '到自习室' });
  expect(set.cue).toBe('到自习室');
  expect(
    (await createWorkspaceService(root).getWorkspaceSnapshot('kaoyan')).tasks.find(
      (entry) => entry.id === created.id
    )?.cue
  ).toBe('到自习室');

  const replaced = await service.updateWorkspaceTask({ taskId: created.id, cue: '下班回家后' });
  expect(replaced.cue).toBe('下班回家后');

  // null clears; an empty string clears too.
  const cleared = await service.updateWorkspaceTask({ taskId: created.id, cue: null });
  expect(cleared.cue).toBeUndefined();
  const raw = await fs.readFile(taskFilePath('kaoyan', formatLocalDate(new Date())), 'utf8');
  expect(parseTaskFile(raw).find((entry) => entry.id === created.id)?.cue).toBeUndefined();

  await service.updateWorkspaceTask({ taskId: created.id, cue: '午饭后' });
  const emptyClears = await service.updateWorkspaceTask({ taskId: created.id, cue: '' });
  expect(emptyClears.cue).toBeUndefined();
});

test('a task file without a cue round-trips byte-identically', async () => {
  const service = createWorkspaceService(root);
  const today = formatLocalDate(new Date());
  await service.getWorkspaceSnapshot('kaoyan');

  const raw = await fs.readFile(taskFilePath('kaoyan', today), 'utf8');
  expect(raw).not.toContain('cue');
  // Parsing then serializing adds no `cue:` key and changes nothing else.
  expect(serializeTaskFile(today, parseTaskFile(raw))).toBe(raw);
});

test('a task file with a cue survives parse and serialize unchanged', async () => {
  const service = createWorkspaceService(root);
  const today = formatLocalDate(new Date());
  await service.createTask({
    workspaceId: 'kaoyan',
    title: '背单词',
    subject: '英语',
    durationMin: 20,
    acceptance: '30 个',
    cue: '早起后'
  });

  const raw = await fs.readFile(taskFilePath('kaoyan', today), 'utf8');
  const tasks = parseTaskFile(raw);
  expect(tasks.find((entry) => entry.title === '背单词')?.cue).toBe('早起后');
  expect(serializeTaskFile(today, tasks)).toBe(raw);
});

test('the service rejects a cue longer than 40 characters', async () => {
  const service = createWorkspaceService(root);
  await expect(
    service.createTask({
      workspaceId: 'kaoyan',
      title: '太长',
      subject: '数学',
      durationMin: 10,
      acceptance: '',
      cue: '晚'.repeat(41)
    })
  ).rejects.toThrow(/40/);
});