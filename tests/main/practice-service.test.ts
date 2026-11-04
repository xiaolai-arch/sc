import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPracticeService } from '../../src/main/practice';

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

test('repeated wrong answers advance the 1/3/7 day schedule', async () => {
  const first = await at('2026-11-01').submitAnswer({ questionId: 'q1', choice: 0 });
  expect(first.mistake).toMatchObject({ intervalDays: 1, due: '2026-11-02', wrongCount: 1 });
  const mistakeId = first.mistake?.id;

  const second = await at('2026-11-02').submitAnswer({ questionId: 'q1', choice: 0 });
  expect(second.mistake).toMatchObject({
    id: mistakeId,
    intervalDays: 3,
    due: '2026-11-05',
    wrongCount: 2,
    priority: 2
  });

  const third = await at('2026-11-05').submitAnswer({ questionId: 'q1', choice: 0 });
  expect(third.mistake).toMatchObject({
    id: mistakeId,
    intervalDays: 7,
    due: '2026-11-12',
    wrongCount: 3,
    priority: 3
  });

  const fourth = await at('2026-11-12').submitAnswer({ questionId: 'q1', choice: 0 });
  expect(fourth.mistake).toMatchObject({
    intervalDays: 7,
    due: '2026-11-19',
    wrongCount: 4,
    priority: 3
  });
});

test('correct answers lower priority and resolve after a two-answer streak', async () => {
  await at('2026-11-01').submitAnswer({ questionId: 'q1', choice: 0 });
  await at('2026-11-02').submitAnswer({ questionId: 'q1', choice: 0 });
  expect((await at('2026-11-02').getMistakes('kaoyan'))[0]?.priority).toBe(2);

  const firstCorrect = await at('2026-11-05').submitAnswer({ questionId: 'q1', choice: 1 });
  expect(firstCorrect.correct).toBe(true);
  expect(firstCorrect.mistake).toMatchObject({ priority: 1, status: 'active', correctStreak: 1 });
  expect((await at('2026-11-05').getMistakes('kaoyan'))[0]?.priority).toBe(1);

  const secondCorrect = await at('2026-11-05').submitAnswer({ questionId: 'q1', choice: 1 });
  expect(secondCorrect.mistake).toMatchObject({ status: 'resolved', correctStreak: 2 });
  expect(await at('2026-11-05').getMistakes('kaoyan')).toEqual([]);
  expect(await at('2026-11-05').getDue('kaoyan', '2026-12-01')).toEqual([]);
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
    intervalDays: 3,
    due: '2026-11-05',
    status: 'active'
  });
  expect(await at('2026-11-02').getDue('kaoyan', '2026-11-05')).toHaveLength(1);
  const attempts = await at('2026-11-02').listAttempts('kaoyan');
  expect(attempts.at(-1)).toMatchObject({ questionId: 'q1', correct: false, setId: 'ps1' });
});

test('two correct mistake reviews resolve it', async () => {
  const first = await at('2026-11-01').submitAnswer({ questionId: 'q1', choice: 0 });
  const mistakeId = first.mistake?.id ?? '';

  const correct = await at('2026-11-02').reviewMistake!({ mistakeId, choice: 1 });
  expect(correct.correct).toBe(true);
  expect(correct.mistake).toMatchObject({ status: 'active', correctStreak: 1, priority: 0 });

  const resolved = await at('2026-11-02').reviewMistake!({ mistakeId, choice: 1 });
  expect(resolved.mistake).toMatchObject({ status: 'resolved', correctStreak: 2 });
  expect(await at('2026-11-02').getMistakes('kaoyan')).toEqual([]);
  expect(await at('2026-11-02').getDue('kaoyan', '2026-12-01')).toEqual([]);
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
