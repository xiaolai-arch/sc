import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAvailabilityService } from '../../src/main/availability/service';
import {
  isInsideWeek,
  isMonday,
  parseWeekAvailabilityFile,
  serializeWeekAvailabilityFile,
  weekdayWord,
  MAX_WEEK_NOTE,
  type WeekAvailability
} from '../../src/main/availability/records';
import { weekAvailabilityFile } from '../../src/main/workspace/paths';

const NOW = new Date('2026-11-22T20:30:00');

async function withVault(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-availability-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const sample: WeekAvailability[] = [
  {
    id: 'wa-1',
    weekStart: '2026-11-23',
    busyDates: ['2026-11-24', '2026-11-26'],
    createdAt: '2026-11-22T20:30:00.000Z'
  },
  {
    id: 'wa-2',
    weekStart: '2026-11-30',
    busyDates: ['2026-12-04', '2026-12-05', '2026-12-06'],
    note: '期末周，全天都在赶due',
    createdAt: '2026-11-22T20:31:00.000Z'
  }
];

test('a serialized file round-trips byte-identically', () => {
  const raw = serializeWeekAvailabilityFile(sample);
  const parsed = parseWeekAvailabilityFile(raw);
  expect(parsed).toEqual(sample);
  expect(serializeWeekAvailabilityFile(parsed)).toBe(raw);
});

test('reading and re-writing a legacy file changes nothing', async () => {
  await withVault(async (root) => {
    const raw = serializeWeekAvailabilityFile(sample);
    await writeFile(weekAvailabilityFile(root), raw, 'utf8');

    const service = createAvailabilityService({ root, now: () => NOW });
    // A pure read must not touch the file at all.
    expect(await service.list()).toEqual(sample);
    expect(await readFile(weekAvailabilityFile(root), 'utf8')).toBe(raw);

    // Replacing one week keeps the other week's parsed entry byte-for-byte.
    await service.set({ weekStart: '2026-11-30', busyDates: ['2026-12-02'] });
    const reread = parseWeekAvailabilityFile(
      await readFile(weekAvailabilityFile(root), 'utf8')
    );
    expect(reread).toHaveLength(2);
    expect(reread[0]).toEqual(sample[0]);
    expect(reread[1]).toMatchObject({
      weekStart: '2026-11-30',
      busyDates: ['2026-12-02']
    });
    // A brand-new week lands in week order without disturbing the others.
    await service.set({ weekStart: '2026-12-07', busyDates: ['2026-12-09'] });
    const weeks = parseWeekAvailabilityFile(
      await readFile(weekAvailabilityFile(root), 'utf8')
    ).map((entry) => entry.weekStart);
    expect(weeks).toEqual(['2026-11-23', '2026-11-30', '2026-12-07']);
  });
});

test('parse is tolerant: a bad entry is skipped, the rest survive', () => {
  const raw = [
    '---',
    'type: log',
    'source: user',
    'kind: week-availability',
    'items:',
    '  - id: wa-ok',
    "    weekStart: '2026-11-23'",
    "    busyDates: ['2026-11-24']",
    "    createdAt: '2026-11-22T20:30:00.000Z'",
    '  - id: wa-not-monday',
    "    weekStart: '2026-11-24'",
    "    busyDates: ['2026-11-25']",
    "  - id: wa-no-dates",
    "    weekStart: '2026-11-30'",
    "    busyDates: []",
    '  - id: wa-outside-week',
    "    weekStart: '2026-11-30'",
    "    busyDates: ['2026-11-24']",
    '  - id: wa-bad-date',
    "    weekStart: '2026-12-07'",
    "    busyDates: ['2026-13-99']",
    '  - just a string',
    '---',
    '正文'
  ].join('\n');

  expect(parseWeekAvailabilityFile(raw)).toEqual([
    {
      id: 'wa-ok',
      weekStart: '2026-11-23',
      busyDates: ['2026-11-24'],
      createdAt: '2026-11-22T20:30:00.000Z'
    }
  ]);
});

test('parse normalizes hand-edited dates: dedupe, sort, drop out-of-week days', () => {
  const raw = [
    '---',
    'type: log',
    'source: user',
    'kind: week-availability',
    'items:',
    '  - id: wa-messy',
    "    weekStart: '2026-11-23'",
    "    busyDates: ['2026-11-26', '2026-11-24', '2026-11-26', '2026-11-27']",
    "    createdAt: '2026-11-22T20:30:00.000Z'",
    '---',
    '正文'
  ].join('\n');
  expect(parseWeekAvailabilityFile(raw)[0]?.busyDates).toEqual([
    '2026-11-24',
    '2026-11-26',
    '2026-11-27'
  ]);
});

test('an unrelated or empty file reads as no records', () => {
  expect(parseWeekAvailabilityFile('')).toEqual([]);
  expect(parseWeekAvailabilityFile('---\ntype: note\n---\n随手记')).toEqual([]);
});

test('isMonday, isInsideWeek and weekdayWord use pure date facts', () => {
  expect(isMonday('2026-11-23')).toBe(true);
  expect(isMonday('2026-11-22')).toBe(false);
  expect(isMonday('2026-13-40')).toBe(false);
  expect(isMonday(undefined)).toBe(false);
  expect(isInsideWeek('2026-11-23', '2026-11-23')).toBe(true);
  expect(isInsideWeek('2026-11-23', '2026-11-29')).toBe(true);
  expect(isInsideWeek('2026-11-23', '2026-11-30')).toBe(false);
  expect(isInsideWeek('2026-11-23', '2026-11-22')).toBe(false);
  // 2026-11-23 is the Monday, 2026-11-29 the Sunday of the same week.
  expect(weekdayWord('2026-11-23')).toBe('周一');
  expect(weekdayWord('2026-11-28')).toBe('周六');
  expect(weekdayWord('2026-11-29')).toBe('周日');
  expect(weekdayWord('soon')).toBeUndefined();
});

test('set stores sorted deduplicated dates with an optional trimmed note', async () => {
  await withVault(async (root) => {
    const service = createAvailabilityService({ root, now: () => NOW });
    const record = await service.set({
      weekStart: '2026-11-23',
      busyDates: ['2026-11-26', '2026-11-24', '2026-11-26'],
      note: '  有两门课的期末考  '
    });
    expect(record).toMatchObject({
      weekStart: '2026-11-23',
      busyDates: ['2026-11-24', '2026-11-26'],
      note: '有两门课的期末考',
      createdAt: NOW.toISOString()
    });
    expect(record.id).toMatch(/^wa-/);
  });
});

test('set rejects a non-Monday, a fake date, empty days, out-of-week days and long notes', async () => {
  await withVault(async (root) => {
    const service = createAvailabilityService({ root, now: () => NOW });
    await expect(
      service.set({ weekStart: '2026-11-24', busyDates: ['2026-11-24'] })
    ).rejects.toThrow('weekStart 必须是某一周的周一');
    await expect(
      service.set({ weekStart: '2026-13-40', busyDates: ['2026-11-24'] })
    ).rejects.toThrow('weekStart 必须是某一周的周一');
    await expect(
      service.set({ weekStart: '2026-11-23', busyDates: [] })
    ).rejects.toThrow('请说出这一周特别满的是哪几天');
    await expect(
      service.set({ weekStart: '2026-11-23', busyDates: ['2026-11-30'] })
    ).rejects.toThrow('busyDates 必须是 2026-11-23 到当周日之间');
    await expect(
      service.set({ weekStart: '2026-11-23', busyDates: ['2026-11-24'], note: '长'.repeat(MAX_WEEK_NOTE + 1) })
    ).rejects.toThrow(`备注不能超过 ${MAX_WEEK_NOTE} 字`);
    // Exactly 100 chars is accepted; an empty note is dropped.
    const ok = await service.set({
      weekStart: '2026-11-23',
      busyDates: ['2026-11-24'],
      note: '长'.repeat(MAX_WEEK_NOTE)
    });
    expect(ok.note).toHaveLength(MAX_WEEK_NOTE);
    const noNote = await service.set({
      weekStart: '2026-11-30',
      busyDates: ['2026-12-01'],
      note: '   '
    });
    expect(noNote.note).toBeUndefined();
  });
});

test('busyDatesBetween returns stored dates inside the range, ascending', async () => {
  await withVault(async (root) => {
    const service = createAvailabilityService({ root, now: () => NOW });
    await service.set({ weekStart: '2026-11-23', busyDates: ['2026-11-26'] });
    await service.set({
      weekStart: '2026-11-30',
      busyDates: ['2026-12-04', '2026-12-06']
    });
    expect(await service.busyDatesBetween('2026-11-24', '2026-12-05')).toEqual([
      '2026-11-26',
      '2026-12-04'
    ]);
    expect(await service.busyDatesBetween('2027-01-01', '2027-01-07')).toEqual([]);
    await expect(service.busyDatesBetween('soon', 'later')).rejects.toThrow(
      '需要两个 YYYY-MM-DD 日期'
    );
    // An inverted range is an empty range, not an error.
    expect(await service.busyDatesBetween('2026-12-05', '2026-11-24')).toEqual([]);
  });
});

test('a missing file reads as no records and set creates it', async () => {
  await withVault(async (root) => {
    const service = createAvailabilityService({ root, now: () => NOW });
    expect(await service.list()).toEqual([]);
    const record = await service.set({ weekStart: '2026-11-23', busyDates: ['2026-11-24'] });
    expect(await service.list()).toEqual([record]);
    // 2026-11-24 is the Tuesday of that week.
    expect(await readFile(weekAvailabilityFile(root), 'utf8')).toContain(
      '2026-11-23 那一周：周二特别满'
    );
  });
});

test('clear removes only that one week and keeps the others byte-identical', async () => {
  await withVault(async (root) => {
    const service = createAvailabilityService({ root, now: () => NOW });
    const firstWeek = await service.set({ weekStart: '2026-11-23', busyDates: ['2026-11-24'] });
    await service.set({ weekStart: '2026-11-30', busyDates: ['2026-12-04'], note: '期末周' });

    await service.clear('2026-11-23');
    const reread = parseWeekAvailabilityFile(
      await readFile(weekAvailabilityFile(root), 'utf8')
    );
    expect(reread).toHaveLength(1);
    expect(reread[0]).toMatchObject({ weekStart: '2026-11-30', busyDates: ['2026-12-04'], note: '期末周' });
    // The cleared week's record is gone from the file entirely.
    expect(await readFile(weekAvailabilityFile(root), 'utf8')).not.toContain(firstWeek.id);
    expect(await service.list()).toEqual(reread);

    // Clearing the last remaining week empties the list.
    await service.clear('2026-11-30');
    expect(await service.list()).toEqual([]);
    expect(parseWeekAvailabilityFile(await readFile(weekAvailabilityFile(root), 'utf8'))).toEqual([]);
  });
});

test('clear rejects a malformed weekStart and skips the write for an absent week', async () => {
  await withVault(async (root) => {
    const service = createAvailabilityService({ root, now: () => NOW });
    await service.set({ weekStart: '2026-11-23', busyDates: ['2026-11-24'] });
    const before = await readFile(weekAvailabilityFile(root), 'utf8');

    await expect(service.clear('2026-11-24')).rejects.toThrow('weekStart 必须是某一周的周一');
    await expect(service.clear('不是日期')).rejects.toThrow('weekStart 必须是某一周的周一');

    // A week that is not recorded leaves the file untouched — a second clear
    // of the same week (or a wrong-but-valid week) must not rewrite anything.
    await service.clear('2026-12-07');
    expect(await readFile(weekAvailabilityFile(root), 'utf8')).toBe(before);
    expect(await service.list()).toHaveLength(1);
  });
});
