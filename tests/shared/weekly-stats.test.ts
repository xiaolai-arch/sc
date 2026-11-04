import type { KnowledgeTopic } from '../../src/shared/knowledge';
import type { PracticeAttempt, PracticeMistake } from '../../src/shared/practice';
import type { WorkspaceTask } from '../../src/shared/workspace';
import { weeklyOverview } from '../../src/shared/weekly-stats';

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

function attempt(date: string, correct: boolean, id = date + correct): PracticeAttempt {
  return {
    id,
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: 'q1',
    choice: correct ? 1 : 0,
    correct,
    answeredAt: `${date}T09:00:00.000Z`
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

test('counts tasks due this week plus undated work, and sums completed focus minutes', () => {
  const result = overview({
    tasks: [
      task({ id: 'done-this-week', status: 'done', due: '2026-11-03', actualMin: 50 }),
      task({ id: 'done-undated', status: 'done', actualMin: 25 }),
      task({ id: 'open-this-week', due: '2026-11-08', actualMin: 40 }),
      task({ id: 'next-week', status: 'done', due: '2026-11-09', actualMin: 90 }),
      task({ id: 'last-week', due: '2026-11-01', actualMin: 30 })
    ]
  });

  expect(result).toMatchObject({
    tasksDone: 2,
    tasksTotal: 3,
    focusMinutes: 75
  });
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

test('counts review days, due mistakes and knowledge topics', () => {
  const result = overview({
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
