import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAvailabilityService } from '../../src/main/availability/service';
import {
  isInsideWeek,
  isIsoDate,
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

test('isIsoDate refuses days the calendar rolls over', () => {
  for (const fake of ['2026-02-30', '2026-04-31', '2026-06-31', '2026-11-31']) {
    expect(isIsoDate(fake)).toBe(false);
  }
  // 2026 is not a leap year; 2024 is.
  expect(isIsoDate('2026-02-29')).toBe(false);
  expect(isIsoDate('2024-02-29')).toBe(true);
  expect(isIsoDate('2026-12-31')).toBe(true);
  expect(isIsoDate('2026-01-01')).toBe(true);
  // Malformed shapes are still refused.
  expect(isIsoDate('2026-1-01')).toBe(false);
  expect(isIsoDate('12-01')).toBe(false);
  expect(isIsoDate('下周')).toBe(false);
  expect(isIsoDate(undefined)).toBe(false);
  // isMonday inherits the strict check, so a fake Monday is refused.
  expect(isMonday('2026-02-30')).toBe(false);
});

test('a stored fake weekStart is repaired on read and survives the next write', async () => {
  // `2026-02-30` used to be read as Monday 2026-03-02, so the week is kept as
  // the week of 03-02 rather than dropped, and its busy day is repaired too.
  await withVault(async (root) => {
    const raw = [
      '---',
      'type: log',
      'source: user',
      'kind: week-availability',
      'items:',
      '  - id: wa-fake',
      "    weekStart: '2026-02-30'",
      "    busyDates: ['2026-02-30', '2026-03-03']",
      "    createdAt: '2026-02-01T20:30:00.000Z'",
      '---',
      '# 下周安排',
      '',
      ''
    ].join('\n');
    await writeFile(weekAvailabilityFile(root), raw, 'utf8');

    const service = createAvailabilityService({ root, now: () => NOW });
    // Repaired to the real Monday and real days, not dropped.
    expect(await service.list()).toEqual([
      {
        id: 'wa-fake',
        weekStart: '2026-03-02',
        busyDates: ['2026-03-02', '2026-03-03'],
        createdAt: '2026-02-01T20:30:00.000Z'
      }
    ]);
    // A pure read does not rewrite the file.
    expect(await readFile(weekAvailabilityFile(root), 'utf8')).toBe(raw);

    // The first write persists the repaired week; the promise is not lost.
    await service.set({ weekStart: '2026-03-09', busyDates: ['2026-03-10'] });
    const reread = parseWeekAvailabilityFile(
      await readFile(weekAvailabilityFile(root), 'utf8')
    );
    expect(reread.find((entry) => entry.id === 'wa-fake')).toMatchObject({
      weekStart: '2026-03-02',
      busyDates: ['2026-03-02', '2026-03-03']
    });
  });
});

test('a stored busy day that rolls out of its week is repaired or dropped', () => {
  // `2026-11-31` reads as 2026-12-01, which is not in the 11-30 week, so it is
  // dropped — but the week itself still parses because 2026-11-31 as a
  // `weekStart` is not a Monday under the old rule either.
  const raw = [
    '---',
    'type: log',
    'source: user',
    'kind: week-availability',
    'items:',
    '  - id: wa-busy',
    "    weekStart: '2026-11-30'",
    "    busyDates: ['2026-11-31', '2026-12-01']",
    "    createdAt: '2026-11-29T20:30:00.000Z'",
    '---',
    '# 下周安排',
    '',
    ''
  ].join('\n');
  // Both entries repair to 2026-12-01, which is that week's Tuesday, deduped.
  expect(parseWeekAvailabilityFile(raw)).toEqual([
    {
      id: 'wa-busy',
      weekStart: '2026-11-30',
      busyDates: ['2026-12-01'],
      createdAt: '2026-11-29T20:30:00.000Z'
    }
  ]);
});

test('a repaired fake week and the real week collapse into one record', async () => {
  // sc-review follow-up: after the read-repair, a vault that holds BOTH the
  // fake `2026-02-30` week (the old parser read it as Monday 2026-03-02) and
  // a real 03-02 record must parse to ONE week, not two. The real record
  // survives (earliest createdAt) with its id and createdAt; busy days are
  // the union; the survivor's missing note falls back to the other record's.
  await withVault(async (root) => {
    const raw = [
      '---',
      'type: log',
      'source: user',
      'kind: week-availability',
      'items:',
      '  - id: wa-fake',
      "    weekStart: '2026-02-30'",
      "    busyDates: ['2026-02-30']",
      "    note: '开学前赶due的一周'",
      "    createdAt: '2026-02-24T20:30:00.000Z'",
      '  - id: wa-real',
      "    weekStart: '2026-03-02'",
      "    busyDates: ['2026-03-03']",
      "    createdAt: '2026-02-20T20:30:00.000Z'",
      '---',
      '# 下周安排',
      '',
      ''
    ].join('\n');
    await writeFile(weekAvailabilityFile(root), raw, 'utf8');

    const service = createAvailabilityService({ root, now: () => NOW });
    expect(await service.list()).toEqual([
      {
        id: 'wa-real',
        weekStart: '2026-03-02',
        busyDates: ['2026-03-02', '2026-03-03'],
        note: '开学前赶due的一周',
        createdAt: '2026-02-20T20:30:00.000Z'
      }
    ]);
    // A pure read does not rewrite the file.
    expect(await readFile(weekAvailabilityFile(root), 'utf8')).toBe(raw);

    // The first write persists exactly one record for that week.
    await service.set({ weekStart: '2026-03-09', busyDates: ['2026-03-10'] });
    const reread = parseWeekAvailabilityFile(
      await readFile(weekAvailabilityFile(root), 'utf8')
    );
    expect(reread.map((entry) => entry.weekStart)).toEqual([
      '2026-03-02',
      '2026-03-09'
    ]);
    expect(reread[0]).toMatchObject({
      id: 'wa-real',
      createdAt: '2026-02-20T20:30:00.000Z',
      busyDates: ['2026-03-02', '2026-03-03'],
      note: '开学前赶due的一周'
    });
  });
});

test('the merge never touches a file whose weeks are distinct', () => {
  // Weeks deliberately out of ascending order: a clean file must keep its
  // exact records and order, so a parse→serialize round trip stays identical.
  const clean: WeekAvailability[] = [
    {
      id: 'wa-later',
      weekStart: '2026-12-07',
      busyDates: ['2026-12-09'],
      createdAt: '2026-11-22T20:30:00.000Z'
    },
    {
      id: 'wa-earlier',
      weekStart: '2026-11-23',
      busyDates: ['2026-11-24'],
      note: '期末周，全天都在赶due',
      createdAt: '2026-11-15T20:30:00.000Z'
    }
  ];
  const raw = serializeWeekAvailabilityFile(clean);
  expect(parseWeekAvailabilityFile(raw)).toEqual(clean);
  expect(serializeWeekAvailabilityFile(parseWeekAvailabilityFile(raw))).toBe(raw);
});

test('same-week duplicates collapse identically regardless of their order in the file', () => {
  // Same createdAt: the tie falls to the smaller id (wa-a), so both orders of
  // the same two entries parse to one identical merged record — and the
  // survivor's own note wins over the other record's.
  const file = (entries: string[]) =>
    [
      '---',
      'type: log',
      'source: user',
      'kind: week-availability',
      'items:',
      ...entries,
      '---',
      '# 下周安排',
      '',
      ''
    ].join('\n');
  const a = [
    '  - id: wa-a',
    "    weekStart: '2026-11-23'",
    "    busyDates: ['2026-11-24']",
    "    note: '甲的备注'",
    "    createdAt: '2026-11-22T20:30:00.000Z'"
  ];
  const b = [
    '  - id: wa-b',
    "    weekStart: '2026-11-23'",
    "    busyDates: ['2026-11-26']",
    "    note: '乙的备注'",
    "    createdAt: '2026-11-22T20:30:00.000Z'"
  ];
  const merged = [
    {
      id: 'wa-a',
      weekStart: '2026-11-23',
      busyDates: ['2026-11-24', '2026-11-26'],
      note: '甲的备注',
      createdAt: '2026-11-22T20:30:00.000Z'
    }
  ];
  expect(parseWeekAvailabilityFile(file([...a, ...b]))).toEqual(merged);
  expect(parseWeekAvailabilityFile(file([...b, ...a]))).toEqual(merged);
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
    // A fake Monday the old Date parser rolled over is refused, not stored.
    await expect(
      service.set({ weekStart: '2026-02-30', busyDates: ['2026-03-02'] })
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
