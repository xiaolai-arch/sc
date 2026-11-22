import type { AppSettings } from '../../src/shared/types';
import {
  applyReminderStatePatch,
  reminderState,
  type Reminder,
  type ReminderStatePatch,
  type WorkspaceTask
} from '../../src/shared/workspace';
import { createDefaultSettings } from '../../src/main/settings/defaults';
import { Scheduler } from '../../src/main/scheduler/scheduler';
import {
  parseRemindersFile,
  serializeRemindersFile
} from '../../src/main/workspace/records/reminders';

function settings(overrides: Partial<AppSettings['notifications']> = {}): AppSettings {
  const base = createDefaultSettings('/tmp/vault');
  return {
    ...base,
    notifications: { ...base.notifications, morning: '15:00', ...overrides }
  };
}

function at(hour: number, minute: number): Date {
  return new Date(2026, 9, 31, hour, minute, 0);
}

/** The day after `at`: 2026-11-01, local time. */
function nextDayAt(hour: number, minute: number): Date {
  return new Date(2026, 10, 1, hour, minute, 0);
}

describe('Scheduler reminders', () => {
  test('fires each enabled reminder once and skips disabled ones', async () => {
    let now = at(11, 59);
    const reminders: Reminder[] = [
      { id: 'r1', time: '12:00', label: '喝水', enabled: true },
      { id: 'r2', time: '12:00', label: '停用', enabled: false },
      { id: 'r3', time: '12:00', label: '休息', enabled: true },
      { id: 'r4', time: '15:00', label: '早间计划', enabled: true }
    ];
    const notified: string[] = [];
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getReminders: async () => reminders,
      notify: (notification) => {
        notified.push(`${notification.kind}:${notification.reminderId}`);
      }
    });

    expect((await scheduler.tick()).delivered).toHaveLength(0);

    now = at(12, 0);
    const delivered = await scheduler.tick();
    expect(delivered.delivered.map((entry) => entry.reminderId).sort()).toEqual(['r1', 'r3']);
    expect(notified.sort()).toEqual(['reminder:r1', 'reminder:r3']);

    now = at(12, 1);
    expect((await scheduler.tick()).delivered).toHaveLength(0);
    expect(notified).toHaveLength(2);
  });

  test('a broken reminder read does not block the morning trigger', async () => {
    const now = at(15, 0);
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getReminders: async () => {
        throw new Error('reminders.md unreadable');
      },
      notify: () => undefined
    });

    const result = await scheduler.tick();
    expect(result.delivered.map((entry) => entry.kind)).toEqual(['morning-plan']);
  });
});

  test('skips the seed reminder that mirrors the morning check-in', async () => {
    const now = at(15, 0);
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getReminders: async () => [
        { id: 'r1', time: '15:00', label: '早间计划', enabled: true }
      ],
      notify: () => undefined
    });

    const result = await scheduler.tick();
    expect(result.delivered.map((entry) => entry.kind)).toEqual(['morning-plan']);
    expect(result.delivered.some((entry) => entry.reminderId === 'r1')).toBe(false);
  });

  test('fires a notification when a pinned task reaches its start time', async () => {
    let now = at(8, 59);
    const task: WorkspaceTask = {
      id: 't1',
      workspaceId: 'kaoyan',
      title: '数学真题',
      subject: '数学',
      durationMin: 45,
      acceptance: '',
      status: 'pending',
      startAt: '2026-10-31T09:00'
    };
    const base = settings();
    const notified: Array<{ kind: string; taskId?: string; title: string }> = [];
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => ({
        ...base,
        notifications: { ...base.notifications, morning: '23:00' }
      }),
      getReminders: async () => [],
      getScheduledTasks: async () => [task],
      notify: (notification) => {
        notified.push({
          kind: notification.kind,
          ...(notification.taskId ? { taskId: notification.taskId } : {}),
          title: notification.title
        });
      }
    });

    expect((await scheduler.tick()).delivered).toHaveLength(0);

    now = at(9, 0);
    const delivered = await scheduler.tick();
    expect(delivered.delivered.map((entry) => entry.kind)).toEqual(['task']);
    expect(notified).toEqual([{ kind: 'task', taskId: 't1', title: '现在该做：数学真题' }]);

    now = at(9, 1);
    expect((await scheduler.tick()).delivered).toHaveLength(0);
  });

  test('skips completed tasks and tasks pinned to another day', async () => {
    const now = at(9, 0);
    const base = settings();
    const tasks: WorkspaceTask[] = [
      {
        id: 'done',
        workspaceId: 'kaoyan',
        title: '已完成',
        subject: '数学',
        durationMin: 30,
        acceptance: '',
        status: 'done',
        startAt: '2026-10-31T09:00'
      },
      {
        id: 'tomorrow',
        workspaceId: 'kaoyan',
        title: '明天',
        subject: '数学',
        durationMin: 30,
        acceptance: '',
        status: 'pending',
        startAt: '2026-11-01T09:00'
      }
    ];
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => ({
        ...base,
        notifications: { ...base.notifications, morning: '23:00' }
      }),
      getReminders: async () => [],
      getScheduledTasks: async () => tasks,
      notify: () => undefined
    });

    const result = await scheduler.tick();
    expect(result.delivered).toHaveLength(0);
  });

  test('a broken task read does not block reminders', async () => {
    const now = at(15, 0);
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getReminders: async () => [],
      getScheduledTasks: async () => {
        throw new Error('tasks unreadable');
      },
      notify: () => undefined
    });

    const result = await scheduler.tick();
    expect(result.delivered.map((entry) => entry.kind)).toEqual(['morning-plan']);
  });

  test('keeps a user reminder that shares the check-in time', async () => {
    const now = at(15, 0);
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getReminders: async () => [
        { id: 'user-1', time: '15:00', label: '吃药', enabled: true }
      ],
      notify: () => undefined
    });

    const result = await scheduler.tick();
    expect(result.delivered.map((entry) => entry.kind).sort()).toEqual([
      'morning-plan',
      'reminder'
    ]);
    expect(result.delivered.some((entry) => entry.reminderId === 'user-1')).toBe(true);
  });

test('only fires a weekday-scoped reminder on its selected days', async () => {
  // 2026-10-31 is a Saturday (getDay() === 6).
  const now = at(12, 0);
  const scheduler = new Scheduler({
    now: () => now,
    getSettings: async () => settings(),
    getReminders: async () => [
      { id: 'weekday', time: '12:00', label: '工作日', enabled: true, days: [1, 2, 3, 4, 5] },
      { id: 'weekend', time: '12:00', label: '周末', enabled: true, days: [0, 6] },
      { id: 'daily', time: '12:00', label: '每天', enabled: true }
    ],
    notify: () => undefined
  });

  const result = await scheduler.tick();
  const ids = result.delivered
    .filter((entry) => entry.kind === 'reminder')
    .map((entry) => entry.reminderId)
    .sort();
  expect(ids).toEqual(['daily', 'weekend']);
});

test('a restart does not deliver the same reminder twice', async () => {
  const stored = new Map<string, string[]>();
  const deliveryLog = {
    load: async (date: string) => stored.get(date) ?? [],
    save: async (date: string, keys: readonly string[]) => {
      stored.set(date, [...keys]);
    }
  };
  const now = at(12, 0);
  const reminders: Reminder[] = [
    { id: 'water', time: '11:00', label: '喝水', enabled: true }
  ];
  const options = {
    now: () => now,
    getSettings: async () => settings(),
    getReminders: async () => reminders,
    notify: () => undefined,
    deliveryLog
  };

  const first = await new Scheduler(options).tick();
  expect(first.delivered.some((entry) => entry.reminderId === 'water')).toBe(true);

  // A new process (fresh in-memory set) must reload today's delivered keys.
  const afterRestart = await new Scheduler(options).tick();
  expect(afterRestart.delivered).toHaveLength(0);
});

test('reminders arrive even when no model is configured', async () => {
  const now = at(12, 0);
  const scheduler = new Scheduler({
    now: () => now,
    getSettings: async () => settings(),
    getReminders: async () => [
      { id: 'water', time: '12:00', label: '喝水', enabled: true }
    ],
    notify: () => undefined
  });

  const result = await scheduler.tick();
  expect(result.delivered.map((entry) => entry.reminderId)).toEqual(['water']);
});

describe('reminder lifecycle', () => {
  /** In-memory stand-in for `reminders.md`, keyed by id. */
  function lifecycle(initial: Reminder[]) {
    const records = new Map(initial.map((reminder) => [reminder.id, { ...reminder }]));
    const writes: Array<{ id: string; patch: ReminderStatePatch }> = [];
    return {
      records,
      writes,
      getReminders: async () => [...records.values()].map((reminder) => ({ ...reminder })),
      onReminderState: (id: string, patch: ReminderStatePatch) => {
        writes.push({ id, patch });
        const current = records.get(id);
        if (!current) return;
        if (patch.state !== undefined) current.state = patch.state;
        for (const field of ['firedAt', 'postponedTo', 'doneAt', 'lastError'] as const) {
          const value = patch[field];
          if (value === undefined) continue;
          if (value === null) delete current[field];
          else current[field] = value;
        }
      }
    };
  }

  test('a legacy reminder without a state reads as pending', () => {
    const raw = [
      '---',
      'type: plan',
      'source: user',
      'items:',
      '  - id: r1',
      '    time: "08:00"',
      '    label: 早间计划',
      '    enabled: true',
      '---',
      '# 提醒',
      ''
    ].join('\n');
    const [reminder] = parseRemindersFile(raw);
    expect(reminder).toMatchObject({ id: 'r1', label: '早间计划' });
    // The field stays out of the parsed record; every reader defaults it.
    expect(reminder).not.toHaveProperty('state');
    expect(reminderState(reminder!)).toBe('pending');
    expect(reminder).not.toHaveProperty('postponedTo');
    expect(reminder).not.toHaveProperty('lastError');
  });

  test('delivery records fired with a timestamp', async () => {
    const store = lifecycle([{ id: 'water', time: '12:00', label: '喝水', enabled: true }]);
    const now = at(12, 0);
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getReminders: store.getReminders,
      onReminderState: store.onReminderState,
      notify: () => undefined
    });

    await scheduler.tick();

    const record = store.records.get('water');
    expect(record?.state).toBe('fired');
    expect(record?.firedAt).toBe(now.toISOString());
    expect(store.writes).toEqual([
      {
        id: 'water',
        patch: {
          state: 'fired',
          firedAt: now.toISOString(),
          postponedTo: null,
          doneAt: null,
          lastError: null
        }
      }
    ]);
  });

  test('a sink failure records failed with lastError', async () => {
    const store = lifecycle([{ id: 'water', time: '12:00', label: '喝水', enabled: true }]);
    const scheduler = new Scheduler({
      now: () => at(12, 0),
      getSettings: async () => settings(),
      getReminders: store.getReminders,
      onReminderState: store.onReminderState,
      notify: () => {
        throw new Error('notification unavailable');
      }
    });

    await scheduler.tick();

    const record = store.records.get('water');
    expect(record?.state).toBe('failed');
    expect(record?.lastError).toBe('notification unavailable');
  });

  test('DND leaves the reminder pending instead of fired', async () => {
    const store = lifecycle([{ id: 'water', time: '23:30', label: '喝水', enabled: true }]);
    const now = at(23, 31);
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () =>
        settings({
          // Force a DND window that covers the reminder time.
          dndStart: '23:00',
          dndEnd: '07:00'
        }),
      getReminders: store.getReminders,
      onReminderState: store.onReminderState,
      notify: () => undefined
    });

    const result = await scheduler.tick();
    expect(result.delivered).toHaveLength(0);
    expect(result.suppressed.some((entry) => entry.kind === 'reminder')).toBe(true);
    expect(result.suppressed.every((entry) => entry.reason === 'dnd')).toBe(true);
    // A legacy record has no state key at all; absence means pending, and DND
    // must not write a spurious transition.
    expect(reminderState(store.records.get('water')!)).toBe('pending');
    expect(store.writes).toHaveLength(0);
  });

  test('a postponed reminder persists, waits for the new time and fires once', async () => {
    // Simulates a restart: the same persisted reminder object is re-read on
    // every scheduler construction, so the postponement must come from disk.
    const store = lifecycle([
      {
        id: 'water',
        time: '12:00',
        label: '喝水',
        enabled: true,
        state: 'postponed',
        postponedTo: '2026-10-31T12:10'
      }
    ]);
    const deliveredKeys = new Map<string, string[]>();
    const deliveryLog = {
      load: async (date: string) => deliveredKeys.get(date) ?? [],
      save: async (date: string, keys: readonly string[]) => {
        deliveredKeys.set(date, [...keys]);
      }
    };
    let now = at(12, 5);
    const make = () =>
      new Scheduler({
        now: () => now,
        getSettings: async () => settings(),
        getReminders: store.getReminders,
        onReminderState: store.onReminderState,
        notify: () => undefined,
        deliveryLog
      });

    // Before the postponed time, nothing fires and the state is untouched.
    expect((await make().tick()).delivered).toHaveLength(0);
    expect(store.records.get('water')?.state).toBe('postponed');

    // A fresh scheduler (restart) at the postponed minute delivers exactly once.
    now = at(12, 10);
    const fired = await make().tick();
    expect(fired.delivered.map((entry) => entry.reminderId)).toEqual(['water']);
    expect(store.records.get('water')?.state).toBe('fired');
    expect(store.records.get('water')?.postponedTo).toBeUndefined();

    // Another restart within the same minute must not deliver again.
    now = at(12, 11);
    expect((await make().tick()).delivered).toHaveLength(0);
  });

  test('the postponement survives the reminders.md round-trip', async () => {
    // This one really writes the file format: every scheduler read parses the
    // serialized `reminders.md`, and every state write re-serializes it, the
    // same way the vault service does. Serialized timestamps must stay quoted
    // strings, or YAML would hand back a Date and the postponement would vanish.
    let raw = serializeRemindersFile([
      {
        id: 'water',
        time: '12:00',
        label: '喝水',
        enabled: true,
        state: 'postponed',
        postponedTo: '2026-10-31T12:10'
      }
    ]);
    const deliveredKeys = new Map<string, string[]>();
    const deliveryLog = {
      load: async (date: string) => deliveredKeys.get(date) ?? [],
      save: async (date: string, keys: readonly string[]) => {
        deliveredKeys.set(date, [...keys]);
      }
    };
    const store = {
      getReminders: async () => parseRemindersFile(raw),
      onReminderState: (id: string, patch: ReminderStatePatch) => {
        const reminders = parseRemindersFile(raw);
        const index = reminders.findIndex((reminder) => reminder.id === id);
        if (index < 0) return;
        reminders[index] = applyReminderStatePatch(reminders[index]!, patch);
        raw = serializeRemindersFile(reminders);
      }
    };
    let now = at(12, 5);
    const make = () =>
      new Scheduler({
        now: () => now,
        getSettings: async () => settings(),
        getReminders: store.getReminders,
        onReminderState: store.onReminderState,
        notify: () => undefined,
        deliveryLog
      });

    expect(parseRemindersFile(raw)[0]).toMatchObject({
      state: 'postponed',
      postponedTo: '2026-10-31T12:10'
    });
    // Nothing before 12:10; the persisted target is honoured after a restart.
    expect((await make().tick()).delivered).toHaveLength(0);

    now = at(12, 10);
    expect((await make().tick()).delivered.map((entry) => entry.reminderId)).toEqual([
      'water'
    ]);
    const persisted = parseRemindersFile(raw)[0]!;
    expect(persisted.state).toBe('fired');
    expect(persisted.firedAt).toBe(at(12, 10).toISOString());
    expect(persisted).not.toHaveProperty('postponedTo');
    expect(persisted).not.toHaveProperty('lastError');

    // The daily trigger was consumed too, so a later restart is silent.
    now = at(13, 0);
    expect((await make().tick()).delivered).toHaveLength(0);
  });

  test('a postponed reminder does not also fire at its normal time', async () => {
    const store = lifecycle([
      {
        id: 'water',
        time: '12:00',
        label: '喝水',
        enabled: true,
        state: 'postponed',
        postponedTo: '2026-10-31T12:10'
      }
    ]);
    const deliveredKeys = new Map<string, string[]>();
    const deliveryLog = {
      load: async (date: string) => deliveredKeys.get(date) ?? [],
      save: async (date: string, keys: readonly string[]) => {
        deliveredKeys.set(date, [...keys]);
      }
    };
    let now = at(12, 10);
    const options = {
      now: () => now,
      getSettings: async () => settings(),
      getReminders: store.getReminders,
      onReminderState: store.onReminderState,
      notify: () => undefined,
      deliveryLog
    };

    expect((await new Scheduler(options).tick()).delivered).toHaveLength(1);
    // The normal daily key was consumed, so a later tick at 13:00 is silent.
    now = at(13, 0);
    expect((await new Scheduler(options).tick()).delivered).toHaveLength(0);
  });

  test('a done reminder is quiet on its completion day and resumes the next day', async () => {
    // 「完成」是当天的事，不是关掉：doneAt 记着完成的那一天，当天保持安静，
    // 第二天 effectiveReminderState 读回 pending，无需手动「重新启用」。
    const store = lifecycle([
      {
        id: 'water',
        time: '12:00',
        label: '喝水',
        enabled: true,
        state: 'done',
        doneAt: '2026-10-31'
      }
    ]);
    const notified: string[] = [];
    const deliveredKeys = new Map<string, string[]>();
    const deliveryLog = {
      load: async (date: string) => deliveredKeys.get(date) ?? [],
      save: async (date: string, keys: readonly string[]) => {
        deliveredKeys.set(date, [...keys]);
      }
    };
    let now = at(12, 30);
    const make = () =>
      new Scheduler({
        now: () => now,
        getSettings: async () => settings(),
        getReminders: store.getReminders,
        onReminderState: store.onReminderState,
        notify: (notification) => {
          notified.push(notification.key);
        },
        deliveryLog
      });

    // The completion day itself: no trigger is even built, so nothing is
    // delivered and no lifecycle write happens.
    expect((await make().tick()).delivered).toHaveLength(0);
    expect(notified).toHaveLength(0);
    expect(store.writes).toHaveLength(0);

    // The next day the same reminder fires again, and a successful delivery
    // records `fired` while clearing `doneAt` (the completion day is over).
    now = nextDayAt(12, 0);
    expect((await make().tick()).delivered.map((entry) => entry.reminderId)).toEqual([
      'water'
    ]);
    const record = store.records.get('water')!;
    expect(record.state).toBe('fired');
    expect(record).not.toHaveProperty('doneAt');
    expect(store.writes.at(-1)?.patch).toMatchObject({ state: 'fired', doneAt: null });
  });

  test('a done daily reminder resumes on the next day its weekday matches', async () => {
    // 2026-10-31 is a Saturday. days:[6] means Saturday-only, so finishing it
    // on Saturday keeps Saturday quiet, the Sunday in between stays a non-day,
    // and the next Saturday fires without any manual re-enable.
    const store = lifecycle([
      {
        id: 'gym',
        time: '12:00',
        label: '跑步',
        enabled: true,
        days: [6],
        state: 'done',
        doneAt: '2026-10-31'
      }
    ]);
    const deliveredKeys = new Map<string, string[]>();
    const deliveryLog = {
      load: async (date: string) => deliveredKeys.get(date) ?? [],
      save: async (date: string, keys: readonly string[]) => {
        deliveredKeys.set(date, [...keys]);
      }
    };
    let now = at(12, 0);
    const make = () =>
      new Scheduler({
        now: () => now,
        getSettings: async () => settings(),
        getReminders: store.getReminders,
        onReminderState: store.onReminderState,
        notify: () => undefined,
        deliveryLog
      });

    // Completion day (Saturday): quiet even at and after its time.
    expect((await make().tick()).delivered).toHaveLength(0);

    // Sunday: the reset already applies, but Saturday-only never fires today.
    now = nextDayAt(12, 0);
    expect((await make().tick()).delivered).toHaveLength(0);

    // Next Saturday: the reminder is back, exactly one week later.
    now = new Date(2026, 10, 7, 12, 0, 0);
    expect((await make().tick()).delivered.map((entry) => entry.reminderId)).toEqual(['gym']);
  });

  test('a legacy done reminder without doneAt stays quiet forever', async () => {
    // Acceptance 19: old files recorded only `state: done` with no completion
    // day. They must never come back as pending — silence is the contract.
    const store = lifecycle([
      { id: 'legacy', time: '12:00', label: '旧提醒', enabled: true, state: 'done' }
    ]);
    let now = at(12, 30);
    const make = () =>
      new Scheduler({
        now: () => now,
        getSettings: async () => settings(),
        getReminders: store.getReminders,
        onReminderState: store.onReminderState,
        notify: () => undefined,
        deliveryLog: {
          load: async () => [],
          save: async () => undefined
        }
      });

    expect((await make().tick()).delivered).toHaveLength(0);
    now = nextDayAt(12, 30);
    expect((await make().tick()).delivered).toHaveLength(0);
    now = new Date(2026, 10, 7, 12, 30, 0);
    expect((await make().tick()).delivered).toHaveLength(0);
    expect(store.writes).toHaveLength(0);
  });

  test('doneAt parses strictly and an old file without it round-trips byte-identically', () => {
    // Covered in tests/main/reminders-records.test.ts; kept as a scheduler-level
    // guard that a hand-edited bad `doneAt` never brings a reminder back.
    const raw = [
      '---',
      'type: plan',
      'source: user',
      'items:',
      '  - id: water',
      '    time: "12:00"',
      '    label: 喝水',
      '    enabled: true',
      '    state: done',
      "    doneAt: '2026-13-40'",
      '---',
      '# 提醒',
      ''
    ].join('\n');
    expect(parseRemindersFile(raw)[0]).toEqual({
      id: 'water',
      time: '12:00',
      label: '喝水',
      enabled: true,
      state: 'done'
    });
  });
});
