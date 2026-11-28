/**
 * iter34 P2 — Anki-compatible TSV export, end to end against a real vault.
 *
 * The builder is unit-tested in `tests/shared/anki-export.test.ts`; here the
 * concern is what actually lands on disk: path, no BOM, overwrite on the same
 * day, and no scheduling field leaking into a file the learner will share.
 */
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPracticeService } from '../../src/main/practice';
import { SCHEDULING_FIELD_NAMES } from '../../src/shared/anki-export';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'practice-anki-'));
  await fs.mkdir(join(root, 'workspaces', 'kaoyan'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function at(date: string) {
  return createPracticeService(root, { now: () => new Date(`${date}T09:00:00`) });
}

const exportsDir = () => join(root, 'workspaces', 'kaoyan', 'practice', 'exports');
const setPath = (setId: string, date: string) => join(exportsDir(), `${setId}-${date}.tsv`);
const mistakesPath = (date: string) => join(exportsDir(), `mistakes-${date}.tsv`);

async function seedSet(service: ReturnType<typeof at>): Promise<{ setId: string }> {
  const set = await service.createSet({
    workspaceId: 'kaoyan',
    title: '导数练习',
    subject: '数学',
    questions: [
      {
        id: 'q-choice',
        prompt: '链式法则的第一步？',
        options: ['拆外层', '求导', '代入'],
        answer: 0,
        explanation: '先拆外层再逐层求导。'
      },
      {
        id: 'q-short',
        prompt: '解释导数。',
        kind: 'short',
        options: [],
        answer: 0,
        referenceAnswer: '瞬时变化率。',
        explanation: ''
      }
    ]
  });
  return { setId: set.id };
}

test('验收 18：exporting a set writes the expected path with the header block first', async () => {
  const service = at('2026-11-28');
  const { setId } = await seedSet(service);
  const result = await service.exportAnkiSet!({ workspaceId: 'kaoyan', setId });
  expect(result.path).toBe(`workspaces/kaoyan/practice/exports/${setId}-2026-11-28.tsv`);
  expect(result.count).toBe(2);
  const text = await fs.readFile(setPath(setId, '2026-11-28'), 'utf8');
  const lines = text.split('\n');
  expect(lines[0]).toBe('#separator:tab');
  expect(lines[1]).toBe('#html:true');
  expect(lines[2]?.startsWith('#columns:')).toBe(true);
  expect(lines[3]).toBe('#tags column:4');
  expect(lines[4]).toBe('#deck:数学');
});

test('验收 19：the file on disk has no BOM and is UTF-8', async () => {
  const service = at('2026-11-28');
  const { setId } = await seedSet(service);
  await service.exportAnkiSet!({ workspaceId: 'kaoyan', setId });
  const bytes = await fs.readFile(setPath(setId, '2026-11-28'));
  // `# s` — a BOM would put EF BB BF in front of the hash.
  expect([bytes[0], bytes[1], bytes[2]]).toEqual([0x23, 0x73, 0x65]);
});

test('验收 22：exporting twice on one day overwrites the same file', async () => {
  const service = at('2026-11-28');
  const { setId } = await seedSet(service);
  await service.exportAnkiSet!({ workspaceId: 'kaoyan', setId });
  const first = await fs.stat(setPath(setId, '2026-11-28'));
  await new Promise((resolve) => setTimeout(resolve, 25));
  await service.exportAnkiSet!({ workspaceId: 'kaoyan', setId });
  const second = await fs.stat(setPath(setId, '2026-11-28'));
  expect(second.mtimeMs).toBeGreaterThanOrEqual(first.mtimeMs);
  const entries = await fs.readdir(exportsDir());
  expect(entries.filter((name) => name.startsWith(`${setId}-`))).toHaveLength(1);
});

test('验收 20：a mistake export carries no scheduling field', async () => {
  const service = at('2026-11-28');
  const { setId } = await seedSet(service);
  // A wrong answer at index 1 of the first question creates the mistake.
  await service.submitAnswer({ questionId: 'q-choice', choice: 1 });
  const result = await service.exportAnkiMistakes!({ workspaceId: 'kaoyan' });
  expect(result.path).toBe('workspaces/kaoyan/practice/exports/mistakes-2026-11-28.tsv');
  const text = await fs.readFile(mistakesPath('2026-11-28'), 'utf8');
  for (const name of SCHEDULING_FIELD_NAMES) {
    expect(text.includes(name), `导出文件不得含 ${name}`).toBe(false);
  }
  expect(text).toContain('科目:数学');
});

test('验收 23：no export means no exports directory at all', async () => {
  const service = at('2026-11-28');
  await seedSet(service);
  await service.exportMistakeSheet!({ workspaceId: 'kaoyan', dueOnly: false });
  await expect(fs.readdir(exportsDir())).rejects.toMatchObject({ code: 'ENOENT' });
});
