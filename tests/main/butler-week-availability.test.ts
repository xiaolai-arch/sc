import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createButlerTools, executeButlerTool } from '../../src/main/butler/tools';
import { createAvailabilityService } from '../../src/main/availability/service';
import type { AvailabilityService, SetWeekAvailabilityInput } from '../../src/main/availability/service';
import type { WeekAvailability } from '../../src/main/availability/records';
import type { WorkspaceService } from '../../src/shared/workspace';

/** 2026-11-22 is a Sunday; the coming Monday is 2026-11-23. */
const NOW_22 = () => new Date('2026-11-22T20:30:00');
const NOW_MONDAY = () => new Date('2026-11-23T08:00:00');

const workspaceService = {
  listWorkspaces: async () => []
} as unknown as WorkspaceService;

function availabilityStub(overrides: Partial<AvailabilityService> = {}): AvailabilityService {
  return {
    list: async () => [],
    busyDatesBetween: async () => [],
    set: async (input: SetWeekAvailabilityInput): Promise<WeekAvailability> => ({
      id: 'wa-new',
      weekStart: input.weekStart,
      busyDates: [...input.busyDates].sort(),
      createdAt: '2026-11-22T20:30:00.000Z',
      ...(input.note ? { note: input.note } : {})
    }),
    ...overrides
  };
}

interface SetCall {
  weekStart: string;
  busyDates: string[];
  note?: string;
}

function recordedSet(calls: SetCall[]): AvailabilityService {
  return availabilityStub({
    set: async (input: SetWeekAvailabilityInput) => {
      calls.push({
        weekStart: input.weekStart,
        busyDates: [...input.busyDates],
        ...(input.note !== undefined ? { note: input.note } : {})
      });
      return {
        id: 'wa-new',
        weekStart: input.weekStart,
        busyDates: [...input.busyDates].sort(),
        createdAt: '2026-11-22T20:30:00.000Z',
        ...(input.note ? { note: input.note } : {})
      };
    }
  });
}

async function run(
  arguments_: Record<string, unknown>,
  availability?: AvailabilityService | null,
  now: () => Date = NOW_22
) {
  return executeButlerTool(
    { id: 'w1', name: 'set_week_availability', arguments: arguments_ },
    createButlerTools(),
    {
      workspace: workspaceService,
      // undefined wires a default stub; null omits the service entirely.
      ...(availability === undefined
        ? { weekAvailability: availabilityStub() }
        : availability !== null
          ? { weekAvailability: availability }
          : {}),
      now
    }
  );
}

function payload(result: { ok: boolean; content: string }): {
  ok: boolean;
  result: { message: string; weekStart: string; busyDates: string[] };
} {
  return JSON.parse(result.content) as never;
}

test('set_week_availability maps weekdays onto next week and confirms with weekday words', async () => {
  const calls: SetCall[] = [];
  const result = await run(
    { weekStart: '2026-11-23', busyDays: [4, 2] },
    recordedSet(calls)
  );

  expect(result.ok).toBe(true);
  // Weekdays are de-duplicated, sorted, and mapped inside that week: 2 → 周二,
  // 4 → 周四 of the week starting Monday 2026-11-23.
  expect(calls).toEqual([
    { weekStart: '2026-11-23', busyDates: ['2026-11-24', '2026-11-26'] }
  ]);
  const parsed = payload(result);
  expect(parsed.result.message).toBe(
    '已记下：下周 周二、周四 会特别满，那几天我只给你排一件小事。'
  );
  expect(parsed.result.busyDates).toEqual(['2026-11-24', '2026-11-26']);
});

test('set_week_availability keeps all seven days and the note', async () => {
  const calls: SetCall[] = [];
  const result = await run(
    {
      weekStart: '2026-11-23',
      busyDays: [7, 6, 5, 4, 3, 2, 1],
      note: '期末周'
    },
    recordedSet(calls)
  );

  expect(result.ok).toBe(true);
  expect(calls[0]?.busyDates).toEqual([
    '2026-11-23',
    '2026-11-24',
    '2026-11-25',
    '2026-11-26',
    '2026-11-27',
    '2026-11-28',
    '2026-11-29'
  ]);
  expect(calls[0]?.note).toBe('期末周');
  expect(payload(result).result.message).toBe(
    '已记下：下周 周一、周二、周三、周四、周五、周六、周日 会特别满，那几天我只给你排一件小事。'
  );
});

test('set_week_availability names 本周 when the Monday is the current week', async () => {
  const result = await run(
    { weekStart: '2026-11-23', busyDays: [5] },
    undefined,
    NOW_MONDAY
  );
  expect(result.ok).toBe(true);
  expect(payload(result).result.message).toBe(
    '已记下：本周 周五 会特别满，那几天我只给你排一件小事。'
  );
});

test('set_week_availability replaces the same week on a second call', async () => {
  await withVault(async (root) => {
    const service = createAvailabilityService({ root, now: NOW_22 });
    const tools = createButlerTools();
    const context = { workspace: workspaceService, weekAvailability: service, now: NOW_22 };

    const first = await executeButlerTool(
      {
        id: 'w2',
        name: 'set_week_availability',
        arguments: { weekStart: '2026-11-23', busyDays: [1, 2, 3] }
      },
      tools,
      context
    );
    expect(first.ok).toBe(true);

    const second = await executeButlerTool(
      {
        id: 'w3',
        name: 'set_week_availability',
        arguments: { weekStart: '2026-11-23', busyDays: [4] }
      },
      tools,
      context
    );
    expect(second.ok).toBe(true);

    const records = await service.list();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      weekStart: '2026-11-23',
      busyDates: ['2026-11-26']
    });
    expect(payload(second).result.message).toBe(
      '已记下：下周 周四 会特别满，那几天我只给你排一件小事。'
    );
  });
});

test.each([
  ['not a Monday', { weekStart: '2026-11-24', busyDays: [2] }],
  ['a past Monday', { weekStart: '2026-11-16', busyDays: [2] }],
  ['beyond two weeks', { weekStart: '2026-12-07', busyDays: [2] }],
  ['not a date', { weekStart: '下周', busyDays: [2] }],
  ['empty busyDays', { weekStart: '2026-11-23', busyDays: [] }],
  ['weekday out of range', { weekStart: '2026-11-23', busyDays: [8] }],
  ['weekday zero', { weekStart: '2026-11-23', busyDays: [0] }],
  ['weekday not an integer', { weekStart: '2026-11-23', busyDays: [2.5] }],
  ['busyDays not an array', { weekStart: '2026-11-23', busyDays: '周二' }]
])('rejects %s in Chinese', async (_label, args) => {
  const result = await run(args as Record<string, unknown>);
  expect(result.ok).toBe(false);
  const parsed = JSON.parse(result.content) as { error: string };
  expect(
    parsed.error === '日期必须是接下来两周内的周一（YYYY-MM-DD）。' ||
      parsed.error === '请说出下周特别满的是哪几天（周一至周日）。'
  ).toBe(true);
});

test('today..today+14 accepts both coming Mondays', async () => {
  // From Sunday 2026-11-22, today+14 is 2026-12-06, so 11-23 and 11-30 pass.
  const first = await run({ weekStart: '2026-11-30', busyDays: [1] });
  expect(first.ok).toBe(true);
  // But the Monday after that is out of range.
  const second = await run({ weekStart: '2026-12-07', busyDays: [1] });
  expect(second.ok).toBe(false);
  expect(JSON.parse(second.content)).toMatchObject({
    error: '日期必须是接下来两周内的周一（YYYY-MM-DD）。'
  });
});

test('missing weekStart keeps the standard missing-parameter error', async () => {
  const result = await run({ busyDays: [2] });
  expect(result.ok).toBe(false);
  expect(result.content).toContain('缺少参数 weekStart');
});

test('the tool refuses without an availability service', async () => {
  const result = await run(
    { weekStart: '2026-11-23', busyDays: [2] },
    null
  );
  expect(result.ok).toBe(false);
  expect(result.content).toContain('当前版本不支持记录一周安排。');
});

test('a broken service surfaces as a Chinese tool error', async () => {
  const availability = availabilityStub({
    set: async () => {
      throw new Error('备注不能超过 100 字。');
    }
  });
  const result = await run(
    { weekStart: '2026-11-23', busyDays: [2], note: '长'.repeat(101) },
    availability
  );
  expect(result.ok).toBe(false);
  expect(result.content).toContain('备注不能超过 100 字');
});

async function withVault(runInner: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-week-availability-tool-'));
  try {
    await runInner(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
