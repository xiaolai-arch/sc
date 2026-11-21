import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultSettings } from '../../src/main/settings/defaults';
import { createDeliveryLog } from '../../src/main/scheduler/delivery-log';
import { Scheduler } from '../../src/main/scheduler/scheduler';
import type { AppSettings } from '../../src/shared/types';

let root: string;
let file: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'asaki-delivery-log-'));
  file = join(root, 'scheduler-delivered.json');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('records delivered keys and parses them back', async () => {
  const log = createDeliveryLog(file);

  await log.save('2026-11-22', ['2026-11-22:reminder:water', '2026-11-22:morning-plan:morning']);

  expect(await log.load('2026-11-22')).toEqual([
    '2026-11-22:reminder:water',
    '2026-11-22:morning-plan:morning'
  ]);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  expect(stored).toEqual({
    date: '2026-11-22',
    keys: ['2026-11-22:reminder:water', '2026-11-22:morning-plan:morning']
  });
});

test('save replaces the stored set and drops duplicate keys', async () => {
  const log = createDeliveryLog(file);
  await log.save('2026-11-22', ['a', 'b', 'a']);

  expect(await log.load('2026-11-22')).toEqual(['a', 'b']);

  await log.save('2026-11-22', ['b', 'c']);
  expect(await log.load('2026-11-22')).toEqual(['b', 'c']);
});

test('an absent log is an empty log', async () => {
  const log = createDeliveryLog(file);
  expect(await log.load('2026-11-22')).toEqual([]);
});

test('a stored day only answers for that same day', async () => {
  const log = createDeliveryLog(file);
  await log.save('2026-11-21', ['2026-11-21:reminder:water']);

  expect(await log.load('2026-11-21')).toEqual(['2026-11-21:reminder:water']);
  // Yesterday's file must not block today: the module keeps only one day.
  expect(await log.load('2026-11-22')).toEqual([]);
});

test('a hand-edited file with non-string keys parses tolerantly', async () => {
  await writeFile(
    file,
    JSON.stringify({ date: '2026-11-22', keys: ['a', 1, null, 'b', { x: 1 }] }),
    'utf8'
  );

  expect(await createDeliveryLog(file).load('2026-11-22')).toEqual(['a', 'b']);
});

test('garbage or partial JSON parses to empty without throwing, and the next save repairs it', async () => {
  const log = createDeliveryLog(file);
  for (const corrupt of ['not json at all', '{"date":"2026-11-22","keys":["a"', '[]', 'null']) {
    await writeFile(file, corrupt, 'utf8');
    await expect(log.load('2026-11-22')).resolves.toEqual([]);
  }

  await log.save('2026-11-22', ['2026-11-22:reminder:water']);

  expect(await log.load('2026-11-22')).toEqual(['2026-11-22:reminder:water']);
  const repaired = JSON.parse(await readFile(file, 'utf8'));
  expect(repaired.date).toBe('2026-11-22');
  expect(repaired.keys).toEqual(['2026-11-22:reminder:water']);
});

test('a shape-valid file with a non-string date is treated as corrupt', async () => {
  await writeFile(file, JSON.stringify({ date: 42, keys: ['a'] }), 'utf8');
  expect(await createDeliveryLog(file).load('2026-11-22')).toEqual([]);
});

test('concurrent saves never leave a torn file (last writer wins)', async () => {
  // The module has no lock: writes are atomic temp-file renames, so overlapping
  // saves may land in either order but the file always parses to one full set.
  const log = createDeliveryLog(file);
  await Promise.all([
    log.save('2026-11-22', ['a', 'b']),
    log.save('2026-11-22', ['c', 'd']),
    log.save('2026-11-22', ['e'])
  ]);

  const keys = await log.load('2026-11-22');
  expect([['a', 'b'], ['c', 'd'], ['e']]).toContainEqual(keys);
});

function settings(): AppSettings {
  const base = createDefaultSettings('/tmp/vault');
  return {
    ...base,
    notifications: {
      ...base.notifications,
      // Keep the fixed check-ins out of the way; only the reminder matters.
      morning: '23:50',
      evening: '23:55',
      weeklyEnabled: false,
      behindScheduleEnabled: false
    }
  };
}

/** A real file-backed log driving the real Scheduler, i.e. the restart promise. */
async function deliverOn(logPath: string, now: Date): Promise<string[]> {
  const scheduler = new Scheduler({
    now: () => now,
    getSettings: async () => settings(),
    getReminders: async () => [{ id: 'water', time: '11:00', label: '喝水', enabled: true }],
    notify: () => undefined,
    deliveryLog: createDeliveryLog(logPath)
  });
  const result = await scheduler.tick();
  return result.delivered.map((entry) => entry.reminderId ?? entry.key);
}

test('a restart on the same day does not re-deliver a reminder', async () => {
  const now = new Date(2026, 10, 22, 12, 0, 0);

  expect(await deliverOn(file, now)).toEqual(['water']);

  // Same day, fresh process (fresh in-memory state) — the file suppresses it.
  expect(await deliverOn(file, now)).toEqual([]);

  const stored = JSON.parse(await readFile(file, 'utf8'));
  expect(stored.date).toBe('2026-11-22');
  expect(stored.keys).toEqual(['2026-11-22:reminder:water']);
});

test('the next day delivers again even though yesterday was logged', async () => {
  const dayOne = new Date(2026, 10, 22, 12, 0, 0);
  const dayTwo = new Date(2026, 10, 23, 12, 0, 0);

  expect(await deliverOn(file, dayOne)).toEqual(['water']);
  expect(await deliverOn(file, dayTwo)).toEqual(['water']);

  const stored = JSON.parse(await readFile(file, 'utf8'));
  expect(stored.date).toBe('2026-11-23');
  expect(stored.keys).toEqual(['2026-11-23:reminder:water']);
});
