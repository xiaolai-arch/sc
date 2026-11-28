/**
 * iter34 P3 — 验收 28: the exam stage is a label, never a progress judgement.
 *
 * The spec is explicit that nothing may derive 「落后/超前」 from `phase`, and no
 * code path may say 「你落后 1 周」-style copy. This test is a grep assertion over
 * the whole first-party source: the stage appears only where a user sets or
 * reads it, and the forbidden judgements appear nowhere.
 */
import { promises as fs } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) await walk(child, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(child);
  }
  return out;
}

async function sources(): Promise<Array<{ path: string; text: string }>> {
  const files: string[] = [];
  for (const dir of ['src', 'web']) await walk(join(ROOT, dir), files);
  return Promise.all(
    files.map(async (file) => ({
      path: relative(ROOT, file).replace(/\\/g, '/'),
      text: await fs.readFile(file, 'utf8')
    }))
  );
}

test('no source spells a progress judgement about an exam stage (验收 28)', async () => {
  const forbidden = [/落后\s*\d+\s*周/, /领先\s*\d+\s*周/, /进度落后/, /进度超前/];
  const hits: string[] = [];
  for (const { path, text } of await sources()) {
    for (const pattern of forbidden) {
      if (pattern.test(text)) hits.push(`${path}: ${pattern}`);
    }
  }
  expect(hits).toEqual([]);
});

test('the exam phase is never compared against time or a plan to judge progress', async () => {
  // A progress judgement would have to mix the stage label with a clock or a
  // schedule on the same line. Conversation runs have an unrelated `run.phase`,
  // so only the exam-stage spelling (`workspace.phase`, `.phase === '基础'`, …)
  // is considered, and only when it meets a scheduling/progress word.
  const stageLabel = /(?:workspace|entry|current|next|target)\.phase|phase\s*[!=]==?\s*'?(?:基础|强化|冲刺)'/;
  const progressWord = /daysUntilTarget|daysLeft|落后|超前|预计|进度|剩余|weeksLeft/;
  const hits: string[] = [];
  for (const { path, text } of await sources()) {
    for (const line of text.split('\n')) {
      if (stageLabel.test(line) && progressWord.test(line)) {
        hits.push(`${path}: ${line.trim()}`);
      }
    }
  }
  expect(hits).toEqual([]);
});
