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

  it('states the strict clause once under the title only when strict is on', () => {
    const input = { workspaceId: 'kaoyan', date: '2026-11-02', mistakes: [mistake()] };
    const loose = buildMistakeSheet(input);
    expect(loose).not.toContain('更严判定');

    const strict = buildMistakeSheet({ ...input, strict: true });
    expect(strict).toContain('更严判定生效中：需要简答题复证');
    // Exactly one occurrence, and it sits between the title and the first entry.
    expect(strict.split('更严判定生效中').length - 1).toBe(1);
    expect(strict.indexOf('更严判定生效中')).toBeGreaterThan(strict.indexOf('# 错题复习单'));
    expect(strict.indexOf('更严判定生效中')).toBeLessThan(strict.indexOf('## 1.'));

    // Explicitly off is byte-identical to the default.
    expect(buildMistakeSheet({ ...input, strict: false })).toBe(loose);
  });
});

describe('iter34 P0 错因 / 顽疾 / 科目聚合行', () => {
  it('renders 错因 under 解析 only when the cause exists, else byte-identical', () => {
    const withCause = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [mistake({ cause: '导数链没拆完' })]
    });
    expect(withCause).toContain('解析：第一个重要极限。\n错因：导数链没拆完\n');

    // Every absent shape renders exactly what 1.3.0 wrote.
    const baseline = buildMistakeSheet({ workspaceId: 'kaoyan', date: '2026-11-02', mistakes: [mistake()] });
    expect(withCause).not.toBe(baseline);
    for (const value of [undefined, '', '   ']) {
      const sheet = buildMistakeSheet({
        workspaceId: 'kaoyan',
        date: '2026-11-02',
        mistakes: [{ ...mistake(), cause: value } as PracticeMistake]
      });
      expect(sheet).toBe(baseline);
      expect(sheet).not.toContain('错因');
    }
  });

  it('adds 顽疾 to the state line only under wrongCount>=2 && correctStreak<2', () => {
    const stubborn = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [mistake({ wrongCount: 2, correctStreak: 0 })]
    });
    expect(stubborn).toContain('错 2 次 · 优先级 2 · 下次复习 2026-11-05 · 顽疾');

    const washed = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [mistake({ wrongCount: 2, correctStreak: 2 })]
    });
    expect(washed).not.toContain('顽疾');

    // A high priority on a once-wrong item never makes it 顽疾.
    const once = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [mistake({ wrongCount: 1, priority: 3 })]
    });
    expect(once).not.toContain('顽疾');

    // Low priority but two wrongs still does.
    const lowPriority = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [mistake({ wrongCount: 2, priority: 0, correctStreak: 1 })]
    });
    expect(lowPriority).toContain('顽疾');
  });

  it('puts the per-subject summary under the title when 2+ subjects exist', () => {
    const a = mistake({ id: 'a' });
    const b = mistake({ id: 'b' });
    const c = mistake({ id: 'c' });
    const sheet = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [a, b, c],
      subjects: { a: '数学', b: '英语', c: '数学' }
    });
    // Count descending (数学 2 before 英语 1), ` · ` separator.
    expect(sheet).toContain('# 错题复习单 · 2026-11-02\n\n数学 2 · 英语 1\n\n## 1.');
    // Counts equal the rendered sections.
    expect(sheet.split('## ').length - 1).toBe(3);
  });

  it('orders equal counts by subject name', () => {
    const sheet = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [mistake({ id: 'a' }), mistake({ id: 'b' })],
      subjects: { a: '英语', b: '数学' }
    });
    expect(sheet).toContain('数学 1 · 英语 1');
  });

  it('renders no summary for one subject, all-未分类, or no subjects map', () => {
    const one = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [mistake({ id: 'a' }), mistake({ id: 'b' })],
      subjects: { a: '数学', b: '数学' }
    });
    expect(one).not.toMatch(/# 错题复习单 · 2026-11-02\n\n数学/);
    expect(one).toContain('# 错题复习单 · 2026-11-02\n\n## 1.');

    const uncategorized = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [mistake({ id: 'a' }), mistake({ id: 'b' })],
      subjects: {}
    });
    expect(uncategorized).not.toContain('未分类');

    // No map at all: byte-identical to the no-summary form.
    const noMap = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [mistake({ id: 'a' }), mistake({ id: 'b' })]
    });
    expect(noMap).toBe(uncategorized);
  });

  it('未分类 does not count as a second subject: one real subject + uncategorized renders nothing', () => {
    // 未分类 alone never satisfies n≥2. The spec's own example (数学 8 · 英语 3)
    // is covered above; this pins the boundary.
    const oneReal = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: [mistake({ id: 'a' }), mistake({ id: 'b' })],
      subjects: { a: '数学' }
    });
    expect(oneReal).not.toContain('未分类');
    expect(oneReal).not.toMatch(/# 错题复习单 · 2026-11-02\n\n数学/);

    // Three real subjects plus an uncategorized bucket: shown, with the bucket.
    const threeReal = buildMistakeSheet({
      workspaceId: 'kaoyan',
      date: '2026-11-02',
      mistakes: ['a', 'b', 'c', 'd'].map((id) => mistake({ id })),
      subjects: { a: '数学', b: '数学', c: '英语', d: '政治' }
    });
    expect(threeReal).toContain('数学 2 · 英语 1 · 政治 1');
  });
});
