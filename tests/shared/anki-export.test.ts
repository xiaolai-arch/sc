import { describe, expect, test } from 'vitest';
import {
  ANKI_COLUMNS,
  SCHEDULING_FIELD_NAMES,
  ankiAnalysis,
  ankiBack,
  ankiCell,
  ankiFront,
  ankiHeader,
  buildAnkiMistakesExport,
  buildAnkiSetExport
} from '../../src/shared/anki-export';
import type { PracticeMistake, PracticeQuestion } from '../../src/shared/practice';

const QUESTION: PracticeQuestion = {
  id: 'q1',
  prompt: '链式法则的中间步骤是什么？',
  options: ['先拆外层', '先求导', '先代入'],
  answer: 0,
  explanation: '导数链没拆完最容易错在中间层。'
};

const SHORT: PracticeQuestion = {
  id: 'q2',
  prompt: '用自己的话解释导数。',
  kind: 'short',
  options: [],
  answer: 0,
  referenceAnswer: '函数在某点的瞬时变化率。',
  explanation: ''
};

const MISTAKE = (overrides: Partial<PracticeMistake> = {}): PracticeMistake => ({
  id: 'm1',
  workspaceId: 'kaoyan',
  setId: 'set1',
  questionId: 'q1',
  prompt: QUESTION.prompt,
  options: QUESTION.options,
  answer: QUESTION.answer,
  explanation: QUESTION.explanation,
  due: '2026-11-28',
  wrongCount: 2,
  correctStreak: 0,
  priority: 2,
  intervalDays: 1,
  status: 'active',
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-01T09:00:00.000Z',
  lastAnsweredAt: '2026-11-01T09:00:00.000Z',
  ...overrides
});

describe('anki export header', () => {
  test('验收 18：header order is separator, html, columns, tags column, deck', () => {
    const lines = ankiHeader('数学');
    expect(lines[0]).toBe('#separator:tab');
    expect(lines[1]).toBe('#html:true');
    expect(lines[2]).toBe(`#columns:${ANKI_COLUMNS.join('\t')}`);
    expect(lines[3]).toBe('#tags column:4');
    expect(lines[4]).toBe('#deck:数学');
  });

  test('验收 19：a deck name with a tab or newline cannot break the header line', () => {
    const lines = ankiHeader('数\t学\n进阶');
    expect(lines[4]).toBe('#deck:数　学进阶');
    expect(lines[4].includes('\t')).toBe(false);
  });

  test('a set export starts with # on the very first line', () => {
    const tsv = buildAnkiSetExport({ questions: [QUESTION], subject: '数学', deck: '数学' });
    expect(tsv.startsWith('#separator:tab')).toBe(true);
    expect(tsv.split('\n')[0]?.startsWith('#')).toBe(true);
  });
});

describe('anki cell escaping', () => {
  test('验收 19：newlines become <br>, tabs become a full-width space', () => {
    expect(ankiCell('上\n下')).toBe('上<br>下');
    expect(ankiCell('上\r\n下')).toBe('上<br>下');
    expect(ankiCell('a\tb')).toBe('a　b');
    // A bare CR has no meaning in Anki's HTML; it is dropped, not rendered.
    expect(ankiCell('a\rb')).toBe('ab');
  });

  test('验收 19：a cell containing a tab still yields exactly four columns', () => {
    const tsv = buildAnkiSetExport({
      questions: [{ ...QUESTION, prompt: '左\t右' }],
      subject: '数学',
      deck: '数学'
    });
    const row = tsv.split('\n').find((line) => !line.startsWith('#') && line !== '');
    expect(row?.split('\t')).toHaveLength(4);
  });

  test('the file is UTF-8 without a BOM', () => {
    const tsv = buildAnkiSetExport({ questions: [QUESTION], subject: '数学', deck: '数学' });
    // Written by writeFileAtomic as utf8 with no BOM, so the text starts at #.
    expect(tsv.charCodeAt(0)).toBe(0x23);
  });
});

describe('anki card faces', () => {
  test('a choice question lists its options under the prompt', () => {
    expect(ankiFront(QUESTION)).toBe(
      '链式法则的中间步骤是什么？\nA. 先拆外层\nB. 先求导\nC. 先代入'
    );
    expect(ankiBack(QUESTION)).toBe('A');
  });

  test('a short question exports the reference answer, not a letter', () => {
    expect(ankiFront(SHORT)).toBe('用自己的话解释导数。');
    expect(ankiBack(SHORT)).toBe('函数在某点的瞬时变化率。');
  });

  test('验收 21：a cause becomes its own 错因 line in the analysis cell', () => {
    expect(ankiAnalysis('解析正文', '导数链没拆完')).toBe('解析正文\n错因：导数链没拆完');
    expect(ankiAnalysis('解析正文', undefined)).toBe('解析正文');
    expect(ankiAnalysis('', undefined)).toBe('');
  });
});

describe('anki mistake export', () => {
  test('验收 20：no scheduling field appears anywhere in the file', () => {
    const tsv = buildAnkiMistakesExport({
      mistakes: [MISTAKE({ cause: '导数链没拆完' })],
      subjects: { m1: '数学' },
      questions: { m1: QUESTION },
      deck: '错题'
    });
    for (const name of SCHEDULING_FIELD_NAMES) {
      expect(tsv.includes(name), `导出文件不得含 ${name}`).toBe(false);
    }
  });

  test('验收 21：tags carry 错因, 顽疾 and the subject', () => {
    const tsv = buildAnkiMistakesExport({
      mistakes: [MISTAKE({ cause: '导数链没拆完' })],
      subjects: { m1: '数学' },
      questions: { m1: QUESTION },
      deck: '错题'
    });
    const row = tsv.split('\n').find((line) => !line.startsWith('#') && line !== '');
    const tags = row?.split('\t')[3];
    expect(tags).toContain('错因');
    expect(tags).toContain('顽疾');
    expect(tags).toContain('科目:数学');
    expect(row?.split('\t')[2]).toContain('错因：导数链没拆完');
  });

  test('验收 21：a washed-clean question (streak 2) carries no 顽疾 tag', () => {
    const tsv = buildAnkiMistakesExport({
      mistakes: [MISTAKE({ wrongCount: 2, correctStreak: 2 })],
      subjects: { m1: '数学' },
      questions: { m1: QUESTION },
      deck: '错题'
    });
    const row = tsv.split('\n').find((line) => !line.startsWith('#') && line !== '');
    expect(row?.split('\t')[3]).not.toContain('顽疾');
  });

  test('a mistake whose question vanished contributes no row', () => {
    const tsv = buildAnkiMistakesExport({
      mistakes: [MISTAKE({ id: 'gone', questionId: 'missing' })],
      questions: { gone: undefined },
      deck: '错题'
    });
    const rows = tsv.split('\n').filter((line) => !line.startsWith('#') && line !== '');
    expect(rows).toHaveLength(0);
  });

  test('every row has exactly four columns', () => {
    const tsv = buildAnkiMistakesExport({
      mistakes: [MISTAKE(), MISTAKE({ id: 'm2', questionId: 'q2' })],
      subjects: { m1: '数学', m2: '英语' },
      questions: { m1: QUESTION, m2: SHORT },
      deck: '错题'
    });
    const rows = tsv.split('\n').filter((line) => !line.startsWith('#') && line !== '');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.split('\t')).toHaveLength(4);
  });
});
