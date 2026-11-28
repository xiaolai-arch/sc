import type { KnowledgeTopic } from '../../src/shared/knowledge';
import type { PracticeAttempt, PracticeMistake } from '../../src/shared/practice';
import type { WorkspaceTask } from '../../src/shared/workspace';
import { recent7DayCompletion, weeklyOverview } from '../../src/shared/weekly-stats';

// Wednesday 4 November 2026; the Monday-based week runs 11-02 to 11-08.
const today = new Date(2026, 10, 4, 10, 0, 0);

function task(overrides: Partial<WorkspaceTask> = {}): WorkspaceTask {
  return {
    id: 't1',
    workspaceId: 'kaoyan',
    title: '极限',
    subject: '数学',
    durationMin: 45,
    acceptance: '',
    status: 'pending',
    ...overrides
  };
}

function attempt(
  date: string,
  correct: boolean,
  id = date + correct,
  overrides: Partial<PracticeAttempt> = {}
): PracticeAttempt {
  return {
    id,
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: 'q1',
    choice: correct ? 1 : 0,
    correct,
    answeredAt: `${date}T09:00:00.000Z`,
    ...overrides
  };
}

function mistake(id: string, status: PracticeMistake['status'] = 'active'): PracticeMistake {
  return {
    id,
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: 'q1',
    prompt: 'p',
    options: ['a', 'b'],
    answer: 1,
    explanation: '',
    wrongCount: 1,
    correctStreak: 0,
    priority: 1,
    intervalDays: 1,
    due: '2026-11-04',
    status,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    lastAnsweredAt: '2026-11-01T00:00:00.000Z'
  };
}

function topic(overrides: Partial<KnowledgeTopic>): KnowledgeTopic {
  return {
    id: overrides.id ?? 'kt1',
    name: overrides.name ?? '极限',
    aliases: [],
    status: overrides.status ?? 'learning',
    summary: '',
    evidence: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides
  };
}

function overview(
  input: Partial<Parameters<typeof weeklyOverview>[0]> = {}
) {
  return weeklyOverview({
    tasks: [],
    attempts: [],
    reviews: [],
    dueMistakes: [],
    topics: [],
    today,
    ...input
  });
}

test('reports the Monday-based week that contains today', () => {
  expect(overview()).toMatchObject({ weekStart: '2026-11-02', weekEnd: '2026-11-08' });
});

test('counts only tasks due this week, and reports undated backlog separately', () => {
  const result = overview({
    tasks: [
      task({ id: 'done-this-week', status: 'done', due: '2026-11-03', actualMin: 50 }),
      task({ id: 'done-undated', status: 'done', actualMin: 25 }),
      task({ id: 'open-this-week', due: '2026-11-08', actualMin: 40 }),
      task({ id: 'next-week', status: 'done', due: '2026-11-09', actualMin: 90 }),
      task({ id: 'last-week', due: '2026-11-01', actualMin: 30 })
    ]
  });

  // Only dated-in-week tasks build the completion plan; the undated done task
  // still adds its focus minutes (the 1.3.0 专注 scope is unchanged) but can
  // never enter this week's denominator, and being done it is not backlog.
  expect(result).toMatchObject({
    tasksDone: 1,
    tasksTotal: 2,
    backlogCount: 0,
    focusMinutes: 75
  });
});

test('undated backlog never enters the denominator, and matches recent7DayCompletion', () => {
  // 3 tasks due this week (2 done) + 5 open undated ones (验收 12) plus two
  // more dated-in-window tasks so the 7-day sample reaches its threshold.
  const tasks = [
    task({ id: 'due-done-a', status: 'done', due: dated(-2) }),
    task({ id: 'due-done-b', status: 'done', due: dated(-1) }),
    task({ id: 'due-done-c', status: 'done', due: dated(0) }),
    task({ id: 'due-open-a', due: dated(0) }),
    task({ id: 'due-open-b', due: dated(0) }),
    ...[1, 2, 3, 4, 5].map((n) => task({ id: `backlog-${n}` }))
  ];
  const result = overview({ tasks });
  expect(result).toMatchObject({ tasksDone: 3, tasksTotal: 5, backlogCount: 5 });

  // The same rule recent7DayCompletion applies: a standing backlog cannot drag
  // the rate down, so the denominators agree on this fixture.
  const sevenDay = recent7DayCompletion(tasks, today);
  expect(sevenDay).not.toBeNull();
  expect(result.tasksTotal).toBe(sevenDay!.planned);
  expect(result.tasksDone).toBe(sevenDay!.done);
});

test('backlog counts only open undated tasks, never done or skipped (验收 13)', () => {
  const result = overview({
    tasks: [
      task({ id: 'open', due: '2026-11-04' }),
      task({ id: 'undated-pending' }),
      task({ id: 'undated-progress', status: 'in-progress' }),
      task({ id: 'undated-done', status: 'done' }),
      task({ id: 'undated-skipped', status: 'skipped' })
    ]
  });
  expect(result.backlogCount).toBe(2);

  const none = overview({ tasks: [task({ id: 'only-dated', due: '2026-11-04' })] });
  expect(none.backlogCount).toBe(0);
});

test('measures answer accuracy from attempts answered this week', () => {
  expect(overview({ attempts: [] }).accuracy).toBeNull();

  const result = overview({
    attempts: [
      attempt('2026-11-02', true, 'a'),
      attempt('2026-11-03', false, 'b'),
      attempt('2026-11-04', true, 'c'),
      attempt('2026-11-05', false, 'd'),
      attempt('2026-11-01', false, 'e'),
      attempt('2026-11-09', false, 'f')
    ]
  });

  expect(result).toMatchObject({ answered: 3, correct: 2 });
  expect(result.accuracy).toBeCloseTo(2 / 3);
});

test('deduplicates by question and local day, keeping the first answer (验收 14)', () => {
  // Same question, same day: wrong, wrong, right → one question, counted wrong.
  const sameDay = overview({
    attempts: [
      attempt('2026-11-02', false, 'a1', { answeredAt: '2026-11-02T08:00:00.000Z' }),
      attempt('2026-11-02', false, 'a2', { answeredAt: '2026-11-02T09:00:00.000Z' }),
      attempt('2026-11-02', true, 'a3', { answeredAt: '2026-11-02T10:00:00.000Z' })
    ]
  });
  expect(sameDay).toMatchObject({ answered: 1, correct: 0 });
  expect(sameDay.accuracy).toBe(0);

  // Different days each count once, even with repeats on each day.
  const acrossDays = overview({
    attempts: [
      attempt('2026-11-02', true, 'b1', { answeredAt: '2026-11-02T08:00:00.000Z' }),
      attempt('2026-11-02', false, 'b2', { answeredAt: '2026-11-02T09:00:00.000Z' }),
      attempt('2026-11-03', false, 'b3', { answeredAt: '2026-11-03T08:00:00.000Z' }),
      attempt('2026-11-03', true, 'b4', { answeredAt: '2026-11-03T09:00:00.000Z' })
    ]
  });
  expect(acrossDays).toMatchObject({ answered: 2, correct: 1 });
});

test('the first-answer rule does not depend on input order', () => {
  const ordered = [
    attempt('2026-11-02', false, 'first', { answeredAt: '2026-11-02T08:00:00.000Z' }),
    attempt('2026-11-02', true, 'second', { answeredAt: '2026-11-02T09:00:00.000Z' })
  ];
  const shuffled = [ordered[1]!, ordered[0]!];

  const a = overview({ attempts: ordered });
  const b = overview({ attempts: shuffled });
  expect(a).toMatchObject({ answered: 1, correct: 0 });
  expect(b).toMatchObject({ answered: 1, correct: 0 });
});

test('accuracyReliable flips at five answers and never changes accuracy itself', () => {
  const four = overview({
    attempts: [1, 2, 3, 4].map((n) =>
      attempt('2026-11-02', true, `q${n}`, { questionId: `q${n}` })
    )
  });
  expect(four).toMatchObject({ answered: 4, accuracyReliable: false });
  expect(four.accuracy).toBe(1);

  const five = overview({
    attempts: [1, 2, 3, 4, 5].map((n) =>
      attempt('2026-11-02', true, `q${n}`, { questionId: `q${n}` })
    )
  });
  expect(five).toMatchObject({ answered: 5, accuracyReliable: true });

  const none = overview({ attempts: [] });
  expect(none).toMatchObject({ answered: 0, accuracyReliable: false });
  expect(none.accuracy).toBeNull();
});

test('counts review days, due mistakes and knowledge topics', () => {  const result = overview({
    reviews: [
      { date: '2026-11-02' },
      { date: '2026-11-02' },
      { date: '2026-11-04' },
      { date: '2026-11-01' }
    ],
    dueMistakes: [mistake('pm1'), mistake('pm2')],
    topics: [
      topic({ id: 'kt1', name: '极限', status: 'learning', level: 2 }),
      topic({ id: 'kt2', name: '线代', status: 'learning', level: 1 }),
      topic({ id: 'kt3', name: '概率', status: 'mastered' }),
      topic({ id: 'kt4', name: '英语', status: 'planned' })
    ]
  });

  expect(result).toMatchObject({
    reviewedDays: 2,
    dueMistakes: 2,
    learningTopics: 2,
    masteredTopics: 1,
    weakestTopic: '线代'
  });
});

test('treats an unrated learning topic as the weakest one', () => {
  const result = overview({
    topics: [
      topic({ id: 'kt1', name: '极限', status: 'learning', level: 4 }),
      topic({ id: 'kt2', name: '线代', status: 'learning' })
    ]
  });

  expect(result.weakestTopic).toBe('线代');
});

test('has no weakest topic when nothing is being learned', () => {
  const result = overview({ topics: [topic({ id: 'kt1', status: 'mastered' })] });
  expect(result.weakestTopic).toBeNull();
});

// --- recent7DayCompletion ---
// Fixed today = 2026-11-04, so the window is [2026-10-29, 2026-11-04].
function dated(offsetDays: number): string {
  const date = new Date(2026, 10, 4 + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

test('counts planned and done by due date across exactly the seven-day window', () => {
  const result = recent7DayCompletion(
    [
      task({ id: 'd-6', status: 'done', due: dated(-6) }),
      task({ id: 'd-3', status: 'done', due: dated(-3) }),
      task({ id: 'd-1', due: dated(-1) }),
      task({ id: 'd0', due: dated(0) }),
      task({ id: 'd-7', status: 'done', due: dated(-7) }),
      task({ id: 'future', status: 'done', due: dated(1) })
    ],
    today
  );

  // The day seven days back and anything in the future stay outside the
  // window, so the sample is 4 planned / 2 done — below the threshold.
  expect(result).toBeNull();
});

test('a due date on the oldest in-window day counts, the day before it does not', () => {
  const inWindow = recent7DayCompletion(
    [
      task({ id: 'first', status: 'done', due: dated(-6) }),
      task({ id: 'b', status: 'done', due: dated(-5) }),
      task({ id: 'c', status: 'done', due: dated(-4) }),
      task({ id: 'd', status: 'done', due: dated(-1) }),
      task({ id: 'last', status: 'done', due: dated(0) })
    ],
    today
  );
  expect(inWindow).toEqual({ planned: 5, done: 5, percent: 100 });

  // Moving the oldest task one day earlier drops it from the window.
  const shifted = recent7DayCompletion(
    [
      task({ id: 'first', status: 'done', due: dated(-7) }),
      task({ id: 'b', status: 'done', due: dated(-5) }),
      task({ id: 'c', status: 'done', due: dated(-4) }),
      task({ id: 'd', status: 'done', due: dated(-1) }),
      task({ id: 'last', status: 'done', due: dated(0) })
    ],
    today
  );
  expect(shifted).toBeNull();
});

test('undated backlog never counts as planned, and skipped counts as neither', () => {
  const result = recent7DayCompletion(
    [
      task({ id: 'done-a', status: 'done', due: dated(-2) }),
      task({ id: 'done-b', status: 'done', due: dated(-2) }),
      task({ id: 'done-c', status: 'done', due: dated(-1) }),
      task({ id: 'done-d', status: 'done', due: dated(-1) }),
      task({ id: 'open', due: dated(-1) }),
      task({ id: 'skipped-a', status: 'skipped', due: dated(-1) }),
      task({ id: 'skipped-b', status: 'skipped', due: dated(0) }),
      task({ id: 'undated', status: 'done' })
    ],
    today
  );

  // planned = 5 (four done + one open), skipped and undated invisible.
  expect(result).toEqual({ planned: 5, done: 4, percent: 80 });
});

test('in-progress counts as planned but not done, and percent rounds to a whole number', () => {
  const result = recent7DayCompletion(
    [
      task({ id: 'a', status: 'done', due: dated(-3) }),
      task({ id: 'b', status: 'in-progress', due: dated(-3) }),
      task({ id: 'c', status: 'done', due: dated(-2) }),
      task({ id: 'd', status: 'pending', due: dated(-1) }),
      task({ id: 'e', status: 'done', due: dated(0) }),
      task({ id: 'f', status: 'done', due: dated(0) })
    ],
    today
  );

  // 4 done of 6 planned = 66.67% → 67; the in-progress task is not done.
  expect(result).toEqual({ planned: 6, done: 4, percent: 67 });
});

test('returns null below the five-item sample threshold', () => {
  const four = recent7DayCompletion(
    [
      task({ id: 'a', status: 'done', due: dated(-2) }),
      task({ id: 'b', status: 'done', due: dated(-2) }),
      task({ id: 'c', status: 'done', due: dated(-1) }),
      task({ id: 'd', status: 'pending', due: dated(0) })
    ],
    today
  );
  expect(four).toBeNull();

  const five = recent7DayCompletion(
    [
      task({ id: 'a', status: 'done', due: dated(-2) }),
      task({ id: 'b', status: 'done', due: dated(-2) }),
      task({ id: 'c', status: 'done', due: dated(-1) }),
      task({ id: 'd', status: 'pending', due: dated(0) }),
      task({ id: 'e', status: 'pending', due: dated(0) })
    ],
    today
  );
  expect(five).toEqual({ planned: 5, done: 3, percent: 60 });
});
