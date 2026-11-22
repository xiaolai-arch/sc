import { promises as fs } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import { assertIsoDate, assertLocalDateTime } from '../../src/main/workspace/paths';

let root: string;
let scratch: string;
let parentBefore: string[];

beforeEach(async () => {
  // Keep the vault inside a private parent: inspecting the shared system tmpdir
  // made this suite flaky when other processes created files concurrently.
  scratch = await mkdtemp(join(tmpdir(), 'workspace-security-'));
  root = join(scratch, 'vault');
  await mkdir(root, { recursive: true });
  parentBefore = await readdir(dirname(root));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const ESCAPES = ['../escape', '..\\escape', '../../etc/passwd', '/etc', 'a/b', '.', '..', 'kaoyan/../../evil'];

test('assertIsoDate refuses days the calendar rolls over', () => {
  // The old rule only rejected a NaN parse, but V8 rolls an impossible day
  // over instead (`2026-02-30` → March 2), so it was accepted. The shared
  // strict check refuses it, which also covers assertLocalDateTime's date part.
  for (const fake of ['2026-02-30', '2026-04-31', '2026-06-31', '2026-11-31']) {
    expect(() => assertIsoDate(fake, 'task due date')).toThrow(
      'Invalid task due date: expected a YYYY-MM-DD date'
    );
  }
  // 2026 is not a leap year; 2024 is.
  expect(() => assertIsoDate('2026-02-29', 'task due date')).toThrow(/Invalid task due date/);
  expect(assertIsoDate('2024-02-29', 'task due date')).toBe('2024-02-29');
  expect(assertIsoDate('2026-12-31', 'task due date')).toBe('2026-12-31');
  // Malformed shapes are still refused.
  for (const bad of ['2026-1-01', '12-01', '2026/12/01', '明天', '']) {
    expect(() => assertIsoDate(bad, 'task due date')).toThrow(/Invalid task due date/);
  }
  // assertLocalDateTime keeps its wall-clock check and now also rejects a fake
  // day, since its date part goes through assertIsoDate.
  expect(assertLocalDateTime('2026-11-01T09:00', 'task start time')).toBe('2026-11-01T09:00');
  expect(() => assertLocalDateTime('2026-02-30T09:00', 'task start time')).toThrow(
    /Invalid task start time/
  );
});

test('getWorkspaceSnapshot rejects path escapes in workspace ids', async () => {
  const service = createWorkspaceService(root);
  for (const workspaceId of ESCAPES) {
    await expect(service.getWorkspaceSnapshot(workspaceId)).rejects.toThrow(/Invalid workspace id|not found/i);
  }
});

test('createTask rejects path escapes in workspace ids and due dates', async () => {
  const service = createWorkspaceService(root);
  for (const workspaceId of ESCAPES) {
    await expect(
      service.createTask({ workspaceId, title: 'x', subject: '', durationMin: 10, acceptance: '' })
    ).rejects.toThrow(/Invalid workspace id|not found/i);
  }
  for (const due of ['../2026-10-31', '2026-10-31/..', '2026/10/31', '20261031', '..']) {
    await expect(
      service.createTask({ workspaceId: 'kaoyan', title: 'x', subject: '', durationMin: 10, acceptance: '', due })
    ).rejects.toThrow(/Invalid task due date/i);
  }
});

test('updateWorkspaceTask rejects path escapes in task ids', async () => {
  const service = createWorkspaceService(root);
  for (const taskId of ['../k1', '..\\k1', 'k1/../../workspace.md', '/k1', 'a/b']) {
    await expect(service.updateWorkspaceTask({ taskId, status: 'done' })).rejects.toThrow(/Invalid task id/i);
  }
});

test('updateNote rejects path escapes in note ids', async () => {
  const service = createWorkspaceService(root);
  for (const noteId of ['../n1', '..\\n1', 'n1/../../memory', '/n1']) {
    await expect(service.updateNote({ noteId, body: 'x' })).rejects.toThrow(/Invalid note id/i);
  }
});

test('getMemory rejects path escapes', async () => {
  const service = createWorkspaceService(root);
  await expect(service.getMemory('../kaoyan')).rejects.toThrow(/Invalid workspace id/i);
});

test('submitReview rejects malformed dates and unknown workspaces', async () => {
  const service = createWorkspaceService(root);
  for (const date of ['../../2026-10-31', '2026-10-31/..', '31-10-2026', 'not-a-date', '']) {
    await expect(
      service.submitReview({ date, answers: { completed: '', stuck: '', tomorrow: '' } })
    ).rejects.toThrow(/Invalid review date/i);
  }
  await expect(
    service.submitReview({ date: '2026-10-31', workspaceId: '../kaoyan', answers: { completed: '', stuck: '', tomorrow: '' } })
  ).rejects.toThrow(/Invalid workspace id|not found/i);
});

test('createWorkspace sanitizes hostile names into safe folder ids', async () => {
  const service = createWorkspaceService(root);
  const created = await service.createWorkspace({
    name: '../../../etc//passwd',
    kind: 'study',
    goal: '',
    description: ''
  });
  expect(created.id).toMatch(/^[\p{L}\p{N}_][\p{L}\p{N}_-]*$/u);
  expect(created.id).not.toContain('/');
  expect(created.id).not.toContain('.');

  const snapshot = await service.getWorkspaceSnapshot(created.id);
  expect(snapshot.workspace.name).toBe('../../../etc//passwd');
});

test('after every rejected escape nothing was written outside the vault root', async () => {
  const service = createWorkspaceService(root);
  const attempts: Promise<unknown>[] = [
    service.getWorkspaceSnapshot('../escape').catch(() => undefined),
    service.createTask({ workspaceId: '../../etc', title: 'x', subject: '', durationMin: 1, acceptance: '' }).catch(() => undefined),
    service.updateWorkspaceTask({ taskId: '../k1', status: 'done' }).catch(() => undefined),
    service.updateNote({ noteId: '../n1', body: 'x' }).catch(() => undefined),
    service.getMemory('..\\kaoyan').catch(() => undefined),
    service.submitReview({ date: '../2026-10-31', answers: { completed: '', stuck: '', tomorrow: '' } }).catch(() => undefined)
  ];
  await Promise.all(attempts);

  const parentAfter = await readdir(dirname(root));
  // The parent is private to this test, so anything new would be a leak.
  const appeared = parentAfter.filter((name) => !parentBefore.includes(name));
  expect(appeared).toEqual([]);

  const tree = await walk(root);
  for (const file of tree) {
    const relative = file.slice(root.length + 1);
    expect(relative.startsWith('..')).toBe(false);
  }
  // The vault itself only holds the seeded workspaces dir (plus reminders).
  const top = await readdir(root);
  expect(top.filter((entry) => !entry.startsWith('.')).sort()).toEqual(['reminders.md', 'workspaces']);
});

async function walk(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else files.push(child);
  }
  return files;
}
