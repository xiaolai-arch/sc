import type { PracticeAttempt, PracticeMistake } from '../../src/shared/practice';
import {
  WEEKLY_HONEST_WEEKS,
  projectResolvedCommitment,
  weeklyAccuracyBySubject,
  weeklyHonest,
  type WeeklyHonestCommitment
} from '../../src/main/check-ins/weekly-honest';

// Saturday 21 November 2026. The current Monday week runs 11-16..11-22, so
// the 8-week window spans Monday 2026-09-28 .. Sunday 2026-11-22.
const TODAY = '2026-11-21';

function attempt(overrides: Partial<PracticeAttempt> = {}): PracticeAttempt {
  return {
    id: 'a1',
    workspaceId: 'kaoyan',
    setId: 'set-1',
    questionId: 'q1',
    choice: 0,
    correct: true,
    answeredAt: '2026-11-20T10:00:00',
    ...overrides
  };
}

function mistake(
  id: string,
  overrides: Partial<PracticeMistake> & { subject?: string } = {}
): PracticeMistake & { subject?: string } {
  return {
    id,
    workspaceId: 'kaoyan',
    setId: 'set-1',
    questionId: `q-${id}`,
    prompt: '题目',
    options: ['A', 'B'],
    answer: 0,
    explanation: '',
    wrongCount: 1,
    correctStreak: 0,
    priority: 1,
    intervalDays: 1,
    due: '2026-11-20',
    status: 'active',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    lastAnsweredAt: '2026-11-01T00:00:00.000Z',
    ...overrides
  };
}

describe('calibration', () => {
  test('counts only the two mismatch cells inside the 8-week window', () => {
    const result = weeklyHonest({
      today: TODAY,
      attempts: [
        attempt({ id: 's1', confidence: 'sure', correct: false }),
        attempt({ id: 's2', confidence: 'sure', correct: false }),
        // Matching cells are not "honest" facts and must not leak in.
        attempt({ id: 's3', confidence: 'sure', correct: true }),
        attempt({ id: 'u1', confidence: 'unsure', correct: true }),
        attempt({ id: 'u2', confidence: 'unsure', correct: false }),
        // No confidence mark, outside the window, unparseable: all ignored.
        attempt({ id: 'plain', correct: false }),
        attempt({ id: 'old', confidence: 'sure', correct: false, answeredAt: '2026-09-27T10:00:00' }),
        attempt({ id: 'future', confidence: 'sure', correct: false, answeredAt: '2026-12-05T10:00:00' }),
        attempt({ id: 'bad', confidence: 'unsure', correct: true, answeredAt: 'not-a-date' })
      ],
      mistakes: []
    });

    expect(result.calibration).toBe('有把握但错 2 道 · 没把握但对 1 道');
    expect(WEEKLY_HONEST_WEEKS).toBe(8);
  });

  test('keeps the first day of the oldest week inside the window', () => {
    const result = weeklyHonest({
      today: TODAY,
      attempts: [
        attempt({ id: 'edge', confidence: 'sure', correct: false, answeredAt: '2026-09-28T10:00:00' })
      ],
      mistakes: []
    });

    expect(result.calibration).toBe('有把握但错 1 道');
  });

  test('reports one segment when only one mismatch cell exists', () => {
    expect(
      weeklyHonest({
        today: TODAY,
        attempts: [attempt({ confidence: 'sure', correct: false })],
        mistakes: []
      }).calibration
    ).toBe('有把握但错 1 道');

    expect(
      weeklyHonest({
        today: TODAY,
        attempts: [attempt({ confidence: 'unsure', correct: true })],
        mistakes: []
      }).calibration
    ).toBe('没把握但对 1 道');
  });

  test('is null when neither mismatch cell exists', () => {
    expect(
      weeklyHonest({
        today: TODAY,
        attempts: [
          attempt({ id: 's', confidence: 'sure', correct: true }),
          attempt({ id: 'u', confidence: 'unsure', correct: false }),
          attempt({ id: 'plain', correct: false })
        ],
        mistakes: []
      }).calibration
    ).toBeNull();
    expect(weeklyHonest({ today: TODAY, attempts: [], mistakes: [] }).calibration).toBeNull();
  });
});

describe('next step', () => {
  test('picks the subject with the most active due mistakes', () => {
    const result = weeklyHonest({
      today: TODAY,
      attempts: [],
      mistakes: [
        mistake('a', { subject: '三角函数', due: '2026-11-10' }),
        mistake('b', { subject: '三角函数', due: '2026-11-20' }),
        mistake('c', { subject: '三角函数', due: TODAY }),
        // Future, resolved and subject-less records do not count.
        mistake('d', { subject: '三角函数', due: '2026-11-22' }),
        mistake('e', { subject: '三角函数', status: 'resolved' }),
        mistake('f', { due: '2026-11-01' }),
        mistake('g', { subject: '导数', due: '2026-11-20' })
      ]
    });

    expect(result.nextStep).toBe('下周先练「三角函数」的到期错题（3 道）');
  });

  test('breaks a due-mistake tie with the lowest accuracy', () => {
    const result = weeklyHonest({
      today: TODAY,
      attempts: [],
      mistakes: [
        mistake('a', { subject: '三角函数' }),
        mistake('b', { subject: '三角函数' }),
        mistake('c', { subject: '导数' }),
        mistake('d', { subject: '导数' })
      ],
      accuracyBySubject: {
        三角函数: { answered: 4, correct: 2 },
        导数: { answered: 4, correct: 1 }
      }
    });

    expect(result.nextStep).toBe('下周先练「导数」的到期错题（2 道）');
  });

  test('breaks a full tie by subject name, never by input order', () => {
    const forward = weeklyHonest({
      today: TODAY,
      attempts: [],
      mistakes: [
        mistake('a', { subject: '三角函数' }),
        mistake('b', { subject: '导数' })
      ]
    });
    const reversed = weeklyHonest({
      today: TODAY,
      attempts: [],
      mistakes: [
        mistake('b', { subject: '导数' }),
        mistake('a', { subject: '三角函数' })
      ]
    });

    expect(forward.nextStep).toBe('下周先练「三角函数」的到期错题（1 道）');
    expect(reversed.nextStep).toBe(forward.nextStep);
  });

  test('a known accuracy beats a missing one on a tie', () => {
    const result = weeklyHonest({
      today: TODAY,
      attempts: [],
      mistakes: [
        mistake('a', { subject: '三角函数' }),
        mistake('b', { subject: '导数' })
      ],
      accuracyBySubject: {
        导数: { answered: 12, correct: 6 }
      }
    });

    // 三角函数 has no accuracy data, so it ranks after the known subject.
    expect(result.nextStep).toBe('下周先练「导数」的到期错题（1 道）');
  });

  test('falls back to the lowest-accuracy subject with at least 10 answers', () => {
    const result = weeklyHonest({
      today: TODAY,
      attempts: [],
      mistakes: [],
      accuracyBySubject: {
        数学: { answered: 12, correct: 6 },
        英语: { answered: 10, correct: 2 },
        政治: { answered: 9, correct: 0 }
      }
    });

    expect(result.nextStep).toBe('下周先补一补「英语」：近 8 周正确率 20%');
  });

  test('the fallback tie is also resolved by subject name', () => {
    const result = weeklyHonest({
      today: TODAY,
      attempts: [],
      mistakes: [],
      accuracyBySubject: {
        导数: { answered: 10, correct: 2 },
        三角函数: { answered: 20, correct: 4 }
      }
    });

    // 三 (U+4E09) sorts before 导 (U+5BFC) by code unit.
    expect(result.nextStep).toBe('下周先补一补「三角函数」：近 8 周正确率 20%');
  });

  test('is null when no subject qualifies', () => {
    expect(weeklyHonest({ today: TODAY, attempts: [], mistakes: [] }).nextStep).toBeNull();
    expect(
      weeklyHonest({
        today: TODAY,
        attempts: [],
        mistakes: [mistake('a', { due: '2026-11-20' })],
        accuracyBySubject: { 数学: { answered: 9, correct: 0 } }
      }).nextStep
    ).toBeNull();
  });

  test('both fields can be null at once', () => {
    expect(weeklyHonest({ today: TODAY, attempts: [], mistakes: [] })).toEqual({
      calibration: null,
      nextStep: null
    });
  });
});

describe('accountability clause', () => {
  // TODAY = 2026-11-21 (Saturday); the current Monday week is 11-16..11-22.
  function resolved(
    overrides: Partial<WeeklyHonestCommitment> = {}
  ): WeeklyHonestCommitment {
    return {
      id: 'cm-1',
      text: '写完第三章',
      due: '2026-11-20',
      status: 'done',
      resolvedAt: '2026-11-19T10:00:00',
      ...overrides
    };
  }

  test('appears exactly once with the exact clause when a name and a resolved promise exist', () => {
    const result = weeklyHonest({
      today: TODAY,
      attempts: [],
      mistakes: [],
      accountabilityName: '小林',
      resolvedCommitments: [resolved()]
    });

    expect(result.accountability).toBe(
      '你说过要做「写完第三章」，你告诉过 小林 的时间是 2026-11-20'
    );
  });

  test('a workspaceId on the record is accepted and leaves the sentence byte-identical', () => {
    // The projection now carries `workspaceId`; nothing consumes it yet, so a
    // record with one and a record without must produce the same sentence.
    const withProject = weeklyHonest({
      today: TODAY,
      attempts: [],
      mistakes: [],
      accountabilityName: '小林',
      resolvedCommitments: [resolved({ workspaceId: 'ws-exam' })]
    });
    const withoutProject = weeklyHonest({
      today: TODAY,
      attempts: [],
      mistakes: [],
      accountabilityName: '小林',
      resolvedCommitments: [resolved()]
    });
    expect(withProject.accountability).toBe(withoutProject.accountability);
    expect(withProject.accountability).toBe(
      '你说过要做「写完第三章」，你告诉过 小林 的时间是 2026-11-20'
    );
  });

  test('projectResolvedCommitment carries workspaceId only when the record has one', () => {
    const base = {
      id: 'cm-1',
      text: '写完第三章',
      due: '2026-11-20',
      status: 'done' as const,
      resolvedAt: '2026-11-19T10:00:00'
    };
    // With a project: the key is present and equal.
    expect(projectResolvedCommitment({ ...base, workspaceId: 'ws-exam' })).toEqual({
      ...base,
      workspaceId: 'ws-exam'
    });
    // Without one: the key is absent, not present-and-undefined, so deep
    // equality and serialization see the record's own shape.
    const without = projectResolvedCommitment(base);
    expect(without).toEqual(base);
    expect(Object.prototype.hasOwnProperty.call(without, 'workspaceId')).toBe(false);
  });

  test('is absent when the name is blank or missing', () => {
    for (const accountabilityName of [undefined, '', '   ']) {
      const result = weeklyHonest({
        today: TODAY,
        attempts: [],
        mistakes: [],
        ...(accountabilityName === undefined ? {} : { accountabilityName }),
        resolvedCommitments: [resolved()]
      });
      expect(result).not.toHaveProperty('accountability');
      expect(result).toEqual({ calibration: null, nextStep: null });
    }
  });

  test('is absent when no promise resolved this week', () => {
    expect(
      weeklyHonest({
        today: TODAY,
        attempts: [],
        mistakes: [],
        accountabilityName: '小林',
        resolvedCommitments: []
      })
    ).not.toHaveProperty('accountability');

    // Resolved last week (the 11-15 Sunday belongs to the previous Monday week).
    expect(
      weeklyHonest({
        today: TODAY,
        attempts: [],
        mistakes: [],
        accountabilityName: '小林',
        resolvedCommitments: [resolved({ resolvedAt: '2026-11-15T10:00:00' })]
      })
    ).not.toHaveProperty('accountability');

    // Resolved next week / unparseable timestamps never count either.
    expect(
      weeklyHonest({
        today: TODAY,
        attempts: [],
        mistakes: [],
        accountabilityName: '小林',
        resolvedCommitments: [
          resolved({ resolvedAt: '2026-11-23T10:00:00' }),
          resolved({ id: 'bad', resolvedAt: 'not-a-date' })
        ]
      })
    ).not.toHaveProperty('accountability');
  });

  test('ignores promises that are still open', () => {
    const open = resolved();
    const result = weeklyHonest({
      today: TODAY,
      attempts: [],
      mistakes: [],
      accountabilityName: '小林',
      // An open record has no resolvedAt and is filtered by the caller; even a
      // wrongly-typed status here must not produce a clause.
      resolvedCommitments: [{ ...open, status: 'open' as never }]
    });
    expect(result).not.toHaveProperty('accountability');
  });

  test('picks the most recently resolved promise deterministically', () => {
    const result = weeklyHonest({
      today: TODAY,
      attempts: [],
      mistakes: [],
      accountabilityName: '小林',
      resolvedCommitments: [
        resolved({ id: 'older', text: '旧承诺', resolvedAt: '2026-11-17T10:00:00' }),
        resolved({ id: 'newer', text: '新承诺', resolvedAt: '2026-11-20T10:00:00' })
      ]
    });
    expect(result.accountability).toBe(
      '你说过要做「新承诺」，你告诉过 小林 的时间是 2026-11-20'
    );

    // A same-instant tie falls to the larger id, never to input order.
    const a = weeklyHonest({
      today: TODAY,
      attempts: [],
      mistakes: [],
      accountabilityName: '小林',
      resolvedCommitments: [
        resolved({ id: 'a', text: 'A承诺' }),
        resolved({ id: 'b', text: 'B承诺' })
      ]
    });
    const b = weeklyHonest({
      today: TODAY,
      attempts: [],
      mistakes: [],
      accountabilityName: '小林',
      resolvedCommitments: [
        resolved({ id: 'b', text: 'B承诺' }),
        resolved({ id: 'a', text: 'A承诺' })
      ]
    });
    expect(a.accountability).toBe(b.accountability);
    expect(a.accountability).toContain('「B承诺」');
  });

  test('the two original fields stay byte-identical without a clause', () => {
    expect(
      weeklyHonest({
        today: TODAY,
        attempts: [attempt({ confidence: 'sure', correct: false })],
        mistakes: []
      })
    ).toEqual({ calibration: '有把握但错 1 道', nextStep: null });
  });
});

describe('weeklyAccuracyBySubject', () => {
  test('joins attempts through the set map inside the same window', () => {
    const subjectBySetId = new Map([
      ['set-1', '数学'],
      ['set-2', '英语'],
      ['set-3', '  ']
    ]);
    const result = weeklyAccuracyBySubject(
      [
        attempt({ id: 'a', setId: 'set-1', correct: true }),
        attempt({ id: 'b', setId: 'set-1', correct: false }),
        attempt({ id: 'c', setId: 'set-2', correct: true }),
        // Outside the window, unmapped set, blank subject: all ignored.
        attempt({ id: 'old', setId: 'set-1', correct: false, answeredAt: '2026-09-27T10:00:00' }),
        attempt({ id: 'unknown', setId: 'set-9', correct: true }),
        attempt({ id: 'blank', setId: 'set-3', correct: true }),
        attempt({ id: 'bad', setId: 'set-1', correct: true, answeredAt: 'nope' })
      ],
      subjectBySetId,
      TODAY
    );

    expect(result).toEqual({
      数学: { answered: 2, correct: 1 },
      英语: { answered: 1, correct: 1 }
    });
  });
});