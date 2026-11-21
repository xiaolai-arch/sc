import {
  MAX_DIFFICULTY,
  MAX_INTERVAL_DAYS,
  MIN_DIFFICULTY,
  migrateSchedule,
  nextSchedule,
  scheduleLabel
} from '../../src/main/practice/schedule';

function intervalSequence(start: { intervalDays: number; due: string; priority: number }, from: string, count: number) {
  const intervals: number[] = [];
  const dues: string[] = [];
  let current: {
    intervalDays: number;
    due: string;
    priority: number;
    stabilityDays?: number;
    difficulty?: number;
  } = { ...start };
  let today = from;
  for (let i = 0; i < count; i += 1) {
    const next = nextSchedule(current, { correct: true, today });
    intervals.push(next.intervalDays);
    dues.push(next.due);
    current = {
      intervalDays: next.intervalDays,
      due: next.due,
      priority: current.priority,
      stabilityDays: next.stabilityDays,
      difficulty: next.difficulty
    };
    today = next.due;
  }
  return { intervals, dues };
}

describe('migrateSchedule', () => {
  it('derives stability from the old interval and difficulty from priority', () => {
    // intervalDays is the old record's memory age; priority 0–3 maps to 0.3–0.75.
    expect(migrateSchedule({ intervalDays: 7, priority: 0 })).toEqual({
      stabilityDays: 7,
      difficulty: 0.3
    });
    expect(migrateSchedule({ intervalDays: 3, priority: 2 })).toEqual({
      stabilityDays: 3,
      difficulty: 0.6
    });
    expect(migrateSchedule({ intervalDays: 1, priority: 3 })).toEqual({
      stabilityDays: 1,
      difficulty: 0.75
    });
  });

  it('clamps missing or out-of-range legacy values deterministically', () => {
    expect(migrateSchedule({})).toEqual({ stabilityDays: 1, difficulty: 0.3 });
    expect(migrateSchedule({ intervalDays: 0, priority: 9 })).toEqual({
      stabilityDays: 1,
      difficulty: 0.75
    });
    expect(migrateSchedule({ intervalDays: -5, priority: -2 })).toEqual({
      stabilityDays: 1,
      difficulty: 0.3
    });
  });

  it('keeps values already present on the record', () => {
    expect(migrateSchedule({ intervalDays: 2, priority: 3, stabilityDays: 9, difficulty: 0.5 })).toEqual({
      stabilityDays: 9,
      difficulty: 0.5
    });
  });
});

describe('nextSchedule', () => {
  it('resets a failure to one day and raises difficulty', () => {
    const next = nextSchedule(
      { intervalDays: 7, due: '2026-11-20', stabilityDays: 7, difficulty: 0.4 },
      { correct: false, today: '2026-11-20' }
    );
    expect(next).toEqual({
      stabilityDays: 1,
      difficulty: 0.5,
      intervalDays: 1,
      due: '2026-11-21',
      status: 'active'
    });
  });

  it('clamps a failure’s difficulty at the ceiling', () => {
    const next = nextSchedule(
      { intervalDays: 1, due: '2026-11-01', difficulty: 0.85 },
      { correct: false, today: '2026-11-01' }
    );
    expect(next.difficulty).toBe(MAX_DIFFICULTY);
  });

  it('grows the interval monotonically on success and moves due forward', () => {
    const { intervals, dues } = intervalSequence(
      { intervalDays: 1, due: '2026-11-01', priority: 1 },
      '2026-11-01',
      5
    );
    expect(intervals[0]).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < intervals.length; i += 1) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1]!);
    }
    // The review date must move forward every time — the bug this replaces kept
    // `due` frozen on a correct answer.
    for (let i = 0; i < dues.length; i += 1) {
      expect(dues[i]! > '2026-11-01').toBe(true);
      if (i > 0) expect(dues[i]! > dues[i - 1]!).toBe(true);
    }
  });

  it('schedules three consecutive successes more than a week out', () => {
    const { intervals } = intervalSequence(
      { intervalDays: 1, due: '2026-11-01', priority: 0 },
      '2026-11-01',
      3
    );
    expect(intervals.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(7);
  });

  it('lowers difficulty on success and floors it', () => {
    const low = nextSchedule(
      { intervalDays: 3, due: '2026-11-03', stabilityDays: 3, difficulty: 0.12 },
      { correct: true, today: '2026-11-03' }
    );
    expect(low.difficulty).toBe(MIN_DIFFICULTY);
  });

  it('caps runaway intervals at a year', () => {
    const next = nextSchedule(
      { intervalDays: 365, due: '2027-11-01', stabilityDays: 1000, difficulty: 0.1 },
      { correct: true, today: '2027-11-01' }
    );
    expect(next.intervalDays).toBe(MAX_INTERVAL_DAYS);
  });

  it('never resolves two correct answers in one sitting', () => {
    const first = nextSchedule(
      { intervalDays: 7, due: '2026-11-08', stabilityDays: 7, difficulty: 0.3 },
      { correct: true, today: '2026-11-08' }
    );
    expect(first.status).toBe('resolved');

    const again = nextSchedule(
      {
        intervalDays: first.intervalDays,
        due: first.due,
        stabilityDays: first.stabilityDays,
        difficulty: first.difficulty
      },
      { correct: true, today: '2026-11-08' }
    );
    expect(again.status).toBe('active');
    expect(again.due > first.due).toBe(true);
  });

  it('requires an elapsed interval of at least three days to resolve', () => {
    const fresh = nextSchedule(
      { intervalDays: 1, due: '2026-11-02', stabilityDays: 1, difficulty: 0.3 },
      { correct: true, today: '2026-11-02' }
    );
    expect(fresh.status).toBe('active');

    const spaced = nextSchedule(
      { intervalDays: 3, due: '2026-11-05', stabilityDays: 3, difficulty: 0.3 },
      { correct: true, today: '2026-11-05' }
    );
    expect(spaced.status).toBe('resolved');
  });

  it('does not resolve an overdue record answered on its own due day', () => {
    // `due - intervalDays` is the previous answer's day: answering on `due` is
    // a later day, so a spaced interval resolves.
    const next = nextSchedule(
      { intervalDays: 5, due: '2026-11-10', stabilityDays: 5, difficulty: 0.4 },
      { correct: true, today: '2026-11-10' }
    );
    expect(next.status).toBe('resolved');
  });
});

describe('scheduleLabel', () => {
  it('renders a compact Chinese review line', () => {
    expect(
      scheduleLabel({ status: 'active', due: '2026-11-24', intervalDays: 3 })
    ).toBe('下次复习 11月24日 · 间隔 3 天');
  });

  it('renders mastery for a resolved record', () => {
    expect(scheduleLabel({ status: 'resolved', due: '2026-11-24', intervalDays: 3 })).toBe(
      '已掌握'
    );
  });
});
