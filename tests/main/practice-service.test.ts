import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPracticeService } from '../../src/main/practice';
import {
  coerceQuestion,
  parseAttemptFile,
  parseMistakesFile,
  parsePracticeSetFile,
  serializeAttemptFile,
  serializeMistakesFile,
  serializePracticeSetFile
} from '../../src/main/practice/records';
import type {
  CreatePracticeQuestionInput,
  PracticeAttempt,
  PracticeMistake,
  PracticeSet
} from '../../src/shared/practice';
import { serializeNote } from '../../src/main/vault/note';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'practice-service-'));
  // Practice seeds augment existing workspaces; WorkspaceService owns creating
  // the vault itself. Tests create the two demo workspaces that hold seeds.
  await fs.mkdir(join(root, 'workspaces', 'kaoyan'), { recursive: true });
  await fs.mkdir(join(root, 'workspaces', 'english'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function at(date: string) {
  return createPracticeService(root, { now: () => new Date(`${date}T09:00:00`) });
}

test('seeds 考研/英语 practice sets as Obsidian-readable markdown', async () => {
  const service = at('2026-11-01');
  const kaoyan = await service.listSets('kaoyan');
  expect(kaoyan.map((set) => set.id)).toEqual(['ps1', 'ps2']);
  expect(kaoyan.map((set) => set.title)).toEqual(['极限基础 3 题', '马原易错 3 题']);
  expect(kaoyan[0]?.questions).toHaveLength(3);
  expect(kaoyan[0]?.questions[0]).toMatchObject({ id: 'q1', answer: 1 });

  const english = await service.listSets('english');
  expect(english.map((set) => set.id)).toEqual(['ps3']);
  expect(english[0]?.subject).toBe('英语');
  expect(await service.listSets('project')).toEqual([]);

  const file = join(root, 'workspaces', 'kaoyan', 'practice', 'sets', 'ps1.md');
  const raw = await fs.readFile(file, 'utf8');
  expect(raw.startsWith('---')).toBe(true);
  expect(raw).toContain('kind: practice-set');
  expect(raw).toContain('sin x / x');
  expect(raw).toContain('## 1.');
});

test('does not duplicate seed sets for a fresh service instance', async () => {
  await at('2026-11-01').listSets('kaoyan');
  const again = await at('2026-11-01').listSets('kaoyan');
  expect(again).toHaveLength(2);
});

test('getSet returns a set and null for unknown ids', async () => {
  const service = at('2026-11-01');
  const set = await service.getSet('ps1');
  expect(set?.workspaceId).toBe('kaoyan');
  expect(set?.questions.map((question) => question.id)).toEqual(['q1', 'q2', 'q3']);
  expect(await service.getSet('missing')).toBeNull();
});

test('scores a correct answer without creating a mistake', async () => {
  const service = at('2026-11-01');
  const result = await service.submitAnswer({ questionId: 'q1', choice: 1 });

  expect(result).toMatchObject({
    questionId: 'q1',
    setId: 'ps1',
    workspaceId: 'kaoyan',
    correct: true,
    answer: 1,
    mistake: null
  });
  expect(result.attempt.correct).toBe(true);
  expect(await service.getMistakes('kaoyan')).toEqual([]);
  expect(await service.getDue('kaoyan', '2026-11-01')).toEqual([]);

  const attempts = await service.listAttempts('kaoyan');
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ questionId: 'q1', choice: 1, correct: true });

  const attemptFile = join(root, 'workspaces', 'kaoyan', 'practice', 'attempts', '2026-11-01.md');
  expect(await fs.readFile(attemptFile, 'utf8')).toContain('practice-attempts');
});

test('a wrong answer creates a mistake due tomorrow', async () => {
  const service = at('2026-11-01');
  const result = await service.submitAnswer({ questionId: 'q1', choice: 0 });

  expect(result.correct).toBe(false);
  expect(result.answer).toBe(1);
  expect(result.mistake).toMatchObject({
    questionId: 'q1',
    wrongCount: 1,
    priority: 1,
    intervalDays: 1,
    due: '2026-11-02',
    status: 'active'
  });
  expect(result.due).toBe('2026-11-02');

  const mistakes = await service.getMistakes('kaoyan');
  expect(mistakes).toHaveLength(1);
  expect(mistakes[0]?.due).toBe('2026-11-02');
  expect(await service.getDue('kaoyan', '2026-11-01')).toEqual([]);
  expect((await service.getDue('kaoyan', '2026-11-02')).map((entry) => entry.questionId)).toEqual([
    'q1'
  ]);

  const raw = await fs.readFile(join(root, 'workspaces', 'kaoyan', 'practice', 'mistakes.md'), 'utf8');
  expect(raw).toContain('kind: practice-mistakes');
  expect(raw).toContain('q1');
});

test('repeated wrong answers reset the interval to one day and raise difficulty', async () => {
  const first = await at('2026-11-01').submitAnswer({ questionId: 'q1', choice: 0 });
  expect(first.mistake).toMatchObject({
    intervalDays: 1,
    due: '2026-11-02',
    wrongCount: 1,
    stabilityDays: 1
  });
  expect(first.mistake?.difficulty).toBeCloseTo(0.4, 5);
  const mistakeId = first.mistake?.id;

  const second = await at('2026-11-02').submitAnswer({ questionId: 'q1', choice: 0 });
  expect(second.mistake).toMatchObject({
    id: mistakeId,
    intervalDays: 1,
    due: '2026-11-03',
    wrongCount: 2,
    priority: 2,
    stabilityDays: 1
  });
  expect(second.mistake?.difficulty).toBeCloseTo(0.5, 5);

  const third = await at('2026-11-03').submitAnswer({ questionId: 'q1', choice: 0 });
  expect(third.mistake).toMatchObject({
    id: mistakeId,
    intervalDays: 1,
    due: '2026-11-04',
    wrongCount: 3,
    priority: 3
  });
  expect(third.mistake?.difficulty).toBeCloseTo(0.6, 5);
});

test('correct answers grow the interval and move due forward', async () => {
  const first = await at('2026-11-01').submitAnswer({ questionId: 'q1', choice: 0 });
  const mistakeId = first.mistake?.id;

  // Regression for the old bug: a correct answer used to leave `due` frozen a
  // day out, so the mistake stayed due and the user mass-repeated it.
  const correct = await at('2026-11-02').submitAnswer({ questionId: 'q1', choice: 1 });
  expect(correct.correct).toBe(true);
  expect(correct.mistake).toMatchObject({
    id: mistakeId,
    status: 'active',
    correctStreak: 1,
    intervalDays: 2,
    due: '2026-11-04'
  });
  expect(correct.due).toBe('2026-11-04');
  expect(correct.mistake?.difficulty).toBeCloseTo(0.35, 5);

  const stored = (await at('2026-11-02').getMistakes('kaoyan'))[0];
  expect(stored?.due).toBe('2026-11-04');
  expect(await at('2026-11-02').getDue('kaoyan', '2026-11-02')).toEqual([]);
});

test('a correct streak produces strictly growing intervals beyond a week', async () => {
  await at('2026-11-01').submitAnswer({ questionId: 'q1', choice: 0 });

  const one = await at('2026-11-02').submitAnswer({ questionId: 'q1', choice: 1 });
  const two = await at(one.mistake!.due).submitAnswer({ questionId: 'q1', choice: 1 });
  const three = await at(two.mistake!.due).submitAnswer({ questionId: 'q1', choice: 1 });

  const intervals = [one, two, three].map((result) => result.mistake!.intervalDays);
  expect(intervals[0]).toBeGreaterThanOrEqual(2);
  expect(intervals[1]).toBeGreaterThan(intervals[0]!);
  expect(intervals[2]).toBeGreaterThan(intervals[1]!);
  expect(intervals.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(7);
  expect(three.mistake?.status).toBe('resolved');

  // Mastery is written to the vault and the record leaves the active list.
  expect(await at('2026-12-01').getMistakes('kaoyan')).toEqual([]);
});

test('two same-day correct answers never resolve a mistake', async () => {
  await at('2026-11-01').submitAnswer({ questionId: 'q1', choice: 0 });

  const first = await at('2026-11-02').submitAnswer({ questionId: 'q1', choice: 1 });
  expect(first.mistake).toMatchObject({ status: 'active', correctStreak: 1 });

  const second = await at('2026-11-02').submitAnswer({ questionId: 'q1', choice: 1 });
  expect(second.mistake).toMatchObject({ status: 'active', correctStreak: 2 });
  expect(second.mistake?.due).toBe('2026-11-05');
  expect((await at('2026-11-02').getMistakes('kaoyan'))[0]?.status).toBe('active');
});

test('mistakes and attempts survive a fresh service instance', async () => {
  await at('2026-11-01').submitAnswer({ questionId: 'p2', choice: 0 });

  const fresh = at('2026-11-01');
  const mistakes = await fresh.getMistakes('kaoyan');
  expect(mistakes).toHaveLength(1);
  expect(mistakes[0]).toMatchObject({ questionId: 'p2', setId: 'ps2', due: '2026-11-02' });
  expect(await fresh.listAttempts('kaoyan')).toHaveLength(1);
  expect(await fresh.getDue('kaoyan', '2026-11-02')).toHaveLength(1);
});

test('reviews a mistake even after its practice set is gone', async () => {
  const service = at('2026-11-01');
  const first = await service.submitAnswer({ questionId: 'q1', choice: 0 });
  const mistakeId = first.mistake?.id ?? '';
  expect(mistakeId).toBeTruthy();
  await service.deleteSet!({ setId: 'ps1' });
  expect(await service.getSet('ps1')).toBeNull();

  const again = await at('2026-11-02').reviewMistake!({ mistakeId, choice: 0 });

  expect(again).toMatchObject({
    correct: false,
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: 'q1',
    answer: 1
  });
  expect(again.mistake).toMatchObject({
    id: mistakeId,
    wrongCount: 2,
    intervalDays: 1,
    due: '2026-11-03',
    status: 'active'
  });
  expect(await at('2026-11-02').getDue('kaoyan', '2026-11-03')).toHaveLength(1);
  const attempts = await at('2026-11-02').listAttempts('kaoyan');
  expect(attempts.at(-1)).toMatchObject({ questionId: 'q1', correct: false, setId: 'ps1' });
});

test('migrates a legacy record and persists the schedule on its first answer', async () => {
  // A mistake written by the pre-scheduling code: no stability/difficulty.
  const legacy: PracticeMistake = {
    id: 'pm-legacy',
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: 'q1',
    prompt: '当 x→0 时，sin x / x 的极限是？',
    options: ['0', '1', '∞'],
    answer: 1,
    explanation: '第一个重要极限。',
    wrongCount: 1,
    correctStreak: 0,
    priority: 2,
    intervalDays: 2,
    due: '2026-11-01',
    status: 'active',
    createdAt: '2026-10-29T09:00:00.000Z',
    updatedAt: '2026-10-29T09:00:00.000Z',
    lastAnsweredAt: '2026-10-29T09:00:00.000Z'
  };
  const path = join(root, 'workspaces', 'kaoyan', 'practice', 'mistakes.md');
  await fs.mkdir(join(root, 'workspaces', 'kaoyan', 'practice'), { recursive: true });
  await fs.writeFile(path, serializeMistakesFile('kaoyan', [legacy], '2026-10-29T09:00:00.000Z'));

  // Reading leaves the absent fields absent — nothing rewrites the file.
  const before = await fs.readFile(path, 'utf8');
  expect((await at('2026-11-01').getMistakes('kaoyan'))[0]?.stabilityDays).toBeUndefined();
  expect(await fs.readFile(path, 'utf8')).toBe(before);

  // First answer migrates stability 2 → difficulty 0.6, then applies the answer.
  const reviewed = await at('2026-11-01').reviewMistake!({ mistakeId: 'pm-legacy', choice: 1 });
  expect(reviewed.mistake).toMatchObject({
    stabilityDays: 3,
    intervalDays: 3,
    due: '2026-11-04',
    status: 'active'
  });
  expect(reviewed.mistake?.difficulty).toBeCloseTo(0.55, 5);

  const after = await fs.readFile(path, 'utf8');
  expect(after).toContain('stability: 3');
  expect(after).toContain('difficulty: 0.55');
  expect(parseMistakesFile(after)[0]).toMatchObject({ stabilityDays: 3, difficulty: 0.55 });
});

test('choice-only set files round-trip byte-identically without kind fields', () => {
  const set: PracticeSet = {
    id: 'ps1',
    workspaceId: 'kaoyan',
    title: '极限',
    subject: '数学',
    questions: [
      {
        id: 'q1',
        prompt: '极限？',
        options: ['0', '1'],
        answer: 1,
        explanation: '重要极限。'
      }
    ],
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-01T09:00:00.000Z'
  };
  const serialized = serializePracticeSetFile(set);
  expect(serialized).not.toContain('kind: short');
  expect(serialized).not.toContain('referenceAnswer');
  expect(parsePracticeSetFile(serialized, 'kaoyan', 'ps1')).toEqual(set);
  expect(serializePracticeSetFile(parsePracticeSetFile(serialized, 'kaoyan', 'ps1')!)).toBe(
    serialized
  );
});

test('model sets serialize source and reviewedAt; hand-made sets never do', () => {
  const base: PracticeSet = {
    id: 'ps1',
    workspaceId: 'kaoyan',
    title: '极限',
    subject: '数学',
    questions: [
      { id: 'q1', prompt: '极限？', options: ['0', '1'], answer: 1, explanation: '' }
    ],
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-01T09:00:00.000Z'
  };

  // Hand-made/default: no provenance keys at all, byte-identical round-trip.
  const handmade = serializePracticeSetFile(base);
  expect(handmade).toContain('source: user');
  expect(handmade).not.toContain('source: model');
  expect(handmade).not.toContain('reviewedAt');
  expect(parsePracticeSetFile(handmade, 'kaoyan', 'ps1')).toEqual(base);
  expect(serializePracticeSetFile(parsePracticeSetFile(handmade, 'kaoyan', 'ps1')!)).toBe(
    handmade
  );

  // An unreviewed model set carries `source: model` but no `reviewedAt`.
  const model = serializePracticeSetFile({ ...base, source: 'model' });
  expect(model).toContain('source: model');
  expect(model).not.toContain('reviewedAt');
  expect(parsePracticeSetFile(model, 'kaoyan', 'ps1')).toEqual({ ...base, source: 'model' });

  // A reviewed model set records the timestamp and round-trips exactly.
  const reviewed = serializePracticeSetFile({
    ...base,
    source: 'model',
    reviewedAt: '2026-11-21T10:00:00.000Z'
  });
  expect(reviewed).toContain("reviewedAt: '2026-11-21T10:00:00.000Z'");
  expect(parsePracticeSetFile(reviewed, 'kaoyan', 'ps1')).toEqual({
    ...base,
    source: 'model',
    reviewedAt: '2026-11-21T10:00:00.000Z'
  });
});

test('legacy set files without provenance round-trip byte-identically', () => {
  // The exact text a pre-provenance serializer wrote: `source: user`, no
  // reviewedAt. Reading and rewriting it must not add a line.
  const legacy = serializeNote(
    {
      type: 'qa',
      source: 'user',
      kind: 'practice-set',
      id: 'ps-legacy',
      workspaceId: 'kaoyan',
      title: '老练习',
      subject: '数学',
      created: '2026-10-01T09:00:00.000Z',
      updated: '2026-10-01T09:00:00.000Z',
      questions: [{ id: 'q1', prompt: '旧题？', options: ['0', '1'], answer: 1, explanation: '' }]
    },
    '# 老练习\n\nkaoyan · 数学 · 1 题\n\n## 1. 旧题？\n\n- A. 0\n- B. 1\n\n**答案**：B\n'
  );

  const parsed = parsePracticeSetFile(legacy, 'kaoyan', 'ps-legacy')!;
  expect(parsed.source).toBeUndefined();
  expect(parsed.reviewedAt).toBeUndefined();
  expect(serializePracticeSetFile(parsed)).toBe(legacy);
});

test('tolerant parse drops a bogus source instead of failing the set', () => {
  const raw = serializeNote(
    {
      type: 'qa',
      source: 'robot' as unknown as 'user',
      kind: 'practice-set',
      id: 'ps1',
      workspaceId: 'kaoyan',
      title: '怪来源',
      subject: '数学',
      reviewedAt: 'not-a-date',
      questions: [{ id: 'q1', prompt: '题？', options: ['0', '1'], answer: 1, explanation: '' }]
    },
    '# 怪来源\n'
  );
  const parsed = parsePracticeSetFile(raw, 'kaoyan', 'ps1')!;
  expect(parsed.source).toBeUndefined();
  expect(parsed.reviewedAt).toBeUndefined();
  expect(parsed.questions).toHaveLength(1);
});

test('createSet writes a model source and updateSet records reviewedAt', async () => {
  const service = at('2026-11-01');
  const created = await service.createSet({
    workspaceId: 'kaoyan',
    title: '阿咲出题',
    source: 'model',
    questions: [{ prompt: '矩阵可逆的条件？', options: ['|A| = 0', '|A| ≠ 0'], answer: 1 }]
  });
  expect(created.source).toBe('model');
  expect(created.reviewedAt).toBeUndefined();

  const file = join(root, 'workspaces', 'kaoyan', 'practice', 'sets', `${created.id}.md`);
  expect(await fs.readFile(file, 'utf8')).toContain('source: model');

  const reviewed = await service.updateSet!({
    setId: created.id,
    reviewedAt: '2026-11-21T10:00:00.000Z'
  });
  expect(reviewed.reviewedAt).toBe('2026-11-21T10:00:00.000Z');
  expect(reviewed.title).toBe(created.title);
  expect(reviewed.questions).toEqual(created.questions);
  expect(await fs.readFile(file, 'utf8')).toContain(
    "reviewedAt: '2026-11-21T10:00:00.000Z'"
  );
  // A fresh read sees the confirmation.
  expect((await at('2026-11-22').getSet(created.id))?.reviewedAt).toBe(
    '2026-11-21T10:00:00.000Z'
  );
});

test('createSet with source user and a hand-made set write no model marker', async () => {
  const service = at('2026-11-01');
  const created = await service.createSet({
    workspaceId: 'kaoyan',
    title: '自己出题',
    source: 'user',
    questions: [{ prompt: '1 + 1？', options: ['1', '2'], answer: 1 }]
  });
  expect(created.source).toBeUndefined();
  const raw = await fs.readFile(
    join(root, 'workspaces', 'kaoyan', 'practice', 'sets', `${created.id}.md`),
    'utf8'
  );
  expect(raw).toContain('source: user');
  expect(raw).not.toContain('source: model');
});

test('createSet and updateSet reject bogus provenance values', async () => {
  const service = at('2026-11-01');
  await expect(
    service.createSet({
      workspaceId: 'kaoyan',
      title: '怪来源',
      source: 'robot' as unknown as 'model',
      questions: [{ prompt: '题？', options: ['0', '1'], answer: 1 }]
    })
  ).rejects.toThrow('Invalid practice set source');

  const created = await service.createSet({
    workspaceId: 'kaoyan',
    title: '正常',
    questions: [{ prompt: '题？', options: ['0', '1'], answer: 1 }]
  });
  await expect(
    service.updateSet!({ setId: created.id, reviewedAt: 'not-a-date' })
  ).rejects.toThrow('Invalid practice set reviewedAt');
  // An update with only an empty field list still fails as before.
  await expect(service.updateSet!({ setId: created.id })).rejects.toThrow(
    'No practice set fields to update'
  );
});

test('short questions round-trip through the set-file serializer', () => {
  const set: PracticeSet = {
    id: 'ps1',
    workspaceId: 'kaoyan',
    title: '简答',
    subject: '数学',
    questions: [
      {
        id: 'q1',
        kind: 'short',
        prompt: '说明重要极限。',
        options: [],
        answer: 0,
        referenceAnswer: 'sin x / x → 1。',
        explanation: ''
      }
    ],
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-01T09:00:00.000Z'
  };
  const serialized = serializePracticeSetFile(set);
  expect(serialized).toContain('kind: short');
  expect(serialized).toContain('referenceAnswer: sin x / x → 1。');
  expect(serialized).toContain('**参考答案**：sin x / x → 1。');
  expect(parsePracticeSetFile(serialized, 'kaoyan', 'ps1')).toEqual(set);
});

test('coerceQuestion requires a non-empty reference answer for short questions', () => {
  expect(coerceQuestion({ id: 'q1', prompt: '题', kind: 'short' })).toBeNull();
  expect(
    coerceQuestion({ id: 'q1', prompt: '题', kind: 'short', referenceAnswer: '  ' })
  ).toBeNull();
  expect(
    coerceQuestion({ id: 'q1', prompt: '题', kind: 'short', referenceAnswer: '答' })
  ).toMatchObject({ id: 'q1', kind: 'short', options: [], answer: 0, referenceAnswer: '答' });
  // No `kind` keeps the original choice validation.
  expect(coerceQuestion({ id: 'q1', prompt: '题', options: ['A'], answer: 0 })).toBeNull();
});

test('short mistake records round-trip through the mistake book', () => {
  const short: PracticeMistake = {
    id: 'pm3',
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: 'q1',
    prompt: '说明重要极限。',
    kind: 'short',
    options: [],
    answer: 0,
    referenceAnswer: 'sin x / x → 1。',
    explanation: '',
    wrongCount: 1,
    correctStreak: 0,
    priority: 1,
    intervalDays: 1,
    due: '2026-11-05',
    status: 'active',
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-02T09:00:00.000Z',
    lastAnsweredAt: '2026-11-02T09:00:00.000Z'
  };
  const serialized = serializeMistakesFile('kaoyan', [short], '2026-11-02T09:00:00.000Z');
  expect(serialized).toContain('kind: short');
  expect(serialized).toContain('参考答案：sin x / x → 1。');
  expect(parseMistakesFile(serialized)).toEqual([short]);
});

test('attempt files round-trip and show a typed response for short answers', () => {
  const choice: PracticeAttempt = {
    id: 'pa1',
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: 'q1',
    choice: 1,
    correct: true,
    answeredAt: '2026-11-01T09:05:00.000Z'
  };
  const short: PracticeAttempt = {
    id: 'pa2',
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: 'q2',
    // Unused for a free-recall attempt, kept so every record has the shape.
    choice: 0,
    response: '极限是 1',
    correct: false,
    answeredAt: '2026-11-01T09:10:00.000Z'
  };
  const serialized = serializeAttemptFile('2026-11-01', [choice, short]);
  expect(serialized).toContain('选择 1');
  expect(serialized).toContain('简答「极限是 1」');
  expect(parseAttemptFile(serialized)).toEqual([choice, short]);

  // A choice-only log keeps its original text and never mentions a response.
  const choiceOnly = serializeAttemptFile('2026-11-01', [choice]);
  expect(choiceOnly).not.toContain('response');
  expect(choiceOnly).not.toContain('简答');
  expect(parseAttemptFile(choiceOnly)).toEqual([choice]);
});

test('parses and serializes old mistake records byte-identically', () => {
  const legacy: PracticeMistake = {
    id: 'pm1',
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: 'q1',
    prompt: '题',
    options: ['A', 'B'],
    answer: 1,
    explanation: '',
    wrongCount: 2,
    correctStreak: 0,
    priority: 1,
    intervalDays: 3,
    due: '2026-11-05',
    status: 'active',
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-02T09:00:00.000Z',
    lastAnsweredAt: '2026-11-02T09:00:00.000Z'
  };
  const serialized = serializeMistakesFile('kaoyan', [legacy], '2026-11-02T09:00:00.000Z');
  expect(serialized).not.toContain('stability');
  expect(serialized).not.toContain('difficulty');

  const parsed = parseMistakesFile(serialized);
  expect(parsed).toEqual([legacy]);
  expect(parseMistakesFile(serializeMistakesFile('kaoyan', parsed, '2026-11-02T09:00:00.000Z'))).toEqual(
    [legacy]
  );
});

test('new schedule fields round-trip through the mistake book', () => {
  const scheduled: PracticeMistake = {
    id: 'pm2',
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: 'q2',
    prompt: '题二',
    options: ['A', 'B'],
    answer: 0,
    explanation: '',
    wrongCount: 1,
    correctStreak: 1,
    priority: 0,
    intervalDays: 9,
    stabilityDays: 9,
    difficulty: 0.35,
    due: '2026-11-20',
    status: 'active',
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-11T09:00:00.000Z',
    lastAnsweredAt: '2026-11-11T09:00:00.000Z'
  };
  const serialized = serializeMistakesFile('kaoyan', [scheduled], '2026-11-11T09:00:00.000Z');
  expect(serialized).toContain('stability: 9');
  expect(serialized).toContain('difficulty: 0.35');
  expect(parseMistakesFile(serialized)).toEqual([scheduled]);
});

test('a spaced correct mistake review resolves it', async () => {
  const first = await at('2026-11-01').submitAnswer({ questionId: 'q1', choice: 0 });
  const mistakeId = first.mistake?.id ?? '';

  // The elapsed 1-day interval is not spaced, so this answer only grows the
  // schedule; it must not declare the mistake mastered.
  const grew = await at('2026-11-02').reviewMistake!({ mistakeId, choice: 1 });
  expect(grew.correct).toBe(true);
  expect(grew.mistake).toMatchObject({
    status: 'active',
    correctStreak: 1,
    priority: 0,
    intervalDays: 2,
    due: '2026-11-04'
  });

  // Now the interval that elapsed (2 days) is still short…
  const stillGrowing = await at('2026-11-04').reviewMistake!({ mistakeId, choice: 1 });
  expect(stillGrowing.mistake).toMatchObject({ status: 'active', intervalDays: 3 });

  // …and the one after it is ≥ 3 days, so the mistake is mastered.
  const resolved = await at('2026-11-07').reviewMistake!({ mistakeId, choice: 1 });
  expect(resolved.correct).toBe(true);
  expect(resolved.mistake).toMatchObject({ status: 'resolved', correctStreak: 3 });
  expect(await at('2026-11-07').getMistakes('kaoyan')).toEqual([]);
  expect(await at('2026-11-07').getDue('kaoyan', '2026-12-01')).toEqual([]);
});

test('marks a mistake resolved without answering it', async () => {
  const first = await at('2026-11-01').submitAnswer({ questionId: 'q1', choice: 0 });
  const mistakeId = first.mistake?.id ?? '';

  const resolved = await at('2026-11-02').setMistakeResolved!({ mistakeId, resolved: true });
  expect(resolved).toMatchObject({ id: mistakeId, status: 'resolved' });
  expect(await at('2026-11-02').getMistakes('kaoyan')).toEqual([]);

  const reopened = await at('2026-11-02').setMistakeResolved!({ mistakeId, resolved: false });
  expect(reopened.status).toBe('active');
  expect(await at('2026-11-02').getMistakes('kaoyan')).toHaveLength(1);
});

test('rejects unknown mistakes and invalid review choices', async () => {
  const service = at('2026-11-01');
  await expect(service.reviewMistake!({ mistakeId: 'missing', choice: 0 })).rejects.toThrow(
    'Mistake not found'
  );

  const first = await service.submitAnswer({ questionId: 'q1', choice: 0 });
  const mistakeId = first.mistake?.id ?? '';
  await expect(service.reviewMistake!({ mistakeId, choice: 9 })).rejects.toThrow(
    'Invalid answer choice'
  );
  await expect(service.reviewMistake!({ mistakeId, choice: -1 })).rejects.toThrow(
    'Invalid answer choice'
  );

  await service.setMistakeResolved!({ mistakeId, resolved: true });
  await expect(service.reviewMistake!({ mistakeId, choice: 1 })).rejects.toThrow(
    'Mistake is already resolved'
  );
});

test('createSet persists a custom set that can be answered', async () => {
  const service = at('2026-11-01');
  const created = await service.createSet({
    workspaceId: 'kaoyan',
    title: '线代小测',
    subject: '数学',
    questions: [
      {
        prompt: '矩阵 A 可逆的充要条件是？',
        options: ['|A| = 0', '|A| ≠ 0', 'A 是对称矩阵'],
        answer: 1,
        explanation: '行列式不为零时矩阵可逆。'
      },
      {
        id: 'custom-q2',
        prompt: '单位矩阵的行列式是？',
        options: ['0', '1'],
        answer: 1
      }
    ]
  });

  expect(created.id).toMatch(/^ps-/);
  expect(created.questions).toHaveLength(2);
  const loaded = await service.getSet(created.id);
  expect(loaded?.title).toBe('线代小测');
  expect(loaded?.questions[1]?.id).toBe('custom-q2');

  const result = await service.submitAnswer({ questionId: created.questions[0]!.id, choice: 1 });
  expect(result.correct).toBe(true);
  expect(result.setId).toBe(created.id);
});

test('renames a practice set without touching its questions', async () => {
  const service = at('2026-11-01');
  const created = await service.createSet({
    workspaceId: 'kaoyan',
    title: '线代小测',
    questions: [{ prompt: '矩阵可逆的条件？', options: ['|A| = 0', '|A| ≠ 0'], answer: 1 }]
  });

  const updated = await service.updateSet?.({
    setId: created.id,
    title: '线代冲刺',
    subject: '数学一'
  });
  expect(updated).toMatchObject({ id: created.id, title: '线代冲刺', subject: '数学一' });
  expect(updated?.questions).toHaveLength(1);

  const fresh = at('2026-11-02');
  expect((await fresh.getSet(created.id))?.title).toBe('线代冲刺');
  await expect(service.updateSet?.({ setId: created.id })).rejects.toThrow('No practice set fields');
  await expect(service.updateSet?.({ setId: 'missing', title: 'x' })).rejects.toThrow('not found');
});

test('replaces practice questions while keeping the ids it is given', async () => {
  const service = at('2026-11-01');
  const created = await service.createSet({
    workspaceId: 'kaoyan',
    title: '线代小测',
    questions: [
      { prompt: '矩阵可逆的条件？', options: ['|A| = 0', '|A| ≠ 0'], answer: 1 },
      { prompt: '单位矩阵的行列式？', options: ['0', '1'], answer: 1 }
    ]
  });
  const keptId = created.questions[0]!.id;

  const updated = await service.updateSet?.({
    setId: created.id,
    questions: [
      { id: keptId, prompt: '矩阵可逆的充要条件？', options: ['|A| = 0', '|A| ≠ 0'], answer: 1 },
      { prompt: '新增：秩为 n 说明？', options: ['不可逆', '满秩'], answer: 1 }
    ]
  });

  expect(updated?.title).toBe('线代小测');
  expect(updated?.questions).toHaveLength(2);
  expect(updated?.questions[0]).toMatchObject({
    id: keptId,
    prompt: '矩阵可逆的充要条件？'
  });
  expect(updated?.questions[1]?.prompt).toBe('新增：秩为 n 说明？');

  const fresh = at('2026-11-02');
  expect((await fresh.getSet(created.id))?.questions[0]?.id).toBe(keptId);
  await expect(service.updateSet?.({ setId: created.id, questions: [] })).rejects.toThrow(
    'at least one question'
  );
});

test('deletes a practice set but keeps its answer history', async () => {
  const service = at('2026-11-01');
  const created = await service.createSet({
    workspaceId: 'kaoyan',
    title: '待删除',
    questions: [{ prompt: '矩阵可逆的条件？', options: ['|A| = 0', '|A| ≠ 0'], answer: 1 }]
  });
  await service.submitAnswer({ questionId: created.questions[0]!.id, choice: 1 });

  await service.deleteSet?.({ setId: created.id });

  expect(await service.getSet(created.id)).toBeNull();
  expect((await service.listSets('kaoyan')).some((set) => set.id === created.id)).toBe(false);
  expect((await service.listAttempts('kaoyan')).some((attempt) => attempt.setId === created.id)).toBe(
    true
  );
  await expect(service.deleteSet?.({ setId: created.id })).rejects.toThrow('not found');
});

test('rejects malformed createSet input', async () => {
  const service = at('2026-11-01');
  await expect(
    service.createSet({ workspaceId: 'kaoyan', title: '空', questions: [] })
  ).rejects.toThrow('at least one question');
  await expect(
    service.createSet({
      workspaceId: 'kaoyan',
      title: '越界',
      questions: [{ prompt: '题', options: ['A', 'B'], answer: 5 }]
    })
  ).rejects.toThrow('out of range');
  await expect(
    service.createSet({
      workspaceId: 'kaoyan',
      title: '重复',
      questions: [
        { id: 'dup', prompt: '题一', options: ['A', 'B'], answer: 0 },
        { id: 'dup', prompt: '题二', options: ['A', 'B'], answer: 0 }
      ]
    })
  ).rejects.toThrow('Duplicate question id');
});

test('rejects invalid answers', async () => {
  const service = at('2026-11-01');
  await expect(service.submitAnswer({ questionId: 'q1', choice: 9 })).rejects.toThrow(
    'Invalid answer choice'
  );
  await expect(service.submitAnswer({ questionId: 'q1', choice: -1 })).rejects.toThrow(
    'Invalid answer choice'
  );
  await expect(service.submitAnswer({ questionId: 'q1', choice: 1.5 })).rejects.toThrow(
    'Invalid answer choice'
  );
  await expect(service.submitAnswer({ questionId: 'nope', choice: 0 })).rejects.toThrow(
    'Question not found'
  );
});

test('exports a printable review sheet for the active mistakes', async () => {
  const service = at('2026-11-01');
  await service.submitAnswer({ questionId: 'q1', choice: 0 });
  await service.submitAnswer({ questionId: 'p2', choice: 0 });

  const result = await service.exportMistakeSheet!({ workspaceId: 'kaoyan' });
  expect(result).toEqual({
    path: 'workspaces/kaoyan/practice/review-sheets/2026-11-01.md',
    count: 2,
    date: '2026-11-01'
  });

  const raw = await fs.readFile(
    join(root, 'workspaces', 'kaoyan', 'practice', 'review-sheets', '2026-11-01.md'),
    'utf8'
  );
  expect(raw).toContain('kind: practice-review-sheet');
  expect(raw).toContain('# 错题复习单 · 2026-11-01');
  expect(raw).toContain('A. 0');
  expect(raw).toContain('B. 1');
  expect(raw).toContain('答案：B');
  expect(raw).toContain('错 1 次 · 优先级 1 · 下次复习 2026-11-02');
  // Sorted by priority, then due date, then question id — same as getMistakes.
  expect(raw.indexOf('## 1.')).toBeLessThan(raw.indexOf('## 2.'));
});

test('re-exporting the same day overwrites the sheet instead of duplicating it', async () => {
  const service = at('2026-11-01');
  await service.submitAnswer({ questionId: 'q1', choice: 0 });
  const first = await service.exportMistakeSheet!({ workspaceId: 'kaoyan' });
  const before = await fs.readFile(join(root, first.path), 'utf8');

  await service.submitAnswer({ questionId: 'p2', choice: 0 });
  const second = await service.exportMistakeSheet!({ workspaceId: 'kaoyan' });
  expect(second.path).toBe(first.path);
  expect(second.count).toBe(2);

  const dir = join(root, 'workspaces', 'kaoyan', 'practice', 'review-sheets');
  expect(await fs.readdir(dir)).toEqual(['2026-11-01.md']);
  const after = await fs.readFile(join(root, second.path), 'utf8');
  expect(after).not.toBe(before);
  expect(after).toContain('entries: 2');
});

test('dueOnly keeps just the mistakes due today or earlier', async () => {
  await at('2026-11-01').submitAnswer({ questionId: 'q1', choice: 0 });

  // 11-02 is q1's first review day; the sheet on 11-03 includes it, on 11-01 not.
  const early = await at('2026-11-01').exportMistakeSheet!({
    workspaceId: 'kaoyan',
    dueOnly: true
  });
  expect(early.count).toBe(0);
  const earlyRaw = await fs.readFile(join(root, early.path), 'utf8');
  expect(earlyRaw).toContain('entries: 0');

  const later = await at('2026-11-02').exportMistakeSheet!({
    workspaceId: 'kaoyan',
    dueOnly: true
  });
  expect(later.count).toBe(1);
  const laterRaw = await fs.readFile(join(root, later.path), 'utf8');
  expect(laterRaw).toContain('当 x→0 时，sin x / x 的极限是？');
  expect(laterRaw).toContain('错 1 次 · 优先级 1 · 下次复习 2026-11-02');
});

test('the sheet is not read back as mistakes and the service keeps working', async () => {
  const service = at('2026-11-01');
  await service.submitAnswer({ questionId: 'q1', choice: 0 });
  await service.exportMistakeSheet!({ workspaceId: 'kaoyan' });

  const raw = await fs.readFile(
    join(root, 'workspaces', 'kaoyan', 'practice', 'mistakes.md'),
    'utf8'
  );
  expect(parseMistakesFile(raw)).toHaveLength(1);

  // A fresh service instance must ignore the sheet when it reads the vault.
  const fresh = at('2026-11-01');
  expect(await fresh.getMistakes('kaoyan')).toHaveLength(1);
  expect(await fresh.exportMistakeSheet!({ workspaceId: 'kaoyan' })).toMatchObject({ count: 1 });
});

test('the sheet frontmatter matches the vault note serialization', async () => {
  await at('2026-11-01').submitAnswer({ questionId: 'q1', choice: 0 });
  const result = await at('2026-11-01').exportMistakeSheet!({ workspaceId: 'kaoyan' });
  const raw = await fs.readFile(join(root, result.path), 'utf8');

  const frontmatter = raw.slice(0, raw.indexOf('\n---\n') + 5);
  const body = raw.slice(frontmatter.length);
  expect(frontmatter).toBe(
    serializeNote(
      {
        type: 'qa',
        source: 'user',
        kind: 'practice-review-sheet',
        workspaceId: 'kaoyan',
        generated: '2026-11-01',
        entries: 1
      },
      body
    ).slice(0, raw.indexOf('\n---\n') + 5)
  );
  // The title is the only heading before the per-mistake sections.
  expect(body.startsWith('# 错题复习单 · 2026-11-01\n\n## 1.')).toBe(true);
});

test('rejects invalid review-sheet requests', async () => {
  const service = at('2026-11-01');
  await expect(service.exportMistakeSheet!({ workspaceId: '' })).rejects.toThrow(
    'workspace id is required'
  );
  await expect(service.exportMistakeSheet!({ workspaceId: '../escape' })).rejects.toThrow(
    'Invalid workspace id'
  );
});

// --- Short answer (free recall) -------------------------------------------

const shortQuestion = {
  kind: 'short' as const,
  prompt: '用自己的话说明第一个重要极限。',
  referenceAnswer: 'x→0 时 sin x / x 的极限是 1。',
  explanation: '夹逼准则可证。'
};

test('createSet accepts short questions and round-trips them through the vault', async () => {
  const service = at('2026-11-01');
  const created = await service.createSet({
    workspaceId: 'kaoyan',
    title: '简答小测',
    questions: [
      shortQuestion,
      { prompt: '矩阵可逆的条件？', options: ['|A| = 0', '|A| ≠ 0'], answer: 1 }
    ]
  });

  expect(created.questions[0]).toMatchObject({
    kind: 'short',
    prompt: shortQuestion.prompt,
    referenceAnswer: shortQuestion.referenceAnswer,
    options: [],
    answer: 0
  });
  // Choice questions carry no `kind`, so older readers see the same shape.
  expect(created.questions[1]?.kind).toBeUndefined();

  const loaded = await at('2026-11-02').getSet(created.id);
  expect(loaded?.questions[0]).toMatchObject({
    kind: 'short',
    referenceAnswer: shortQuestion.referenceAnswer,
    options: [],
    answer: 0
  });
  expect(loaded?.questions[1]?.kind).toBeUndefined();

  const raw = await fs.readFile(
    join(root, 'workspaces', 'kaoyan', 'practice', 'sets', `${created.id}.md`),
    'utf8'
  );
  expect(raw).toContain('kind: short');
  expect(raw).toContain('referenceAnswer:');
  expect(raw).toContain('**参考答案**：');
});

test('short questions without a reference answer are rejected', async () => {
  const service = at('2026-11-01');
  await expect(
    service.createSet({
      workspaceId: 'kaoyan',
      title: '坏简答',
      questions: [{ kind: 'short', prompt: '没有参考答案' }]
    })
  ).rejects.toThrow('referenceAnswer is required');
  await expect(
    service.createSet({
      workspaceId: 'kaoyan',
      title: '空简答',
      questions: [{ kind: 'short', prompt: '空参考答案', referenceAnswer: '   ' }]
    })
  ).rejects.toThrow('referenceAnswer is required');
  await expect(
    service.createSet({
      workspaceId: 'kaoyan',
      title: '怪题型',
      questions: [
        { kind: 'essay', prompt: '题', options: ['A', 'B'], answer: 0 } as unknown as CreatePracticeQuestionInput
      ]
    })
  ).rejects.toThrow('kind is invalid');
});

test('submitShortAnswer records the response and a mistake through the scheduler', async () => {
  const service = at('2026-11-01');
  const created = await service.createSet({
    workspaceId: 'kaoyan',
    title: '简答小测',
    questions: [shortQuestion]
  });
  const questionId = created.questions[0]!.id;

  const wrong = await service.submitShortAnswer({
    questionId,
    response: '  极限不存在  ',
    selfCorrect: false
  });
  expect(wrong).toMatchObject({ questionId, correct: false, choice: 0, answer: 0 });
  expect(wrong.attempt).toMatchObject({
    questionId,
    choice: 0,
    response: '  极限不存在  ',
    correct: false
  });
  expect(wrong.mistake).toMatchObject({
    questionId,
    kind: 'short',
    referenceAnswer: shortQuestion.referenceAnswer,
    options: [],
    wrongCount: 1,
    intervalDays: 1,
    due: '2026-11-02',
    status: 'active'
  });
  expect(wrong.due).toBe('2026-11-02');

  // The attempt file keeps the typed answer and the mistake book keeps the
  // snapshot needed to review it later.
  const attemptRaw = await fs.readFile(
    join(root, 'workspaces', 'kaoyan', 'practice', 'attempts', '2026-11-01.md'),
    'utf8'
  );
  expect(attemptRaw).toContain('简答「极限不存在」');
  const mistakesRaw = await fs.readFile(
    join(root, 'workspaces', 'kaoyan', 'practice', 'mistakes.md'),
    'utf8'
  );
  expect(parseMistakesFile(mistakesRaw)[0]).toMatchObject({
    kind: 'short',
    referenceAnswer: shortQuestion.referenceAnswer
  });

  // A correct self-assessment on a later day grows the interval.
  const right = await at('2026-11-02').submitShortAnswer({
    questionId,
    response: '极限是 1',
    selfCorrect: true
  });
  expect(right.mistake).toMatchObject({
    status: 'active',
    correctStreak: 1,
    intervalDays: 2,
    due: '2026-11-04'
  });
  expect(right.due).toBe('2026-11-04');
});

test('a short mistake resolves after a spaced correct self-assessment', async () => {
  const service = at('2026-11-01');
  const created = await service.createSet({
    workspaceId: 'kaoyan',
    title: '简答小测',
    questions: [shortQuestion]
  });
  const questionId = created.questions[0]!.id;
  await service.submitShortAnswer({ questionId, response: '不知道', selfCorrect: false });

  const one = await at('2026-11-02').submitShortAnswer({
    questionId,
    response: '极限是 1',
    selfCorrect: true
  });
  const two = await at(one.mistake!.due).submitShortAnswer({
    questionId,
    response: '极限是 1',
    selfCorrect: true
  });
  const three = await at(two.mistake!.due).submitShortAnswer({
    questionId,
    response: '极限是 1',
    selfCorrect: true
  });

  expect(three.mistake).toMatchObject({ status: 'resolved' });
  expect(await at('2026-12-01').getMistakes('kaoyan')).toEqual([]);
});

test('submitShortAnswer validates its input and refuses choice questions', async () => {
  const service = at('2026-11-01');
  const created = await service.createSet({
    workspaceId: 'kaoyan',
    title: '混合',
    questions: [
      shortQuestion,
      { prompt: '选择题', options: ['A', 'B'], answer: 0 }
    ]
  });
  const shortId = created.questions[0]!.id;
  const choiceId = created.questions[1]!.id;

  await expect(
    service.submitShortAnswer({ questionId: shortId, response: '   ', selfCorrect: true })
  ).rejects.toThrow('response is required');
  await expect(
    service.submitShortAnswer({
      questionId: shortId,
      response: '答',
      selfCorrect: 'yes' as unknown as boolean
    })
  ).rejects.toThrow('selfCorrect is required');
  await expect(
    service.submitShortAnswer({ questionId: choiceId, response: '答', selfCorrect: true })
  ).rejects.toThrow('not a short question');
  await expect(
    service.submitShortAnswer({ questionId: 'missing', response: '答', selfCorrect: true })
  ).rejects.toThrow('Question not found');
});

test('choice questions reject a short answer and keep their own flow', async () => {
  const service = at('2026-11-01');
  const choice = await service.submitAnswer({ questionId: 'q1', choice: 1 });
  expect(choice).toMatchObject({ choice: 1, correct: true, mistake: null });
  expect(choice.attempt.response).toBeUndefined();
});

test('short mistakes can be reviewed from their stored snapshot', async () => {
  const service = at('2026-11-01');
  const created = await service.createSet({
    workspaceId: 'kaoyan',
    title: '简答小测',
    questions: [shortQuestion]
  });
  const first = await service.submitShortAnswer({
    questionId: created.questions[0]!.id,
    response: '不知道',
    selfCorrect: false
  });
  const mistakeId = first.mistake!.id;

  // Deleting the set must not break the review: the snapshot has everything.
  await service.deleteSet?.({ setId: created.id });

  const reviewed = await at('2026-11-02').reviewMistake!({
    mistakeId,
    response: '极限是 1',
    selfCorrect: true
  });
  expect(reviewed.correct).toBe(true);
  expect(reviewed.attempt.response).toBe('极限是 1');
  expect(reviewed.mistake).toMatchObject({
    id: mistakeId,
    kind: 'short',
    correctStreak: 1,
    intervalDays: 2
  });

  await expect(
    at('2026-11-02').reviewMistake!({ mistakeId, choice: 0 })
  ).rejects.toThrow('response is required');
});

test('exports a review sheet that shows 参考答案 for short mistakes', async () => {
  const service = at('2026-11-01');
  const created = await service.createSet({
    workspaceId: 'kaoyan',
    title: '简答小测',
    questions: [shortQuestion]
  });
  await service.submitShortAnswer({
    questionId: created.questions[0]!.id,
    response: '不知道',
    selfCorrect: false
  });
  const result = await service.exportMistakeSheet!({ workspaceId: 'kaoyan' });
  const raw = await fs.readFile(join(root, result.path), 'utf8');
  expect(raw).toContain(`参考答案：${shortQuestion.referenceAnswer}`);
  expect(raw).not.toContain('答案：A');
  expect(raw).toContain('# 错题复习单 · 2026-11-01');
  expect(raw).toContain('entries: 1');
});

// --- Confidence calibration -----------------------------------------------

test('records confidence on an attempt and serializes it only when present', async () => {
  const service = at('2026-11-01');
  await service.submitAnswer({ questionId: 'q1', choice: 0, confidence: 'sure' });
  await service.submitAnswer({ questionId: 'p2', choice: 0, confidence: 'unsure' });
  await service.submitAnswer({ questionId: 'q2', choice: 2 });

  const attempts = await service.listAttempts('kaoyan');
  // Same clock for all three, so look them up by question id rather than time.
  const byQuestion = new Map(attempts.map((attempt) => [attempt.questionId, attempt.confidence]));
  expect(byQuestion).toEqual(
    new Map<string, string | undefined>([
      ['q1', 'sure'],
      ['p2', 'unsure'],
      ['q2', undefined]
    ])
  );

  const raw = await fs.readFile(
    join(root, 'workspaces', 'kaoyan', 'practice', 'attempts', '2026-11-01.md'),
    'utf8'
  );
  expect(raw).toContain('confidence: sure');
  expect(raw).toContain('confidence: unsure');
  expect(raw).toContain('· 有把握 · ❌');
  expect(raw).toContain('· 不确定 · ❌');
  // The unmarked attempt keeps the pre-feature shape.
  expect(raw).toContain('选择 2 · ✅');
  expect(raw).not.toContain('选择 2 · 有把握');
  // All three share one clock, so only the content is comparable, not order.
  const parsed = parseAttemptFile(raw);
  expect(parsed).toHaveLength(3);
  expect(
    new Map(parsed.map((attempt) => [attempt.questionId, attempt.confidence]))
  ).toEqual(new Map(attempts.map((attempt) => [attempt.questionId, attempt.confidence])));
});

test('confident attempts round-trip byte-identically', () => {
  const marked: PracticeAttempt[] = [
    {
      id: 'pa1',
      workspaceId: 'kaoyan',
      setId: 'ps1',
      questionId: 'q1',
      choice: 1,
      confidence: 'sure',
      correct: true,
      answeredAt: '2026-11-01T09:05:00.000Z'
    },
    {
      id: 'pa2',
      workspaceId: 'kaoyan',
      setId: 'ps1',
      questionId: 'q2',
      choice: 0,
      response: '极限是 1',
      confidence: 'unsure',
      correct: false,
      answeredAt: '2026-11-01T09:10:00.000Z'
    }
  ];
  const serialized = serializeAttemptFile('2026-11-01', marked);
  expect(serialized).toContain('选择 1 · 有把握 · ✅');
  expect(serialized).toContain('简答「极限是 1」 · 不确定 · ❌');
  expect(parseAttemptFile(serialized)).toEqual(marked);
  expect(serializeAttemptFile('2026-11-01', parseAttemptFile(serialized))).toBe(serialized);
});

test('a stray confidence value in a hand-edited log is dropped, not fatal', () => {
  const raw = serializeNote(
    {
      type: 'log',
      source: 'user',
      kind: 'practice-attempts',
      date: '2026-11-01',
      entries: [
        {
          id: 'pa1',
          workspaceId: 'kaoyan',
          setId: 'ps1',
          questionId: 'q1',
          choice: 1,
          confidence: 'maybe',
          correct: true,
          answeredAt: '2026-11-01T09:05:00.000Z'
        }
      ]
    },
    '# 2026-11-01 练习记录\n'
  );
  const parsed = parseAttemptFile(raw);
  expect(parsed).toHaveLength(1);
  expect(parsed[0]?.confidence).toBeUndefined();
  expect(parsed[0]?.correct).toBe(true);
});

test('attempt files without confidence round-trip byte-identically', () => {
  const legacy: PracticeAttempt = {
    id: 'pa1',
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: 'q1',
    choice: 1,
    correct: true,
    answeredAt: '2026-11-01T09:05:00.000Z'
  };
  const serialized = serializeAttemptFile('2026-11-01', [legacy]);
  expect(serialized).not.toContain('confidence');
  expect(serialized).not.toContain('有把握');
  expect(serialized).not.toContain('不确定');
  expect(parseAttemptFile(serialized)).toEqual([legacy]);
  expect(serializeAttemptFile('2026-11-01', parseAttemptFile(serialized))).toBe(serialized);
});

test('a sure wrong answer raises difficulty by the extra step, unsure does not', async () => {
  // Mistakes are keyed by question id, so each question is its own fresh record
  // and all three start from the same migrated difficulty.
  async function firstDifficulty(
    questionId: string,
    confidence?: 'sure' | 'unsure'
  ): Promise<number | undefined> {
    const result = await at('2026-11-01').submitAnswer({
      questionId,
      choice: 0,
      ...(confidence !== undefined ? { confidence } : {})
    });
    expect(result.correct).toBe(false);
    return result.mistake?.difficulty;
  }

  const plain = await firstDifficulty('q1');
  const unsure = await firstDifficulty('q2', 'unsure');
  const sure = await firstDifficulty('q3', 'sure');

  // A first mistake starts at 0.3 (priority 0 migration) + 0.1 = 0.4.
  expect(plain).toBeCloseTo(0.4, 5);
  expect(unsure).toBeCloseTo(0.4, 5);
  expect(sure).toBeCloseTo(0.45, 5);
});

test('confidence never changes a correct answer, and is recorded on the attempt', async () => {
  const service = at('2026-11-01');
  await service.submitAnswer({ questionId: 'q1', choice: 0 });
  const correct = await at('2026-11-02').submitAnswer({
    questionId: 'q1',
    choice: 1,
    confidence: 'sure'
  });

  expect(correct.correct).toBe(true);
  expect(correct.mistake?.difficulty).toBeCloseTo(0.35, 5);
  expect(correct.attempt.confidence).toBe('sure');
});

test('the short-answer path records confidence and feeds it to the scheduler', async () => {
  const service = at('2026-11-01');
  const created = await service.createSet({
    workspaceId: 'kaoyan',
    title: '简答小测',
    questions: [shortQuestion]
  });
  const questionId = created.questions[0]!.id;

  const wrong = await service.submitShortAnswer({
    questionId,
    response: '不知道',
    selfCorrect: false,
    confidence: 'sure'
  });
  expect(wrong.attempt.confidence).toBe('sure');
  expect(wrong.mistake?.difficulty).toBeCloseTo(0.45, 5);

  const reviewed = await at('2026-11-02').reviewMistake!({
    mistakeId: wrong.mistake!.id,
    response: '极限是 1',
    selfCorrect: true,
    confidence: 'unsure'
  });
  expect(reviewed.attempt.confidence).toBe('unsure');
});

test('reviewMistake passes confidence through to scheduling and the attempt', async () => {
  const service = at('2026-11-01');
  const first = await service.submitAnswer({ questionId: 'q1', choice: 0 });
  expect(first.mistake?.difficulty).toBeCloseTo(0.4, 5);

  const reviewed = await at('2026-11-02').reviewMistake!({
    mistakeId: first.mistake!.id,
    choice: 0,
    confidence: 'sure'
  });
  expect(reviewed.attempt.confidence).toBe('sure');
  expect(reviewed.mistake?.difficulty).toBeCloseTo(0.55, 5);
});

test('rejects an unknown confidence value', async () => {
  const service = at('2026-11-01');
  await expect(
    service.submitAnswer({
      questionId: 'q1',
      choice: 1,
      confidence: 'certain' as unknown as 'sure'
    })
  ).rejects.toThrow('Invalid confidence');
  await expect(
    service.submitShortAnswer({
      questionId: 'q1',
      response: '答',
      selfCorrect: true,
      confidence: 'maybe' as unknown as 'sure'
    })
  ).rejects.toThrow('Invalid confidence');
});

/** A service whose opt-in stricter-mastery setting is pinned on. */
function strictAt(date: string) {
  return createPracticeService(root, {
    now: () => new Date(`${date}T09:00:00`),
    strictMastery: () => true
  });
}

test('strict mode withholds mastery for a spaced correct choice answer but still grows the interval', async () => {
  await at('2026-11-01').submitAnswer({ questionId: 'q1', choice: 0 });

  const one = await at('2026-11-02').submitAnswer({ questionId: 'q1', choice: 1 });
  expect(one.mistake).toMatchObject({ status: 'active' });
  const two = await strictAt(one.mistake!.due).submitAnswer({ questionId: 'q1', choice: 1 });
  const three = await strictAt(two.mistake!.due).submitAnswer({ questionId: 'q1', choice: 1 });

  // A loose workspace would have resolved this by the spaced answer; strict
  // keeps it active. Every interval still grew and due moved forward.
  expect(two.mistake!.status).toBe('active');
  expect(three.mistake!.status).toBe('active');
  expect(two.mistake!.intervalDays).toBeGreaterThan(one.mistake!.intervalDays);
  expect(three.mistake!.intervalDays).toBeGreaterThan(two.mistake!.intervalDays);
  expect((await strictAt('2026-12-01').getMistakes('kaoyan')).map((m) => m.questionId)).toEqual([
    'q1'
  ]);
});

test('strict mode resolves a spaced correct short answer exactly as the default', async () => {
  const created = await at('2026-11-01').createSet({
    workspaceId: 'kaoyan',
    title: '简答小测',
    questions: [shortQuestion]
  });
  const questionId = created.questions[0]!.id;
  await strictAt('2026-11-01').submitShortAnswer({
    questionId,
    response: '不知道',
    selfCorrect: false
  });

  const one = await strictAt('2026-11-02').submitShortAnswer({
    questionId,
    response: '极限是 1',
    selfCorrect: true
  });
  const two = await strictAt(one.mistake!.due).submitShortAnswer({
    questionId,
    response: '极限是 1',
    selfCorrect: true
  });
  const three = await strictAt(two.mistake!.due).submitShortAnswer({
    questionId,
    response: '极限是 1',
    selfCorrect: true
  });

  expect(three.mistake).toMatchObject({ status: 'resolved' });
});

test('strict mode never changes a wrong answer', async () => {
  const isolated = await mkdtemp(join(tmpdir(), 'practice-strict-wrong-'));
  try {
    for (const id of ['kaoyan', 'english']) {
      await fs.mkdir(join(isolated, 'workspaces', id), { recursive: true });
    }
    // The same wrong answer in two otherwise-identical vaults: the strict
    // record must equal the non-strict one field for field.
    const loose = await at('2026-11-01').submitAnswer({ questionId: 'q1', choice: 0 });
    const strictWrong = await createPracticeService(isolated, {
      now: () => new Date('2026-11-01T09:00:00'),
      strictMastery: () => true
    }).submitAnswer({ questionId: 'q1', choice: 0 });
    expect(strictWrong.mistake).toMatchObject({
      intervalDays: loose.mistake!.intervalDays,
      due: loose.mistake!.due,
      difficulty: loose.mistake!.difficulty,
      stabilityDays: loose.mistake!.stabilityDays,
      status: 'active',
      wrongCount: 1
    });
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
});

test('default (strict off) keeps the pre-existing resolve behaviour byte-for-byte', async () => {
  const isolated = await mkdtemp(join(tmpdir(), 'practice-strict-default-'));
  try {
    for (const id of ['kaoyan', 'english']) {
      await fs.mkdir(join(isolated, 'workspaces', id), { recursive: true });
    }
    // Drive the same date-stepped sequence against a vault with no flag and one
    // whose flag is explicitly off; the mistake-book files must be identical.
    async function resolveRun(dir: string, strict?: () => boolean) {
      for (const [date, choice] of [
        ['2026-11-01', 0],
        ['2026-11-02', 1],
        ['2026-11-04', 1],
        ['2026-11-07', 1]
      ] as const) {
        const month = Number(date.slice(5, 7));
        const day = Number(date.slice(8, 10));
        await createPracticeService(dir, {
          now: () => new Date(2026, month - 1, day, 9, 0, 0),
          ...(strict ? { strictMastery: strict } : {})
        }).submitAnswer({ questionId: 'q1', choice });
      }
      return fs.readFile(join(dir, 'workspaces', 'kaoyan', 'practice', 'mistakes.md'), 'utf8');
    }

    // Record ids are generated randomly, so normalise them before comparing.
    const withoutIds = (raw: string) => raw.replace(/pm-[0-9a-f]+/g, 'pm-ID');
    const implicit = await resolveRun(root);
    const explicitOff = await resolveRun(isolated, () => false);
    expect(withoutIds(explicitOff)).toBe(withoutIds(implicit));
    expect(implicit).toContain('已掌握');
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
});

test('the review sheet states the strict clause only when the setting is on', async () => {
  await at('2026-11-01').submitAnswer({ questionId: 'q1', choice: 0 });
  const loose = await at('2026-11-01').exportMistakeSheet!({ workspaceId: 'kaoyan' });
  const looseRaw = await fs.readFile(join(root, loose.path), 'utf8');
  expect(looseRaw).not.toContain('更严判定');

  await strictAt('2026-11-01').submitAnswer({ questionId: 'p2', choice: 0 });
  const strict = await strictAt('2026-11-01').exportMistakeSheet!({ workspaceId: 'kaoyan' });
  const strictRaw = await fs.readFile(join(root, strict.path), 'utf8');
  expect(strictRaw).toContain('更严判定生效中：需要简答题复证');
  // The strict note lives under the title, before the first entry.
  expect(strictRaw.indexOf('更严判定生效中')).toBeLessThan(strictRaw.indexOf('## 1.'));
});

test('the strict flag is read at answer time, so toggling it applies without a rebuild', async () => {
  let strict = false;
  const service = createPracticeService(root, {
    now: () => new Date('2026-11-01T09:00:00'),
    strictMastery: () => strict
  });
  await service.submitAnswer({ questionId: 'q1', choice: 0 });

  // Answer correctly on a spaced later day while the flag is still off.
  const now = (date: string) =>
    createPracticeService(root, {
      now: () => new Date(`${date}T09:00:00`),
      strictMastery: () => strict
    });
  const one = await now('2026-11-02').submitAnswer({ questionId: 'q1', choice: 1 });
  // Flip the flag on before the spaced answer; it must take effect immediately.
  strict = true;
  const two = await now(one.mistake!.due).submitAnswer({ questionId: 'q1', choice: 1 });
  expect(two.mistake!.status).toBe('active');
  expect(two.mistake!.intervalDays).toBeGreaterThan(one.mistake!.intervalDays);
});
