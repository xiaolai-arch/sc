import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPracticeService } from '../../src/main/practice';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'practice-security-'));
  await fs.mkdir(join(root, 'workspaces', 'kaoyan'), { recursive: true });
  await fs.mkdir(join(root, 'workspaces', 'english'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function service() {
  return createPracticeService(root, { now: () => new Date('2026-11-01T09:00:00') });
}

test('rejects path traversal in set ids', async () => {
  const practice = service();
  for (const id of ['../ps1', '../../etc/passwd', 'ps1/../../escape', '.', '..', 'a b', 'a\\b']) {
    await expect(practice.getSet(id)).rejects.toThrow('Invalid practice set id');
  }
});

test('rejects path traversal in workspace ids', async () => {
  const practice = service();
  for (const id of ['../kaoyan', '../../tmp', 'kaoyan/../english', '..', 'kaoyan.']) {
    await expect(practice.listSets(id)).rejects.toThrow('Invalid workspace id');
    await expect(practice.getMistakes(id)).rejects.toThrow('Invalid workspace id');
    await expect(practice.listAttempts(id)).rejects.toThrow('Invalid workspace id');
  }
});

test('rejects path traversal in question ids', async () => {
  const practice = service();
  for (const id of ['../q1', 'q1/../../x', '..', '.', 'q 1']) {
    await expect(practice.submitAnswer({ questionId: id, choice: 0 })).rejects.toThrow(
      'Invalid question id'
    );
  }
});

test('rejects unsafe dates before touching the vault', async () => {
  const practice = service();
  for (const date of ['../../etc/passwd', '2026-11-1', '2026-13-01', 'today', '']) {
    await expect(practice.getDue('kaoyan', date)).rejects.toThrow('Invalid due date');
  }
});

test('rejects unsafe workspace ids on create', async () => {
  const practice = service();
  await expect(
    practice.createSet({
      workspaceId: '../outside',
      title: '逃逸',
      questions: [{ prompt: '题', options: ['A', 'B'], answer: 0 }]
    })
  ).rejects.toThrow('Invalid workspace id');
  await expect(
    practice.createSet({
      workspaceId: 'kaoyan',
      title: '逃逸',
      questions: [{ id: '../q', prompt: '题', options: ['A', 'B'], answer: 0 }]
    })
  ).rejects.toThrow('Invalid question id');

  expect(await fs.stat(join(root, 'workspaces', 'outside')).catch(() => null)).toBeNull();
  expect(await fs.stat(join(root, 'outside')).catch(() => null)).toBeNull();
});

test('does not create workspaces or seed sets when the workspace is absent', async () => {
  const emptyRoot = await mkdtemp(join(tmpdir(), 'practice-empty-'));
  try {
    const practice = createPracticeService(emptyRoot, {
      now: () => new Date('2026-11-01T09:00:00')
    });
    expect(await practice.listSets('kaoyan')).toEqual([]);
    expect(await fs.stat(join(emptyRoot, 'workspaces')).catch(() => null)).toBeNull();
  } finally {
    await rm(emptyRoot, { recursive: true, force: true });
  }
});

test('keeps practice writes inside the workspace practice directory', async () => {
  const practice = service();
  await practice.submitAnswer({ questionId: 'q1', choice: 0 });
  const set = await practice.createSet({
    workspaceId: 'kaoyan',
    title: '边界检查',
    questions: [{ prompt: '边界题目唯一', options: ['A', 'B'], answer: 0 }]
  });
  await practice.submitAnswer({ questionId: set.questions[0]!.id, choice: 1 });

  const files = await fs.readdir(join(root, 'workspaces'), { recursive: true });
  expect(files.some((file) => String(file).includes('..'))).toBe(false);
  expect(
    await fs.readFile(join(root, 'workspaces', 'kaoyan', 'practice', 'sets', 'ps1.md'), 'utf8')
  ).toContain('极限基础');
  expect(
    await fs.readFile(join(root, 'workspaces', 'kaoyan', 'practice', 'mistakes.md'), 'utf8')
  ).toContain('边界题目唯一');
});
