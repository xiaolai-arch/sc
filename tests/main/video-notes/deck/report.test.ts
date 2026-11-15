import type { FactIssue } from '../../../../src/main/video-notes/deck/content';
import {
  buildQualityReport,
  type QualityReportInput
} from '../../../../src/main/video-notes/deck/report';
import type { Deck, Slide } from '../../../../src/main/video-notes/deck/schema';

function pointsSlide(id: string): Slide {
  return {
    type: 'points',
    id,
    title: `要点页 ${id}`,
    sources: [{ kind: 'screen', t: 10 }],
    points: [{ text: '一个要点', source: { kind: 'screen', t: 10 } }]
  };
}

function insightSlide(id: string): Slide {
  return {
    type: 'insight',
    id,
    title: '补充结论',
    sources: [{ kind: 'infer' }],
    principle: '原理',
    examples: [{ right: '例子一' }, { right: '例子二' }],
    pitfall: '易错点',
    transfer: '迁移方法'
  };
}

/** Two chapters: 3 slides in the first, 1 in the second. */
function sampleDeck(): Deck {
  return {
    version: 1,
    title: '第一讲 名词',
    sourcePath: 'C:\\courses\\lesson.mp4',
    durationSeconds: 2711,
    chapters: [
      {
        title: '一、可数名词',
        start: 0,
        slides: [pointsSlide('p1'), pointsSlide('p2'), insightSlide('i1')]
      },
      { title: '二、不可数名词', start: 1200, slides: [pointsSlide('p3')] }
    ]
  };
}

function issue(overrides: Partial<FactIssue> = {}): FactIssue {
  return {
    target: 'notes',
    ref: '第一章/1',
    claim: '被质疑的说法',
    problem: '画面文字是「……」，与这句矛盾',
    severity: 'error',
    ...overrides
  };
}

function input(overrides: Partial<QualityReportInput> = {}): QualityReportInput {
  return {
    title: '第一讲 名词',
    durationSeconds: 2711,
    keyframeCount: 57,
    screenReadCount: 40,
    screenOnly: true,
    deck: sampleDeck(),
    overflow: [],
    issuesA: [],
    issuesB: [],
    usage: { inputTokens: 1234567, outputTokens: 34567 },
    elapsedMs: 90000,
    ...overrides
  };
}

describe('buildQualityReport', () => {
  it('contains every section heading', () => {
    const report = buildQualityReport(input());

    expect(report).toContain('# 质量报告 · 第一讲 名词');
    expect(report).toContain('## 概览');
    expect(report).toContain('## 课件');
    expect(report).toContain('## 版面');
    expect(report).toContain('## 核查');
    expect(report).toContain('## 生成');
    expect(report).toContain('## 限制');
  });

  it('reports slide counts per type and chapter statistics', () => {
    const report = buildQualityReport(input());

    expect(report).toContain('页数：4 页');
    expect(report).toContain('要点 3 页');
    expect(report).toContain('补充 1 页');
    expect(report).toContain('章节：2 章');
    expect(report).toContain('每章页数：最少 1，最多 3，平均 2.0');
  });

  it('says 无超出 when no page overflows', () => {
    expect(buildQualityReport(input())).toContain('无超出');
  });

  it('lists overflow pages sorted by index', () => {
    const report = buildQualityReport(
      input({
        overflow: [
          { index: 5, bottom: 700, excessPx: 44 },
          { index: 2, bottom: 690, excessPx: 34 }
        ]
      })
    );

    expect(report).not.toContain('无超出');
    expect(report).toContain('第 2 页：内容底边 690 px，超出 34 px');
    expect(report.indexOf('第 2 页')).toBeLessThan(report.indexOf('第 5 页'));
  });

  it('groups check issues by severity and says 未发现问题 when clean', () => {
    const report = buildQualityReport(
      input({
        issuesA: [issue(), issue({ severity: 'warn', ref: '第一章/2' })],
        issuesB: []
      })
    );

    expect(report).toContain('错误（error）：1 条');
    expect(report).toContain('提醒（warn）：1 条');
    expect(report).toContain('[notes] 第一章/1：画面文字是「……」，与这句矛盾');
    expect(report).toContain('未发现问题');
  });

  it('formats times as mm:ss and numbers with thousands separators', () => {
    const report = buildQualityReport(input());

    expect(report).toContain('时长：45:11');
    expect(report).toContain('耗时：01:30');
    expect(report).toContain('关键帧：57 张');
    expect(report).toContain('画面文字：40 条');
    expect(report).toContain('依据：只有画面文字，没有语音转写');
    expect(report).toContain('输入 1,234,567');
    expect(report).toContain('输出 34,567');
    expect(report).toContain('合计 1,269,134');
  });

  it('compares the per-minute token estimate with the actual usage', () => {
    const report = buildQualityReport(
      input({ durationSeconds: 600, usage: { inputTokens: 100000, outputTokens: 20000 } })
    );

    expect(report).toContain('11,000 tokens/分钟');
    expect(report).toContain('110,000 tokens');
    expect(report).toContain('实际：120,000 tokens');
  });

  it('states the fixed limitations', () => {
    const report = buildQualityReport(input());

    expect(report).toContain('纯口头内容与未停留的画面可能缺失');
    expect(report).toContain('遮挡');
    expect(report).toContain('file://#t=');
    expect(report).toContain('字体随机器变化');
  });

  it('is deterministic for the same input', () => {
    expect(buildQualityReport(input())).toBe(buildQualityReport(input()));
  });
});
