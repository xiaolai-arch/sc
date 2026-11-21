import { quizOffer } from '../../src/main/practice/quiz-offer';
import type { PracticeMistake } from '../../src/shared/practice';

function mistake(id: string, due: string): PracticeMistake {
  return {
    id,
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: `q-${id}`,
    prompt: `错题 ${id}`,
    options: ['A', 'B'],
    answer: 0,
    explanation: '',
    wrongCount: 1,
    correctStreak: 0,
    priority: 1,
    intervalDays: 1,
    due,
    status: 'active',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    lastAnsweredAt: '2026-11-01T00:00:00.000Z'
  };
}

function input(overrides: Partial<Parameters<typeof quizOffer>[0]> = {}) {
  return {
    today: '2026-11-21',
    mistakes: [] as PracticeMistake[],
    recentAccuracy: null as number | null,
    recentAnswered: 0,
    ...overrides
  };
}

test('three due mistakes offer the five-minute quiz and name the real count', () => {
  const offer = quizOffer(input({ mistakes: [mistake('a', '2026-11-21'), mistake('b', '2026-11-21'), mistake('c', '2026-11-21')] }));

  expect(offer).toEqual({
    reason: 'due-mistakes',
    text: '你有 3 道到期错题，抽 5 分钟做 3 道？'
  });
});

test('overdue mistakes count too, and the text follows the actual total', () => {
  const offer = quizOffer(
    input({
      mistakes: [
        mistake('a', '2026-11-01'),
        mistake('b', '2026-11-10'),
        mistake('c', '2026-11-20'),
        mistake('d', '2026-12-01'),
        mistake('e', '2026-11-15'),
        mistake('f', '2026-11-02'),
        mistake('g', '2026-11-09')
      ]
    })
  );

  // Six of the seven mistakes are due or overdue; the future one stays out.
  expect(offer?.text).toBe('你有 6 道到期错题，抽 5 分钟做 3 道？');
});

test('two due mistakes are not enough for the due-mistakes offer', () => {
  expect(
    quizOffer(input({ mistakes: [mistake('a', '2026-11-21'), mistake('b', '2026-11-20')] }))
  ).toBeNull();
});

test('low accuracy offers only with at least ten recent answers', () => {
  const offer = quizOffer(input({ recentAnswered: 10, recentAccuracy: 58 }));
  expect(offer).toEqual({
    reason: 'low-accuracy',
    text: '最近 8 周正确率 58%，做 3 道找找手感？'
  });
});

test('nine recent answers stay silent even at a low accuracy', () => {
  expect(quizOffer(input({ recentAnswered: 9, recentAccuracy: 30 }))).toBeNull();
});

test('accuracy at the 60% line or above is not called low', () => {
  expect(quizOffer(input({ recentAnswered: 10, recentAccuracy: 60 }))).toBeNull();
  expect(quizOffer(input({ recentAnswered: 25, recentAccuracy: 85 }))).toBeNull();
});

test('no accuracy data means no low-accuracy offer', () => {
  expect(quizOffer(input({ recentAnswered: 12, recentAccuracy: null }))).toBeNull();
});

test('due mistakes win when both reasons apply', () => {
  const offer = quizOffer(
    input({
      mistakes: [mistake('a', '2026-11-21'), mistake('b', '2026-11-21'), mistake('c', '2026-11-21')],
      recentAnswered: 12,
      recentAccuracy: 40
    })
  );

  expect(offer?.reason).toBe('due-mistakes');
  expect(offer?.text).toContain('到期错题');
});

test('nothing applies means the page stays silent', () => {
  expect(quizOffer(input())).toBeNull();
  expect(
    quizOffer(input({ mistakes: [mistake('a', '2026-12-01')], recentAnswered: 4, recentAccuracy: 90 }))
  ).toBeNull();
});

test('an offer shown today cools down until tomorrow', () => {
  const mistakes = [mistake('a', '2026-11-21'), mistake('b', '2026-11-21'), mistake('c', '2026-11-21')];

  expect(quizOffer(input({ mistakes, daysSinceLastOffer: 0 }))).toBeNull();

  const nextDay = quizOffer(input({ mistakes, daysSinceLastOffer: 1 }));
  expect(nextDay?.reason).toBe('due-mistakes');

  // No stored date at all behaves like "never offered".
  expect(quizOffer(input({ mistakes, daysSinceLastOffer: null }))?.reason).toBe('due-mistakes');
});
