import { buildMistakeSheet, MISTAKE_SHEET_KIND } from '../../src/shared/practice-sheet';
import type { PracticeMistake } from '../../src/shared/practice';

function mistake(overrides: Partial<PracticeMistake> = {}): PracticeMistake {
  return {
    id: 'pm1',
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: 'q1',
    prompt: '当 x→0 时，sin x / x 的极限是？',
    options: ['0', '1', '∞'],
    answer: 1,
    explanation: '第一个重要极限。',
    wrongCount: 2,
    correctStreak: 0,
    priority: 2,
    intervalDays: 3,
    due: '2026-11-05',
    status: 'active',
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-02T09:00:00.000Z',
    lastAnsweredAt: '2026-11-02T09:00:00.000Z',
    ...overrides
  };
}

const resolved = mistake({
  id: 'pm2',
  questionId: 'q2',
  prompt: '矩阵 A 可逆的充要条件是？',
  options: ['|A| = 0', '|A| ≠ 0', 'A 是对称矩阵', ''],
  answer: 1,
  explanation: '行列式不为零时矩阵可逆。',
  wrongCount: 1,
  correctStreak: 2,
  priority: 0,
  intervalDays: 1,
  due: '2026-11-03',
  status: 'resolved'
});

describe('buildMistakeSheet', () => {
  it('renders options as A/B/C/D lines, the answer, the explanation and the state', () => {
    const sheet = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [mistake(), resolved]
    });

    expect(sheet).toContain(`kind: ${MISTAKE_SHEET_KIND}`);
    expect(sheet).toContain('workspaceId: kaoyan');
    expect(sheet).toContain("generated: '2026-11-02'");
    expect(sheet).toContain('entries: 2');
    expect(sheet).toContain('# 错题复习单 · 2026-11-02');

    expect(sheet).toContain('## 1. 当 x→0 时，sin x / x 的极限是？');
    expect(sheet).toContain('A. 0\nB. 1\nC. ∞');
    expect(sheet).toContain('答案：B');
    expect(sheet).toContain('解析：第一个重要极限。');
    expect(sheet).toContain('错 2 次 · 优先级 2 · 下次复习 2026-11-05');

    // The empty fourth option is skipped, but the answer letter stays a B.
    expect(sheet).toContain('## 2. 矩阵 A 可逆的充要条件是？');
    expect(sheet).toContain('A. |A| = 0\nB. |A| ≠ 0\nC. A 是对称矩阵');
    expect(sheet).not.toContain('D. ');
    expect(sheet).toContain('答案：B');
    expect(sheet).toContain('解析：行列式不为零时矩阵可逆。');
    expect(sheet).toContain('错 1 次 · 优先级 0 · 已掌握');
    expect(sheet).not.toContain('下次复习 2026-11-03');
  });

  it('is byte-identical across two calls with the same input', () => {
    const input = { workspaceId: 'kaoyan', date: '2026-11-02', mistakes: [mistake(), resolved] };
    const first = buildMistakeSheet(input);
    const second = buildMistakeSheet(input);
    expect(second).toBe(first);
  });

  it('quotes an ambiguous workspace id so the frontmatter stays valid YAML', () => {
    const sheet = buildMistakeSheet({ workspaceId: '2027', date: '2026-11-02', mistakes: [] });
    expect(sheet).toContain("workspaceId: '2027'");
    expect(sheet).toContain('entries: 0');
    expect(sheet.trimEnd().endsWith('# 错题复习单 · 2026-11-02')).toBe(true);
  });

  it('keeps a multi-line prompt on one heading line', () => {
    const sheet = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [mistake({ prompt: '第一行\n第二行' })]
    });
    expect(sheet).toContain('## 1. 第一行 第二行');
  });

  it('renders 参考答案 instead of an option letter for a short mistake', () => {
    const short = mistake({
      id: 'pm3',
      questionId: 'q3',
      kind: 'short',
      prompt: '用自己的话说明第一个重要极限。',
      options: [],
      answer: 0,
      referenceAnswer: 'x→0 时 sin x / x 的极限是 1。',
      explanation: '夹逼准则可证。'
    });
    const sheet = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [short]
    });

    expect(sheet).toContain('## 1. 用自己的话说明第一个重要极限。');
    expect(sheet).toContain('参考答案：x→0 时 sin x / x 的极限是 1。');
    expect(sheet).not.toContain('答案：A');
    expect(sheet).not.toContain('A. ');
    // Everything after the answer line is unchanged.
    expect(sheet).toContain('解析：夹逼准则可证。');
    expect(sheet).toContain('错 2 次 · 优先级 2 · 下次复习 2026-11-05');
    expect(sheet).toContain('entries: 1');
  });

  it('keeps a multi-line reference answer on one line', () => {
    const sheet = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [
        mistake({
          kind: 'short',
          options: [],
          answer: 0,
          referenceAnswer: '第一行\n第二行'
        })
      ]
    });
    expect(sheet).toContain('参考答案：第一行 第二行');
  });
});
