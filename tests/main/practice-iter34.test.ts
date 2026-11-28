/**
 * iter34 P0 — 错因一行 / 顽疾可见 / 可逆归档.
 *
 * Everything here goes through the real vault services against a temporary
 * workspace, so the 顽疾 sequence is built from real submits (never a hand-made
 * fixture) and the stored files are asserted directly.
 */
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPracticeService } from '../../src/main/practice';
import { parseMistakesFile } from '../../src/main/practice/records';
import { isStubbornMistake } from '../../src/shared/practice';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'practice-iter34-'));
  await fs.mkdir(join(root, 'workspaces', 'kaoyan'), { recursive: true });
  await fs.mkdir(join(root, 'workspaces', 'english'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function at(date: string) {
  return createPracticeService(root, { now: () => new Date(`${date}T09:00:00`) });
}

const mistakesPath = () => join(root, 'workspaces', 'kaoyan', 'practice', 'mistakes.md');
const archivePath = () => join(root, 'workspaces', 'kaoyan', 'practice', 'mistakes-archive.md');

test('setMistakeCause trims and persists the cause onto mistakes.md', async () => {
  const service = at('2026-11-01');
  const first = await service.submitAnswer({ questionId: 'q1', choice: 0 });
  const updated = await service.setMistakeCause!({
    mistakeId: first.mistake!.id,
    cause: '  洛必达前没确认导函数极限存在  '
  });
  expect(updated.cause).toBe('洛必达前没确认导函数极限存在');

  const raw = await fs.readFile(mistakesPath(), 'utf8');
  expect(raw).toContain('cause: 洛必达前没确认导函数极限存在');
  expect(parseMistakesFile(raw)[0]?.cause).toBe('洛必达前没确认导函数极限存在');
  // The rest of the record is untouched.
  expect(parseMistakesFile(raw)[0]).toMatchObject({ wrongCount: 1, priority: 1 });
});

test('a blank cause is 未填: no field is written and the sheet stays byte-identical', async () => {
  const service = at('2026-11-01');
  const first = await service.submitAnswer({ questionId: 'q1', choice: 0 });
  const baseline = await service.exportMistakeSheet!({ workspaceId: 'kaoyan' });
  const baselineRaw = await fs.readFile(join(root, baseline.path), 'utf8');

  for (const blank of ['', '   ', '\n\t ']) {
    const updated = await service.setMistakeCause!({ mistakeId: first.mistake!.id, cause: blank });
    expect(updated.cause).toBeUndefined();
  }
  const raw = await fs.readFile(mistakesPath(), 'utf8');
  expect(raw).not.toContain('cause:');
  expect(parseMistakesFile(raw)[0]?.cause).toBeUndefined();

  const after = await at('2026-11-01').exportMistakeSheet!({ workspaceId: 'kaoyan' });
  expect(await fs.readFile(join(root, after.path), 'utf8')).toBe(baselineRaw);
});

test('a 45-code-point cause truncates to 40 with no ellipsis; exactly 40 stays', async () => {
  const service = at('2026-11-01');
  const first = await service.submitAnswer({ questionId: 'q1', choice: 0 });

  const tooLong = '一二三四五六七八九十'.repeat(4) + '甲乙丙丁戊'; // 45 code points
  expect(Array.from(tooLong)).toHaveLength(45);
  const trimmed = await service.setMistakeCause!({ mistakeId: first.mistake!.id, cause: tooLong });
  expect(Array.from(trimmed.cause!)).toHaveLength(40);
  expect(trimmed.cause).toBe(Array.from(tooLong).slice(0, 40).join(''));
  expect(trimmed.cause).not.toContain('…');

  const exact = '一二三四五六七八九十'.repeat(4); // exactly 40
  const kept = await service.setMistakeCause!({ mistakeId: first.mistake!.id, cause: exact });
  expect(kept.cause).toBe(exact);
});

test('cause counts surrogate pairs as one code point', async () => {
  const service = at('2026-11-01');
  const first = await service.submitAnswer({ questionId: 'q1', choice: 0 });
  // 41 emoji: each is one code point (two UTF-16 units). A 40-point cut must
  // drop exactly one emoji and never split a pair.
  const emoji = '😀'.repeat(41);
  const updated = await service.setMistakeCause!({ mistakeId: first.mistake!.id, cause: emoji });
  expect(Array.from(updated.cause!)).toHaveLength(40);
  expect(updated.cause).not.toContain('�');
});

test('a wrong answer keeps the existing cause', async () => {
  const service = at('2026-11-01');
  const first = await service.submitAnswer({ questionId: 'q1', choice: 0 });
  await service.setMistakeCause!({ mistakeId: first.mistake!.id, cause: '导数链没拆完' });
  const again = await at('2026-11-02').submitAnswer({ questionId: 'q1', choice: 0 });
  expect(again.mistake).toMatchObject({ cause: '导数链没拆完', wrongCount: 2 });
});

test('顽疾: the real submit sequence drives the counts and the data is untouched', async () => {
  // 错 → 错 → 对 → 对 → 错, each через the real submit path; every step's stored
  // record must equal what the pre-existing scheduler produces (regression), so
  // the mark is purely a render condition.
  const steps = [
    { date: '2026-11-01', choice: 0, wrong: 1, streak: 0, stubborn: false },
    { date: '2026-11-02', choice: 0, wrong: 2, streak: 0, stubborn: true },
    { date: '2026-11-03', choice: 1, wrong: 2, streak: 1, stubborn: true },
    { date: '2026-11-04', choice: 1, wrong: 2, streak: 2, stubborn: false },
    { date: '2026-11-05', choice: 0, wrong: 3, streak: 0, stubborn: true }
  ] as const;
  let previousPriority = 0;
  for (const step of steps) {
    const result = await at(step.date).submitAnswer({ questionId: 'q1', choice: step.choice });
    const expectedPriority =
      step.choice === 1 ? Math.max(0, previousPriority - 1) : Math.min(3, previousPriority + 1);
    previousPriority = expectedPriority;
    expect(result.mistake).toMatchObject({
      wrongCount: step.wrong,
      correctStreak: step.streak,
      priority: expectedPriority
    });
    expect(isStubbornMistake(result.mistake!)).toBe(step.stubborn);

    // The vault file agrees with the returned record at every step.
    const stored = parseMistakesFile(await fs.readFile(mistakesPath(), 'utf8'))[0]!;
    expect(stored).toMatchObject({
      wrongCount: step.wrong,
      correctStreak: step.streak,
      priority: expectedPriority
    });
  }
});

test('顽疾 is decided only by wrongCount and correctStreak, never by priority', () => {
  // `priority=3, wrongCount=1` and `priority=0, wrongCount=2` are both
  // constructible; the mark follows the latter pair only.
  expect(isStubbornMistake({ wrongCount: 1, correctStreak: 0 })).toBe(false);
  expect(isStubbornMistake({ wrongCount: 2, correctStreak: 0 })).toBe(true);
  expect(isStubbornMistake({ wrongCount: 2, correctStreak: 2 })).toBe(false);
  expect(isStubbornMistake({ wrongCount: 5, correctStreak: 2 })).toBe(false);
});

test('清空已掌握 moves resolved mistakes to the archive with every field plus archivedAt', async () => {
  const service = at('2026-11-01');
  const wrong = await service.submitAnswer({ questionId: 'q1', choice: 0 });
  await service.submitAnswer({ questionId: 'p2', choice: 0 });
  const mistakeId = wrong.mistake!.id;
  await service.setMistakeCause!({ mistakeId, cause: '概念没掌握' });
  await service.setMistakeResolved!({ mistakeId, resolved: true });
  const before = parseMistakesFile(await fs.readFile(mistakesPath(), 'utf8'));
  const resolvedRecord = before.find((entry) => entry.id === mistakeId)!;

  const result = await at('2026-11-05').archiveResolvedMistakes!({ workspaceId: 'kaoyan' });
  expect(result.archived).toBe(1);
  expect(result.path).toBe('workspaces/kaoyan/practice/mistakes-archive.md');

  const archived = parseMistakesFile(await fs.readFile(archivePath(), 'utf8'));
  expect(archived).toHaveLength(1);
  expect(archived[0]).toEqual({ ...resolvedRecord, archivedAt: '2026-11-05' });
  expect(archived[0]?.cause).toBe('概念没掌握');
  expect(archived[0]?.status).toBe('resolved');

  // mistakes.md keeps only the active record.
  const remaining = parseMistakesFile(await fs.readFile(mistakesPath(), 'utf8'));
  expect(remaining.map((entry) => entry.id)).not.toContain(mistakeId);
  expect(remaining.every((entry) => entry.status === 'active')).toBe(true);
});

test('archiving twice is idempotent: no duplicate ids, first archivedAt kept', async () => {
  const service = at('2026-11-01');
  const wrong = await service.submitAnswer({ questionId: 'q1', choice: 0 });
  await service.setMistakeResolved!({ mistakeId: wrong.mistake!.id, resolved: true });

  const first = await at('2026-11-02').archiveResolvedMistakes!({ workspaceId: 'kaoyan' });
  expect(first.archived).toBe(1);
  const second = await at('2026-11-03').archiveResolvedMistakes!({ workspaceId: 'kaoyan' });
  expect(second.archived).toBe(0);

  const archived = parseMistakesFile(await fs.readFile(archivePath(), 'utf8'));
  expect(archived).toHaveLength(1);
  expect(archived[0]?.archivedAt).toBe('2026-11-02');
});

test('the archive file is created with frontmatter when it does not exist', async () => {
  const service = at('2026-11-01');
  await fs.rm(archivePath(), { force: true });
  const wrong = await service.submitAnswer({ questionId: 'q1', choice: 0 });
  await service.setMistakeResolved!({ mistakeId: wrong.mistake!.id, resolved: true });
  await service.archiveResolvedMistakes!({ workspaceId: 'kaoyan' });

  const raw = await fs.readFile(archivePath(), 'utf8');
  expect(raw.startsWith('---\n')).toBe(true);
  expect(raw).toContain('kind: practice-mistakes');
  expect(raw).toContain('workspaceId: kaoyan');
});

test('a blank archive produces no file and reports zero archived', async () => {
  const service = at('2026-11-01');
  await service.submitAnswer({ questionId: 'q1', choice: 0 }); // active, not resolved
  const result = await service.archiveResolvedMistakes!({ workspaceId: 'kaoyan' });
  expect(result.archived).toBe(0);
  await expect(fs.stat(archivePath())).rejects.toMatchObject({ code: 'ENOENT' });
});

test('从归档恢复 moves the record back to mistakes.md, still resolved', async () => {
  const service = at('2026-11-01');
  const wrong = await service.submitAnswer({ questionId: 'q1', choice: 0 });
  const mistakeId = wrong.mistake!.id;
  await service.setMistakeResolved!({ mistakeId, resolved: true });
  await at('2026-11-02').archiveResolvedMistakes!({ workspaceId: 'kaoyan' });

  const list = await at('2026-11-02').listArchivedMistakes!('kaoyan');
  expect(list.map((entry) => entry.id)).toEqual([mistakeId]);
  expect(list[0]?.archivedAt).toBe('2026-11-02');

  const restored = await at('2026-11-03').restoreArchivedMistake!({ mistakeId });
  expect(restored).toMatchObject({ id: mistakeId, status: 'resolved' });
  expect(restored.archivedAt).toBeUndefined();

  // Back in mistakes.md as resolved; gone from the archive.
  const back = parseMistakesFile(await fs.readFile(mistakesPath(), 'utf8'));
  expect(back.find((entry) => entry.id === mistakeId)?.status).toBe('resolved');
  const archive = parseMistakesFile(await fs.readFile(archivePath(), 'utf8'));
  expect(archive.find((entry) => entry.id === mistakeId)).toBeUndefined();
  expect(await at('2026-11-03').getMistakes('kaoyan')).toEqual([]);
});

test('archived file stays plaintext under workspaces/<id>/practice', async () => {
  const service = at('2026-11-01');
  const wrong = await service.submitAnswer({ questionId: 'q1', choice: 0 });
  await service.setMistakeResolved!({ mistakeId: wrong.mistake!.id, resolved: true });
  await at('2026-11-02').archiveResolvedMistakes!({ workspaceId: 'kaoyan' });
  const archiveRaw = await fs.readFile(archivePath(), 'utf8');
  expect(archiveRaw).toContain('## ');
  expect(archiveRaw).toContain('错误次数');
});
