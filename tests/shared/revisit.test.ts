import { describe, expect, test } from 'vitest';
import {
  REVISIT_LADDER_DAYS,
  nextRevisit
} from '../../src/shared/revisit';

describe('REVISIT_LADDER_DAYS', () => {
  test('is the fixed 3/7/14/30 table', () => {
    expect(REVISIT_LADDER_DAYS).toEqual([3, 7, 14, 30]);
  });
});

describe('nextRevisit when the learner catches the topic', () => {
  test('a topic without a step enters the ladder at 3 days / step 1', () => {
    expect(nextRevisit(undefined, true)).toEqual({ step: 1, days: 3 });
  });

  test('step 1/2/3 caught walks 7/14/30 days', () => {
    expect(nextRevisit(1, true)).toEqual({ step: 2, days: 7 });
    expect(nextRevisit(2, true)).toEqual({ step: 3, days: 14 });
    expect(nextRevisit(3, true)).toEqual({ step: 4, days: 30 });
  });

  test('step 4 caught stays capped at 30 days / step 4', () => {
    expect(nextRevisit(4, true)).toEqual({ step: 4, days: 30 });
  });
});

describe('nextRevisit when the learner misses', () => {
  test('any step missed comes back to tomorrow / step 0', () => {
    expect(nextRevisit(undefined, false)).toEqual({ step: 0, days: 1 });
    expect(nextRevisit(0, false)).toEqual({ step: 0, days: 1 });
    expect(nextRevisit(1, false)).toEqual({ step: 0, days: 1 });
    expect(nextRevisit(2, false)).toEqual({ step: 0, days: 1 });
    expect(nextRevisit(3, false)).toEqual({ step: 0, days: 1 });
    expect(nextRevisit(4, false)).toEqual({ step: 0, days: 1 });
  });
});

describe('nextRevisit with off-ladder values counts them as never entered', () => {
  // The disk layer drops bad frontmatter before this runs (records.ts), but
  // the function defines its own behavior so no caller can produce NaN days.
  test('step 0 behaves like no step', () => {
    expect(nextRevisit(0, true)).toEqual({ step: 1, days: 3 });
  });

  test('out-of-range and non-integer steps start the ladder from the bottom', () => {
    expect(nextRevisit(5, true)).toEqual({ step: 1, days: 3 });
    expect(nextRevisit(-1, true)).toEqual({ step: 1, days: 3 });
    expect(nextRevisit(2.5, true)).toEqual({ step: 1, days: 3 });
    expect(nextRevisit(Number.NaN, true)).toEqual({ step: 1, days: 3 });
  });

  test('off-ladder steps missed still land on tomorrow / step 0', () => {
    expect(nextRevisit(5, false)).toEqual({ step: 0, days: 1 });
    expect(nextRevisit(Number.NaN, false)).toEqual({ step: 0, days: 1 });
  });
});
