import type { FactIssue } from './content';
import type { Deck, SlideType } from './schema';

/**
 * Step 14: the per-lesson quality report. Everything here is deterministic —
 * no model call, no clock, no locale-dependent formatting — so the same input
 * always produces the same Markdown and the report can be diffed between runs.
 */

/**
 * One page whose content grew past the 656px limit. Declared locally in the
 * shape the layout step produces so this module does not import the layout
 * module (and tests can build overflow lists without a browser).
 */
export interface LayoutOverflowLike {
  index: number;
  bottom: number;
  excessPx: number;
}

export interface QualityReportInput {
  title: string;
  durationSeconds: number;
  mode: 'quick' | 'deck';
  transcriptChars: number;
  chunkCount: number;
  keyframeCount: number;
  screenReadCount: number;
  deck?: Deck;
  overflow: LayoutOverflowLike[];
  issuesA: FactIssue[];
  issuesB: FactIssue[];
  usage: { inputTokens: number; outputTokens: number };
  elapsedMs: number;
}

/** Display order and Chinese labels of the slide types. */
const SLIDE_TYPE_LABELS: Record<SlideType, string> = {
  cover: '封面',
  agenda: '目录',
  section: '章节',
  points: '要点',
  passage: '原文',
  figure: '截图',
  compare: '对比',
  insight: '补充',
  derive: '推演',
  quote: '引用',
  code: '代码',
  quiz: '小测',
  summary: '小结'
};

const SLIDE_TYPE_ORDER = Object.keys(SLIDE_TYPE_LABELS) as SlideType[];

/** `1,234,567`; rounding is deliberate so the report never shows 1234.5678. */
function thousands(value: number): string {
  const rounded = Math.round(Number.isFinite(value) ? value : 0);
  const sign = rounded < 0 ? '-' : '';
  const digits = String(Math.abs(rounded));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A decimal with grouped integer part, e.g. `1,234.5`. */
function decimal(value: number, digits: number): string {
  const fixed = (Number.isFinite(value) ? value : 0).toFixed(digits);
  const negative = fixed.startsWith('-');
  const body = negative ? fixed.slice(1) : fixed;
  const [whole, fraction] = body.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

/** `mm:ss`, minutes not wrapped, padded to two digits like the on-screen marks. */
function mmss(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function slideCount(deck: Deck): number {
  return deck.chapters.reduce((sum, chapter) => sum + chapter.slides.length, 0);
}

/** Issues grouped by severity; an empty list says so instead of printing a header. */
function appendIssues(lines: string[], heading: string, issues: readonly FactIssue[]): void {
  lines.push(`### ${heading}`, '');
  if (issues.length === 0) {
    lines.push('未发现问题', '');
    return;
  }
  for (const severity of ['error', 'warn'] as const) {
    const group = issues.filter((issue) => issue.severity === severity);
    if (group.length === 0) continue;
    lines.push(`- ${severity === 'error' ? '错误' : '提醒'}（${severity}）：${group.length} 条`);
    for (const issue of group) {
      lines.push(`  - [${issue.target}] ${issue.ref}：${issue.problem}`);
    }
  }
  lines.push('');
}

/** Renders the quality report Markdown. Pure: same input, same string. */
export function buildQualityReport(input: QualityReportInput): string {
  const lines: string[] = [];
  const totalTokens = input.usage.inputTokens + input.usage.outputTokens;

  lines.push(`# 质量报告 · ${input.title}`, '');

  // Overview -----------------------------------------------------------------
  lines.push('## 概览', '');
  lines.push(`- 模式：${input.mode === 'deck' ? '完整课件' : '快速笔记'}`);
  lines.push(`- 时长：${mmss(input.durationSeconds)}`);
  lines.push(
    `- 转写：${thousands(input.transcriptChars)} 字，${thousands(input.chunkCount)} 段`
  );
  lines.push(`- 关键帧：${thousands(input.keyframeCount)} 张`);
  lines.push(`- 读屏：${thousands(input.screenReadCount)} 条`);
  lines.push(
    input.deck === undefined
      ? '- 课件页数：—'
      : `- 课件页数：${thousands(slideCount(input.deck))} 页`
  );
  lines.push(`- 耗时：${mmss(input.elapsedMs / 1000)}`);
  lines.push(
    `- tokens：输入 ${thousands(input.usage.inputTokens)}，输出 ${thousands(input.usage.outputTokens)}，合计 ${thousands(totalTokens)}`
  );
  lines.push('');

  // Deck ---------------------------------------------------------------------
  lines.push('## 课件', '');
  if (input.deck === undefined) {
    lines.push('快速笔记模式，没有课件。', '');
  } else {
    const deck = input.deck;
    const total = slideCount(deck);
    const counts = new Map<SlideType, number>();
    for (const chapter of deck.chapters) {
      for (const slide of chapter.slides) {
        counts.set(slide.type, (counts.get(slide.type) ?? 0) + 1);
      }
    }
    const typeLine = SLIDE_TYPE_ORDER.filter((type) => (counts.get(type) ?? 0) > 0)
      .map((type) => `${SLIDE_TYPE_LABELS[type]} ${thousands(counts.get(type) ?? 0)} 页`)
      .join('、');
    const sizes = deck.chapters.map((chapter) => chapter.slides.length);
    const min = sizes.length > 0 ? Math.min(...sizes) : 0;
    const max = sizes.length > 0 ? Math.max(...sizes) : 0;
    const mean = sizes.length > 0 ? sizes.reduce((sum, size) => sum + size, 0) / sizes.length : 0;

    lines.push(`- 页数：${thousands(total)} 页`);
    lines.push(`- 类型：${typeLine === '' ? '无' : typeLine}`);
    lines.push(`- 章节：${thousands(deck.chapters.length)} 章`);
    lines.push(
      `- 每章页数：最少 ${thousands(min)}，最多 ${thousands(max)}，平均 ${decimal(mean, 1)}`
    );
    lines.push('');
  }

  // Layout -------------------------------------------------------------------
  lines.push('## 版面', '');
  if (input.overflow.length === 0) {
    lines.push('无超出', '');
  } else {
    const overflow = [...input.overflow].sort((a, b) => a.index - b.index);
    for (const page of overflow) {
      lines.push(
        `- 第 ${thousands(page.index)} 页：内容底边 ${thousands(page.bottom)} px，超出 ${thousands(page.excessPx)} px`
      );
    }
    lines.push('');
  }

  // Fact-check ---------------------------------------------------------------
  lines.push('## 核查', '');
  appendIssues(lines, '核查 A（笔记与补充卡片）', input.issuesA);
  appendIssues(lines, '核查 B（课件逐页）', input.issuesB);

  // Generation ---------------------------------------------------------------
  const minutes = Math.max(0, input.durationSeconds) / 60;
  const estimate = Math.round(minutes * 11_000);
  const deviation =
    estimate > 0
      ? `（${totalTokens - estimate >= 0 ? '+' : '-'}${decimal(
          (Math.abs(totalTokens - estimate) / estimate) * 100,
          1
        )}%）`
      : '';

  lines.push('## 生成', '');
  lines.push(`- 保留关键帧：${thousands(input.keyframeCount)} 张`);
  lines.push(`- 输入 tokens：${thousands(input.usage.inputTokens)}`);
  lines.push(`- 输出 tokens：${thousands(input.usage.outputTokens)}`);
  lines.push(
    `- 估算（11,000 tokens/分钟 × ${decimal(minutes, 1)} 分钟）：${thousands(estimate)} tokens`
  );
  lines.push(`- 实际：${thousands(totalTokens)} tokens${deviation}`);
  lines.push('');

  // Limits -------------------------------------------------------------------
  lines.push('## 限制', '');
  lines.push('- 画面读取依赖模型，个别文字可能抄错。');
  lines.push('- 被老师或遮挡物挡住的地方可能缺字。');
  lines.push('- 扩展内容来自模型的知识，需要自行判断。');
  lines.push('- 回看链接（file://#t=）依赖本机浏览器支持。');

  return `${lines.join('\n')}\n`;
}
