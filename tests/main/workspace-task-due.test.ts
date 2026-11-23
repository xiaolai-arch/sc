import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import {
  parseTaskFile,
  serializeTaskFile,
  type TaskRecord
} from '../../src/main/workspace/records/tasks';

const FAKE = '2026-02-30';
const CLAMPED = '2026-02-28';
const FILE_DATE = '2026-03-01';

/**
 * A task file whose `due` was written by the old lenient validator: built by
 * serializing a clean record and then faking only the due value, so the layout
 * is byte-for-byte what this app (or an old version of it) writes.
 */
function legacyFile(due: string): string {
  const record: TaskRecord = {
    id: 't-fake',
    title: '真题',
    subject: '数学',
    durationMin: 45,
    materialRefs: [],
    acceptance: '做完一套',
    status: 'pending',
    due: CLAMPED,
    created: '2026-03-01T08:00:00.000Z',
    updated: '2026-03-01T08:00:00.000Z'
  };
  return serializeTaskFile(FILE_DATE, [record]).replace(CLAMPED, due);
}

test('a stored fake due is clamped to a real day on read', () => {
  // The impossible day the Date constructor rolls over reads back as the last
  // real day of the month it was written for, so the renderer's date control
  // shows the intended day instead of silently clearing it on first edit.
  const tasks = parseTaskFile(legacyFile(FAKE));
  expect(tasks).toHaveLength(1);
  expect(tasks[0]?.due).toBe(CLAMPED);
  // The clamp stays inside the written month: April 31 clamps to April 30.
  expect(parseTaskFile(legacyFile('2026-04-31'))[0]?.due).toBe('2026-04-30');
});

test('a due with no determinate real day is dropped but the task survives', () => {
  // Month 13, a non-date string, and a shape that is not YYYY-MM-DD have no
  // real day to clamp to; the unrepairable field is dropped while every other
  // field of the task is kept.
  for (const undatable of ['2026-13-01', '2026-1-5', '明天', 'soon']) {
    const tasks = parseTaskFile(legacyFile(undatable));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.title).toBe('真题');
    expect(tasks[0]?.due).toBeUndefined();
  }
});

test('a real due passes through untouched, byte for byte', () => {
  const raw = legacyFile('2026-11-24');
  const tasks = parseTaskFile(raw);
  expect(tasks[0]?.due).toBe('2026-11-24');
  expect(serializeTaskFile(FILE_DATE, tasks)).toBe(raw);
});

test('the repair persists on the next write', () => {
  const repaired = serializeTaskFile(FILE_DATE, parseTaskFile(legacyFile(FAKE)));
  expect(repaired).not.toContain(FAKE);
  expect(repaired).toContain(CLAMPED);
  // And the repaired file reads back to the same day.
  expect(parseTaskFile(repaired)[0]?.due).toBe(CLAMPED);
});

test('the snapshot exposes the repaired due the renderer would edit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workspace-task-due-'));
  try {
    const service = createWorkspaceService(dir, { seed: false });
    const workspace = await service.createWorkspace({
      name: '考研',
      kind: 'exam',
      goal: '上岸',
      description: ''
    });
    const legacy = legacyFile(FAKE);
    const tasksDir = join(dir, 'workspaces', workspace.id, 'tasks');
    await mkdir(tasksDir, { recursive: true });
    const taskFile = join(tasksDir, `${FILE_DATE}.md`);
    await writeFile(taskFile, legacy, 'utf8');

    const snapshot = await service.getWorkspaceSnapshot(workspace.id);
    expect(snapshot.tasks.find((task) => task.id === 't-fake')?.due).toBe(CLAMPED);
    // A pure read does not rewrite the legacy file.
    expect(await readFile(taskFile, 'utf8')).toBe(legacy);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
