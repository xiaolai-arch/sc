import { collectNotifications, snoozeLabel } from '../../src/shared/notifications';
import type { CommitmentSummary } from '../../src/shared/notifications';
import type { Reminder } from '../../src/shared/workspace';

const NOW = new Date(2026, 10, 22, 15, 30, 0); // 2026-11-22 15:30 local

function reminder(overrides: Partial<Reminder> = {}): Reminder {
  return { id: 'r1', time: '09:00', label: '背单词', enabled: true, ...overrides };
}

function commitment(overrides: Partial<CommitmentSummary> = {}): CommitmentSummary {
  return {
    id: 'cm1',
    text: '整理错题',
    due: '2026-11-22',
    status: 'open',
    createdAt: '2026-11-21T08:00:00.000Z',
    ...overrides
  };
}

test('an empty input gives an empty digest and no mute', () => {
  const digest = collectNotifications({
    reminders: [],
    commitments: [],
    snoozedUntil: '',
    now: NOW
  });
  expect(digest.items).toEqual([]);
  expect(digest.mutedUntil).toBeNull();
});

test('lists a reminder whose time has passed, but not one still ahead', () => {
  const past = collectNotifications({
    reminders: [reminder({ id: 'past', time: '09:00' })],
    commitments: [],
    now: NOW
  });
  expect(past.items.map((item) => item.id)).toEqual(['past']);

  const future = collectNotifications({
    reminders: [reminder({ id: 'future', time: '20:00' })],
    commitments: [],
    now: NOW
  });
  expect(future.items).toEqual([]);
});

test('skips disabled, done, and off-weekday reminders', () => {
  const digest = collectNotifications({
    reminders: [
      reminder({ id: 'off', enabled: false }),
      reminder({ id: 'done', state: 'done' }),
      // 2026-11-22 is a Sunday; a Monday-only reminder is not due.
      reminder({ id: 'monday', days: [1] })
    ],
    commitments: [],
    now: NOW
  });
  expect(digest.items).toEqual([]);
});

test('a missed earlier delivery stays overdue until it is finished', () => {
  const digest = collectNotifications({
    reminders: [
      reminder({
        id: 'missed',
        time: '20:00',
        state: 'fired',
        firedAt: '2026-11-20T12:00:00.000Z'
      })
    ],
    commitments: [],
    now: NOW
  });
  expect(digest.items).toHaveLength(1);
  expect(digest.items[0]).toMatchObject({ id: 'missed', overdue: true });
});

test('a postponement into the future waits; a past one is overdue', () => {
  const future = collectNotifications({
    reminders: [
      reminder({ id: 'later', state: 'postponed', postponedTo: '2026-11-22T18:00' })
    ],
    commitments: [],
    now: NOW
  });
  expect(future.items).toEqual([]);

  const past = collectNotifications({
    reminders: [
      reminder({ id: 'late', state: 'postponed', postponedTo: '2026-11-22T14:00' })
    ],
    commitments: [],
    now: NOW
  });
  expect(past.items).toHaveLength(1);
  expect(past.items[0]).toMatchObject({ id: 'late', overdue: false });
});

test('lists open promises due today or earlier, never future ones', () => {
  const digest = collectNotifications({
    reminders: [],
    commitments: [
      commitment({ id: 'today', due: '2026-11-22' }),
      commitment({ id: 'overdue', due: '2026-11-20' }),
      commitment({ id: 'future', due: '2026-11-23' }),
      commitment({ id: 'done', due: '2026-11-20', status: 'done' })
    ],
    now: NOW
  });
  expect(digest.items.map((item) => item.id)).toEqual(['overdue', 'today']);
  expect(digest.items[0]).toMatchObject({ kind: 'commitment', overdue: true });
  expect(digest.items[1]).toMatchObject({ kind: 'commitment', overdue: false });
});

test('overdue rows come first, then oldest first', () => {
  const digest = collectNotifications({
    reminders: [reminder({ id: 'r-today', time: '10:00' })],
    commitments: [commitment({ id: 'cm-old', due: '2026-11-19' })],
    now: NOW
  });
  expect(digest.items.map((item) => item.id)).toEqual(['cm-old', 'r-today']);
});

test('reports the mute only while the stored day is today or later', () => {
  expect(
    collectNotifications({
      reminders: [],
      commitments: [],
      snoozedUntil: '2026-11-25',
      now: NOW
    }).mutedUntil
  ).toBe('2026-11-25');

  expect(
    collectNotifications({
      reminders: [],
      commitments: [],
      snoozedUntil: '2026-11-21',
      now: NOW
    }).mutedUntil
  ).toBeNull();
});

test('snoozeLabel spells out the last muted day', () => {
  expect(snoozeLabel('2026-11-25', '2026-11-22')).toBe('已静音至 11月25日');
  expect(snoozeLabel('2026-11-22', '2026-11-22')).toBe('今天已静音，明天恢复');
  expect(snoozeLabel('2026-11-20', '2026-11-22')).toBeNull();
  expect(snoozeLabel('', '2026-11-22')).toBeNull();
});
