import type { PracticeQuestion, PracticeSet } from '../../src/shared/practice';
import {
  INTERLEAVE_MAX_QUESTIONS,
  buildMixedPracticeSet,
  findMixableSets,
  interleave
} from '../../src/renderer/shell/interleave';

function question(id: string): PracticeQuestion {
  return {
    id,
    prompt: `题目 ${id}`,
    options: ['A', 'B'],
    answer: 0,
    explanation: ''
  };
}

function set(
  id: string,
  subject: string,
  questionIds: string[],
  title = `${id} 练习`
): PracticeSet {
  return {
    id,
    workspaceId: 'kaoyan',
    title,
    subject,
    questions: questionIds.map(question)
  };
}

describe('interleave', () => {
  it('round-robins two sets with unequal sizes and skips the exhausted set', () => {
    const a = set('a', '数学', ['a1', 'a2', 'a3']);
    const b = set('b', '数学', ['b1', 'b2']);

    const entries = interleave([a, b]);

    expect(entries.map((entry) => entry.question.id)).toEqual([
      'a1',
      'b1',
      'a2',
      'b2',
      'a3'
    ]);
    // Each entry keeps the set it came from, for the `来自：…` line.
    expect(entries[0]).toMatchObject({ sourceSetId: 'a', sourceSetTitle: 'a 练习' });
    expect(entries[1]).toMatchObject({ sourceSetId: 'b', sourceSetTitle: 'b 练习' });
  });

  it('round-robins three sets and skips whichever is exhausted', () => {
    const a = set('a', '数学', ['a1', 'a2', 'a3']);
    const b = set('b', '数学', ['b1', 'b2']);
    const c = set('c', '数学', ['c1']);

    expect(interleave([a, b, c]).map((entry) => entry.question.id)).toEqual([
      'a1',
      'b1',
      'c1',
      'a2',
      'b2',
      'a3'
    ]);
  });

  it('caps the mixed list at 10 questions', () => {
    const a = set('a', '数学', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    const b = set('b', '数学', ['b1', 'b2', 'b3', 'b4', 'b5', 'b6']);

    const entries = interleave([a, b]);

    expect(INTERLEAVE_MAX_QUESTIONS).toBe(10);
    expect(entries).toHaveLength(10);
    expect(entries.map((entry) => entry.question.id)).toEqual([
      'a1',
      'b1',
      'a2',
      'b2',
      'a3',
      'b3',
      'a4',
      'b4',
      'a5',
      'b5'
    ]);
  });

  it('is deterministic: the same input yields the same order', () => {
    const sets = [
      set('a', '数学', ['a1', 'a2']),
      set('b', '数学', ['b1', 'b2', 'b3'])
    ];

    expect(interleave(sets)).toStrictEqual(interleave(sets));
  });

  it('returns nothing for fewer than two same-subject sets', () => {
    expect(interleave([])).toEqual([]);
    expect(interleave([set('a', '数学', ['a1'])])).toEqual([]);
  });

  it('never mixes different subjects', () => {
    const maths = set('a', '数学', ['a1', 'a2']);
    const english = set('b', '英语', ['b1', 'b2']);

    expect(interleave([maths, english])).toEqual([]);
    expect(findMixableSets([maths, english])).toBeNull();
  });

  it('ignores sets with an empty subject or no questions', () => {
    const first = set('a', '数学', ['a1', 'a2']);
    const second = set('b', '数学', ['b1']);
    const noSubject = set('c', '', ['c1']);
    const empty = set('d', '数学', []);

    expect(
      interleave([first, second, noSubject, empty]).map((entry) => entry.question.id)
    ).toEqual(['a1', 'b1', 'a2']);
    expect(findMixableSets([first, second, noSubject, empty])?.map((entry) => entry.id)).toEqual([
      'a',
      'b'
    ]);

    // An empty-question set cannot make a mix on its own.
    expect(findMixableSets([first, noSubject, empty])).toBeNull();
  });

  it('picks the largest same-subject group when several qualify', () => {
    const mathsA = set('ma', '数学', ['ma1']);
    const mathsB = set('mb', '数学', ['mb1']);
    const englishA = set('ea', '英语', ['ea1']);
    const englishB = set('eb', '英语', ['eb1']);
    const englishC = set('ec', '英语', ['ec1']);

    const mixable = findMixableSets([mathsA, mathsB, englishA, englishB, englishC]);

    expect(mixable?.map((entry) => entry.id)).toEqual(['ea', 'eb', 'ec']);
  });
});

describe('buildMixedPracticeSet', () => {
  it('builds an in-memory set with a stable id, title and source map', () => {
    const a = set('a', '数学', ['a1', 'a2'], '极限基础');
    const b = set('b', '数学', ['b1'], '导数基础');

    const mixed = buildMixedPracticeSet([a, b]);

    expect(mixed).not.toBeNull();
    expect(mixed?.id).toBe('mix-数学');
    expect(mixed?.title).toBe('交错混练 · 数学');
    expect(mixed?.subject).toBe('数学');
    expect(mixed?.workspaceId).toBe('kaoyan');
    expect(mixed?.questions.map((entry) => entry.id)).toEqual(['a1', 'b1', 'a2']);
    expect(mixed?.sources).toEqual({ a1: '极限基础', b1: '导数基础', a2: '极限基础' });
  });

  it('returns null when fewer than two same-subject sets qualify', () => {
    expect(buildMixedPracticeSet([])).toBeNull();
    expect(buildMixedPracticeSet([set('a', '数学', ['a1'])])).toBeNull();
    expect(
      buildMixedPracticeSet([set('a', '数学', ['a1']), set('b', '英语', ['b1'])])
    ).toBeNull();
  });
});