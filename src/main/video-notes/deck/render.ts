import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { escapeHtml } from '../html';
import { validateDeck, type Deck, type Slide, type SlideType, type Source } from './schema';
import { themeCss } from './theme';

/**
 * Renders a validated deck as one self-contained HTML document: CSS, the
 * navigation script and every frame (as a base64 data URI) are inlined. The
 * file works offline by double-clicking it and never references the network.
 */

export interface RenderDeckOptions {
  /** The lesson video that source badges seek in; may differ from `deck.sourcePath` at runtime. */
  sourcePath: string;
  /** `figure.frame` (e.g. `frames/12345.jpg`) to an absolute path on disk. */
  frames: Map<string, string>;
}

interface SlideEntry {
  slide: Slide;
  chapterTitle: string;
  index: number;
}

const SLIDE_KIND_LABELS: Record<SlideType, string> = {
  cover: '封面',
  agenda: '目录',
  section: '章节',
  points: '要点',
  passage: '原文',
  figure: '截图',
  compare: '对比',
  insight: '补充',
  derive: '推演',
  quote: '引文',
  code: '代码',
  quiz: '小测',
  summary: '小结'
};

/** `mm:ss` with minutes allowed to exceed 59 (a 75-minute lesson is `75:30`). */
function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Escapes model text, then applies the only two inline markers the deck
 * supports. Everything else (`_`, a single `*`, backticks, raw HTML) stays
 * literal; the escaped string is the only input to the replacements.
 */
export function renderInlineText(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>');
}

/**
 * Mirrors the private `safeHref` in `../html.ts`: only this lesson's own video
 * may be opened through a `file:` link. `html.ts` is outside this change's
 * scope, so the rule is kept here rather than exported from there.
 */
function safeHref(href: string, videoHref: string): string | null {
  const value = href.trim();
  // Browsers ignore tabs/newlines inside a scheme, so check the compact form
  // too: `java\nscript:` must not slip through as a "relative" URL.
  const compact = value.replace(/[\u0000- \u007f]/g, '').toLowerCase();
  if (/javascript:|data:|vbscript:/i.test(compact)) return null;
  if (value === '' || value.startsWith('#')) return value;
  if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value)) return value;
  if (/^file:/i.test(value) && (videoHref === '' || value.startsWith(videoHref))) return value;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return null;
}

function seekHref(seconds: number, videoHref: string): string {
  return `${videoHref}#t=${Math.max(0, Math.floor(seconds))}`;
}

/** A provenance chip. `ext` never gets a seek link: it is not in the video. */
function renderSourceBadge(source: Source, videoHref: string): string {
  if (source.kind === 'video' || source.kind === 'screen') {
    const label = source.kind === 'video' ? '视频' : '画面';
    const clock = formatClock(source.t);
    const safe = safeHref(seekHref(source.t, videoHref), videoHref);
    if (safe === null) {
      return `<span class="src src-${source.kind}">${escapeHtml(label)} ${escapeHtml(clock)}</span>`;
    }
    return `<a class="src src-${source.kind}" href="${escapeHtml(safe)}" title="跳回原视频 ${escapeHtml(clock)}">${escapeHtml(label)} ${escapeHtml(clock)}</a>`;
  }
  if (source.kind === 'infer') {
    return '<span class="src src-infer">推断</span>';
  }
  const parts = ['外部资料'];
  if (source.title !== undefined) parts.push(source.title);
  if (source.page !== undefined) parts.push(`第 ${source.page} 页`);
  return `<span class="src src-ext">${parts.map((part) => escapeHtml(part)).join(' · ')}</span>`;
}

function optionKey(index: number): string {
  return String.fromCharCode(65 + index);
}

function flattenDeck(deck: Deck): SlideEntry[] {
  const entries: SlideEntry[] = [];
  for (const chapter of deck.chapters) {
    for (const slide of chapter.slides) {
      entries.push({ slide, chapterTitle: chapter.title, index: entries.length });
    }
  }
  return entries;
}

function frameDataUri(frame: string, frames: Map<string, string>, cache: Map<string, string>): string {
  const cached = cache.get(frame);
  if (cached !== undefined) return cached;
  const filePath = frames.get(frame);
  if (filePath === undefined) {
    // validateDeck catches this first; keep a guard so a caller bypassing it
    // still fails loudly instead of rendering an empty <img>.
    throw new Error(`frame "${frame}" is not available to the renderer`);
  }
  let base64: string;
  try {
    base64 = readFileSync(filePath).toString('base64');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read frame "${frame}" at ${filePath}: ${message}`);
  }
  const uri = `data:image/jpeg;base64,${base64}`;
  cache.set(frame, uri);
  return uri;
}

/** One slide's content, without chrome, footers or provenance badges. */
function renderSlideBody(
  slide: Slide,
  videoHref: string,
  frames: Map<string, string>,
  frameCache: Map<string, string>
): string {
  switch (slide.type) {
    case 'cover':
      return `<h1 class="cover-title">${renderInlineText(slide.title)}</h1>${
        slide.subtitle === undefined
          ? ''
          : `<p class="cover-subtitle">${renderInlineText(slide.subtitle)}</p>`
      }`;
    case 'agenda':
      return `<h2 class="slide-title">${renderInlineText(slide.title)}</h2>
<ul class="agenda-list">${slide.items
        .map(
          (item, index) =>
            `<li><span class="agenda-num">${String(index + 1).padStart(2, '0')}</span><span class="agenda-text">${renderInlineText(item)}</span></li>`
        )
        .join('')}</ul>`;
    case 'section':
      return `<h2 class="slide-title section-title">${renderInlineText(slide.title)}</h2>
<p class="section-lead">${renderInlineText(slide.lead)}</p>`;
    case 'points':
      return `<h2 class="slide-title">${renderInlineText(slide.title)}</h2>
<ul class="points-list">${slide.points
        .map(
          (point) =>
            `<li class="point"><span class="point-text">${renderInlineText(point.text)}</span><span class="point-source">${renderSourceBadge(point.source, videoHref)}</span></li>`
        )
        .join('')}</ul>`;
    case 'passage':
      return `<h2 class="slide-title">${renderInlineText(slide.title)}</h2>
<div class="passage">${slide.lines
        .map((line) => `<p class="passage-line">${renderInlineText(line)}</p>`)
        .join('')}</div>`;
    case 'figure': {
      const uri = frameDataUri(slide.frame, frames, frameCache);
      const captions =
        slide.captions.length === 0
          ? ''
          : `<figcaption class="figure-captions">${slide.captions
              .map((caption) => `<span class="figure-caption">${renderInlineText(caption)}</span>`)
              .join('')}</figcaption>`;
      return `<h2 class="slide-title">${renderInlineText(slide.title)}</h2>
<figure class="figure">
<img src="${uri}" alt="${escapeHtml(slide.title)}" decoding="sync">
${captions}
</figure>`;
    }
    case 'compare':
      return `<h2 class="slide-title">${renderInlineText(slide.title)}</h2>
<div class="compare" style="--compare-cols:${slide.columns.length}">${slide.columns
        .map(
          (column) =>
            `<div class="compare-col"><h3 class="compare-heading">${renderInlineText(column.heading)}</h3><ul class="compare-items">${column.items
              .map((item) => `<li>${renderInlineText(item)}</li>`)
              .join('')}</ul></div>`
        )
        .join('')}</div>`;
    case 'insight': {
      const examples = slide.examples
        .map(
          (example) =>
            `<div class="insight-example">${
              example.wrong === undefined
                ? ''
                : `<p class="example-line example-wrong"><span class="example-label">反例</span><span>${renderInlineText(example.wrong)}</span></p>`
            }<p class="example-line example-right"><span class="example-label">正例</span><span>${renderInlineText(example.right)}</span></p></div>`
        )
        .join('');
      return `<h2 class="slide-title">${renderInlineText(slide.title)}</h2>
<div class="insight">
<p class="insight-principle">${renderInlineText(slide.principle)}</p>
<div class="insight-examples">${examples}</div>
<p class="insight-row"><span class="row-label">易错</span><span>${renderInlineText(slide.pitfall)}</span></p>
<p class="insight-row"><span class="row-label">迁移</span><span>${renderInlineText(slide.transfer)}</span></p>
</div>`;
    }
    case 'derive':
      return `<h2 class="slide-title">${renderInlineText(slide.title)}</h2>
<ol class="derive-steps">${slide.steps
        .map(
          (step, index) =>
            `<li><span class="step-num">${index + 1}</span><span class="step-text">${renderInlineText(step)}</span></li>`
        )
        .join('')}</ol>`;
    case 'quote':
      return `<h2 class="slide-title">${renderInlineText(slide.title)}</h2>
<blockquote class="quote">${renderInlineText(slide.text)}</blockquote>`;
    case 'code':
      return `<h2 class="slide-title">${renderInlineText(slide.title)}</h2>
<div class="code-block">
<div class="code-lang">${escapeHtml(slide.language)}</div>
<pre class="code"><code>${escapeHtml(slide.code)}</code></pre>
</div>`;
    case 'quiz': {
      const answerText = slide.options[slide.answer] ?? '';
      return `<h2 class="slide-title">${renderInlineText(slide.title)}</h2>
<div class="quiz" data-quiz>
<p class="quiz-question">${renderInlineText(slide.question)}</p>
<ol class="quiz-options">${slide.options
        .map(
          (option, index) =>
            `<li class="quiz-option"><span class="quiz-key">${optionKey(index)}</span><span class="quiz-text">${renderInlineText(option)}</span></li>`
        )
        .join('')}</ol>
<button type="button" class="quiz-reveal" data-reveal aria-expanded="false">显示答案</button>
<div class="quiz-answer" data-answer hidden>
<p class="quiz-result"><span class="quiz-key">${optionKey(slide.answer)}</span><span>${renderInlineText(answerText)}</span></p>
<p class="quiz-explanation">${renderInlineText(slide.explanation)}</p>
</div>
</div>`;
    }
    case 'summary':
      return `<h2 class="slide-title">${renderInlineText(slide.title)}</h2>
<ul class="summary-points">${slide.points
        .map((point) => `<li>${renderInlineText(point)}</li>`)
        .join('')}</ul>${
        slide.next === undefined
          ? ''
          : `<p class="summary-next"><span class="row-label">下一步</span><span>${renderInlineText(slide.next)}</span></p>`
      }`;
  }
}

function renderSlide(
  entry: SlideEntry,
  videoHref: string,
  frames: Map<string, string>,
  frameCache: Map<string, string>
): string {
  const { slide, chapterTitle, index } = entry;
  const active = index === 0;
  const status =
    slide.status === 'contested' ? '<span class="status-contested">待确认</span>' : '';
  const tip =
    slide.tip === undefined
      ? ''
      : `<p class="slide-tip"><span class="tip-label">复习提示</span><span>${renderInlineText(slide.tip)}</span></p>`;
  const sources = slide.sources.map((source) => renderSourceBadge(source, videoHref)).join('');
  const ariaLabel = `${SLIDE_KIND_LABELS[slide.type]}：${slide.title}`;

  return `<section class="slide slide-${slide.type}${active ? ' active' : ''}" data-index="${index}" data-chapter="${escapeHtml(chapterTitle)}" aria-label="${escapeHtml(ariaLabel)}" aria-hidden="${active ? 'false' : 'true'}">
<header class="slide-chrome">
<span class="slide-kind">${escapeHtml(SLIDE_KIND_LABELS[slide.type])}${status}</span>
<span class="chapter-tag">${renderInlineText(chapterTitle)}</span>
</header>
<div class="slide-body">
${renderSlideBody(slide, videoHref, frames, frameCache)}
</div>
<div class="slide-foot">
${tip}
<footer class="slide-sources">${sources}</footer>
</div>
</section>`;
}

/** Layout for a fixed 1280x720 stage that JavaScript scales to the window. */
const LAYOUT_CSS = `
html,body{height:100%}
body{overflow:hidden}
.deck{position:relative;display:flex;flex-direction:column;height:100vh;height:100dvh;background:var(--bg)}
.viewport{position:relative;flex:1;min-height:0;overflow:hidden}
.stage{position:absolute;top:0;left:0;width:var(--stage-w);height:var(--stage-h);transform-origin:top left;background:var(--surface);box-shadow:var(--shadow);border-radius:4px;overflow:hidden}
.slide{position:absolute;inset:0;display:flex;flex-direction:column;padding:var(--pad-top) var(--pad-x) var(--pad-bottom);background:var(--surface);opacity:0;visibility:hidden;pointer-events:none;overflow:hidden;transition:opacity .2s ease}
.slide.active{opacity:1;visibility:visible;pointer-events:auto;z-index:2}
@media (prefers-reduced-motion:reduce){.slide{transition:none}}

.slide-chrome{display:flex;align-items:center;justify-content:space-between;gap:24px;color:var(--text-faint);font-size:var(--font-caption);letter-spacing:.05em;text-transform:uppercase}
.slide-kind{display:inline-flex;align-items:center;gap:6px;font-weight:600}
.status-contested{padding:2px 8px;border-radius:999px;background:var(--orange-soft);color:var(--orange-strong);font-size:12px;font-weight:700;letter-spacing:0;text-transform:none}
.chapter-tag{max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.02em;text-transform:none;font-size:var(--font-caption)}
.slide-body{display:flex;flex-direction:column;gap:20px;margin-top:26px;min-height:0}
.slide-title{font-size:var(--font-section);line-height:var(--line-tight);letter-spacing:-.01em;font-weight:700;color:var(--text)}

.slide-cover{background:linear-gradient(150deg,var(--surface),var(--surface-muted))}
.slide-cover .slide-body{margin:auto 0;gap:16px}
.cover-title{font-size:var(--font-title);line-height:1.1;letter-spacing:-.02em;font-weight:750;color:var(--text)}
.cover-subtitle{max-width:900px;color:var(--text-muted);font-size:var(--font-subtitle);line-height:1.45}

.slide-section .slide-body{justify-content:center;gap:18px}
.section-title{font-size:var(--font-title);line-height:1.12}
.section-lead{max-width:920px;color:var(--text-muted);font-size:var(--font-subtitle);line-height:1.5}

.agenda-list{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.agenda-list li{display:flex;gap:14px;align-items:baseline;padding:12px 18px;border:1px solid var(--line);border-radius:12px;background:var(--surface-muted);font-size:var(--font-small);line-height:1.45}
.agenda-num{flex:0 0 auto;color:var(--teal-strong);font-size:14px;font-weight:700;font-variant-numeric:tabular-nums}

.points-list{display:flex;flex-direction:column;gap:14px;font-size:var(--font-body)}
.point{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap}
.point::before{content:"";width:10px;height:10px;flex:0 0 auto;border-radius:50%;background:var(--teal);transform:translateY(-2px)}
.point-text{flex:1 1 auto;min-width:0}
.point-source{flex:0 0 auto}

.passage{display:flex;flex-direction:column;gap:8px;padding:22px 26px;border-left:4px solid var(--teal);border-radius:0 14px 14px 0;background:var(--surface-muted);font-size:var(--font-small);line-height:1.7}
.passage-line{white-space:pre-wrap}

.figure{display:flex;flex-direction:column;align-items:center;gap:14px;min-height:0}
.figure img{max-width:100%;max-height:390px;border:1px solid var(--line);border-radius:12px;object-fit:contain;background:var(--surface-muted)}
.figure-captions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 20px;color:var(--text-muted);font-size:var(--font-caption);line-height:1.5}
.figure-caption{position:relative;padding-left:14px}
.figure-caption::before{content:"";position:absolute;left:0;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--teal)}

.compare{display:grid;grid-template-columns:repeat(var(--compare-cols,2),minmax(0,1fr));gap:24px}
.compare-col{padding:20px 24px;border:1px solid var(--line);border-radius:14px;background:var(--surface-muted)}
.compare-heading{margin-bottom:10px;color:var(--teal-strong);font-size:var(--font-body);font-weight:700}
.compare-col:nth-child(2) .compare-heading{color:var(--orange-strong)}
.compare-items{display:flex;flex-direction:column;gap:8px;font-size:var(--font-small);line-height:1.55}
.compare-items li{position:relative;padding-left:16px}
.compare-items li::before{content:"";position:absolute;left:0;top:.62em;width:6px;height:6px;border-radius:50%;background:var(--orange)}

.insight{display:flex;flex-direction:column;gap:14px;font-size:var(--font-small);line-height:1.6}
.insight-principle{font-size:var(--font-body);font-weight:600;color:var(--teal-strong)}
.insight-examples{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.insight-example{display:flex;flex-direction:column;gap:8px;padding:14px 18px;border:1px solid var(--line);border-radius:12px;background:var(--surface-muted)}
.example-line,.insight-row{display:flex;align-items:baseline;gap:10px}
.example-label,.row-label{flex:0 0 auto;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.02em}
.example-wrong .example-label{background:var(--orange-soft);color:var(--orange-strong)}
.example-right .example-label{background:var(--teal-soft);color:var(--teal-strong)}
.row-label{border:1px solid var(--line);background:var(--surface-muted);color:var(--text-muted)}

.derive-steps{display:flex;flex-direction:column;gap:14px;font-size:var(--font-body)}
.derive-steps li{display:flex;align-items:baseline;gap:16px}
.step-num{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;flex:0 0 auto;border-radius:50%;background:var(--teal-soft);color:var(--teal-strong);font-size:16px;font-weight:700}
.step-text{min-width:0}

.quote{padding:26px 32px;border-left:5px solid var(--orange);border-radius:0 16px 16px 0;background:var(--surface-muted);color:var(--text);font-size:var(--font-subtitle);line-height:1.55}

.code-block{overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--surface-muted)}
.code-lang{padding:8px 18px;border-bottom:1px solid var(--line);color:var(--text-faint);font-size:var(--font-caption);letter-spacing:.06em;text-transform:uppercase}
.code{margin:0;padding:18px 20px;color:var(--text);font-size:var(--font-mono-size);line-height:1.5;white-space:pre-wrap;word-break:break-word}

.quiz{display:flex;flex-direction:column;gap:16px;font-size:var(--font-small);line-height:1.55}
.quiz-question{font-size:var(--font-body);font-weight:600}
.quiz-options{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.quiz-option{display:flex;align-items:baseline;gap:12px;padding:12px 18px;border:1px solid var(--line);border-radius:12px;background:var(--surface-muted)}
.quiz-key{flex:0 0 auto;font-weight:700;color:var(--teal-strong)}
.quiz-reveal{align-self:flex-start;padding:9px 22px;border:0;border-radius:999px;background:var(--teal);color:var(--surface);font-family:inherit;font-size:16px;font-weight:600;cursor:pointer}
.quiz-reveal:hover{background:var(--teal-strong)}
.quiz-reveal:focus-visible{outline:2px solid var(--orange);outline-offset:3px}
.quiz-answer{display:flex;flex-direction:column;gap:8px;padding:14px 20px;border:1px solid var(--line-strong);border-radius:12px;background:var(--teal-soft)}
.quiz-answer[hidden]{display:none}
.quiz-result{display:flex;align-items:baseline;gap:10px;font-weight:600}
.quiz-explanation{color:var(--text-muted);font-size:var(--font-caption);line-height:1.6}

.summary-points{display:flex;flex-direction:column;gap:12px;font-size:var(--font-body)}
.summary-points li{position:relative;padding-left:26px}
.summary-points li::before{content:"";position:absolute;left:0;top:.62em;width:10px;height:10px;border-radius:3px;background:var(--teal)}
.summary-next{display:flex;align-items:baseline;gap:12px;margin-top:6px;color:var(--text-muted);font-size:var(--font-small)}

.slide-foot{display:flex;flex-direction:column;gap:10px;margin-top:22px}
.slide-tip{display:flex;align-items:baseline;gap:10px;color:var(--text-muted);font-size:var(--font-caption);line-height:1.55}
.tip-label{flex:0 0 auto;padding:1px 8px;border-radius:999px;background:var(--orange-soft);color:var(--orange-strong);font-size:11px;font-weight:700;letter-spacing:.04em}
.slide-sources{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px}
.src{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border:1px solid var(--line);border-radius:999px;background:var(--surface-muted);color:var(--text-muted);line-height:1.5;font-variant-numeric:tabular-nums;white-space:nowrap}
a.src{color:var(--teal-strong)}
a.src:hover{border-color:var(--teal);background:var(--teal-soft);text-decoration:none}
.src-infer{color:var(--text-faint)}
.src-ext{border-color:var(--orange-soft);background:var(--orange-soft);color:var(--orange-strong)}

.deck-bar{display:flex;align-items:center;gap:18px;padding:12px 24px 14px;border-top:1px solid var(--line);background:var(--bg)}
.deck-chapter{max-width:34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-faint);font-size:12px}
.deck-progress{flex:1;height:4px;border-radius:999px;background:var(--line);overflow:hidden}
.deck-progress span{display:block;width:0;height:100%;border-radius:999px;background:var(--teal);transition:width .2s ease}
.deck-count{min-width:64px;color:var(--text-muted);font-size:13px;text-align:right;font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){.deck-progress span{transition:none}}

@page{size:13.333in 7.5in;margin:0}
@media print{
  html,body{height:auto;overflow:visible;background:#fff}
  .deck{display:block;height:auto;background:#fff}
  .viewport{display:block;overflow:visible}
  .stage{position:static;width:13.333in;height:auto;transform:none !important;border-radius:0;box-shadow:none;overflow:visible}
  .slide{position:relative;inset:auto;width:13.333in;height:7.5in;opacity:1;visibility:visible;pointer-events:auto;overflow:hidden;page-break-after:always;break-after:page;transition:none}
  .slide:last-child{page-break-after:auto;break-after:auto}
  .deck-bar{display:none}
  .quiz-reveal{display:none}
  .quiz-answer[hidden]{display:flex}
}
`;

/** Slide navigation, hash restore, quiz reveal and layout measurement. */
const DECK_SCRIPT = `
(function () {
  'use strict';
  var STAGE_W = 1280;
  var STAGE_H = 720;
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  if (slides.length === 0) return;
  var stage = document.getElementById('stage');
  var viewport = document.getElementById('viewport');
  if (!stage || !viewport) return;
  var counter = document.querySelector('[data-count]');
  var progress = document.querySelector('[data-progress]');
  var chapterLabel = document.querySelector('[data-chapter]');
  var current = 0;
  var scale = 1;
  var lastSwipe = 0;
  var pointerX = null;
  var pointerY = null;

  function fit() {
    var rect = viewport.getBoundingClientRect();
    var next = Math.min(rect.width / STAGE_W, rect.height / STAGE_H);
    if (!isFinite(next) || next <= 0) return;
    scale = next;
    var x = (rect.width - STAGE_W * scale) / 2;
    var y = (rect.height - STAGE_H * scale) / 2;
    stage.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + scale + ')';
  }

  function go(index, options) {
    options = options || {};
    var next = Math.max(0, Math.min(slides.length - 1, index));
    current = next;
    for (var i = 0; i < slides.length; i++) {
      var slide = slides[i];
      var active = i === next;
      slide.classList.toggle('active', active);
      slide.setAttribute('aria-hidden', active ? 'false' : 'true');
      if (active) slide.removeAttribute('inert');
      else slide.setAttribute('inert', '');
    }
    if (counter) counter.textContent = (next + 1) + ' / ' + slides.length;
    if (progress) progress.style.width = (((next + 1) / slides.length) * 100) + '%';
    if (chapterLabel) chapterLabel.textContent = slides[next].getAttribute('data-chapter') || '';
    if (options.hash !== false) {
      try { history.replaceState(null, '', '#' + (next + 1)); } catch (error) {}
    }
  }

  function next() { if (current < slides.length - 1) go(current + 1); }
  function prev() { if (current > 0) go(current - 1); }

  function fromHash() {
    var match = /^#(\\d+)$/.exec(window.location.hash);
    if (!match) return 0;
    return Math.max(0, Math.min(slides.length - 1, Number(match[1]) - 1));
  }

  function setAnswer(root, open) {
    var answer = root.querySelector('.quiz-answer');
    var button = root.querySelector('.quiz-reveal');
    if (!answer) return;
    if (open) answer.removeAttribute('hidden');
    else answer.setAttribute('hidden', '');
    if (button) {
      button.textContent = open ? '隐藏答案' : '显示答案';
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || target.nodeType !== 1) return;
    var button = target.closest('.quiz-reveal');
    if (!button) return;
    var quiz = button.closest('.quiz');
    if (!quiz) return;
    var answer = quiz.querySelector('.quiz-answer');
    if (!answer) return;
    event.preventDefault();
    setAnswer(quiz, answer.hasAttribute('hidden'));
  });

  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    var target = event.target;
    var interactive = target && target.nodeType === 1 &&
      target.closest('button, a, input, textarea, select, [contenteditable="true"]');
    var key = event.key;
    if (key === 'ArrowRight' || key === 'PageDown') { event.preventDefault(); next(); return; }
    if (key === 'ArrowLeft' || key === 'PageUp') { event.preventDefault(); prev(); return; }
    if (key === ' ') {
      if (interactive) return;
      event.preventDefault();
      next();
      return;
    }
    if (key === 'Home') { event.preventDefault(); go(0); return; }
    if (key === 'End') { event.preventDefault(); go(slides.length - 1); return; }
    if (key === 'Enter') {
      if (interactive) return;
      var active = slides[current];
      if (active && active.querySelector('.quiz-answer[hidden]')) {
        event.preventDefault();
        setAnswer(active, true);
      }
    }
  });

  viewport.addEventListener('click', function (event) {
    if (event.button !== 0) return;
    if (Date.now() - lastSwipe < 400) return;
    var target = event.target;
    if (target && target.nodeType === 1 && target.closest('a, button, input, textarea, select, label')) return;
    if (window.getSelection && String(window.getSelection()) !== '') return;
    var rect = viewport.getBoundingClientRect();
    var x = event.clientX - rect.left;
    if (x < rect.width * 0.28) prev();
    else if (x > rect.width * 0.72) next();
  });

  viewport.addEventListener('pointerdown', function (event) {
    if (event.pointerType === 'mouse') return;
    pointerX = event.clientX;
    pointerY = event.clientY;
  });
  viewport.addEventListener('pointerup', function (event) {
    if (pointerX === null) return;
    var dx = event.clientX - pointerX;
    var dy = event.clientY - pointerY;
    pointerX = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      lastSwipe = Date.now();
      if (dx < 0) next();
      else prev();
    }
  });
  viewport.addEventListener('pointercancel', function () { pointerX = null; });

  window.addEventListener('hashchange', function () {
    go(fromHash(), { hash: false });
  });
  window.addEventListener('resize', fit);

  // Used by the BrowserWindow layout step: the bottom of the lowest visible
  // element on each slide, in unscaled stage coordinates (720 means clipped).
  window.__deckLayout = function () {
    var stageRect = stage.getBoundingClientRect();
    var factor = scale > 0 ? scale : 1;
    var result = [];
    for (var i = 0; i < slides.length; i++) {
      var slide = slides[i];
      var bottom = 0;
      var nodes = slide.querySelectorAll('*');
      for (var j = 0; j < nodes.length; j++) {
        var node = nodes[j];
        var style = window.getComputedStyle(node);
        if (style.display === 'none') continue;
        var rect = node.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        var nodeBottom = (rect.bottom - stageRect.top) / factor;
        if (nodeBottom > bottom) bottom = nodeBottom;
      }
      result.push({ index: i, bottom: Math.round(bottom * 100) / 100 });
    }
    return { slides: result };
  };

  fit();
  go(fromHash(), { hash: false });
})();
`;

/**
 * Renders one complete HTML document. Throws `DeckValidationError` when a
 * `figure` references a frame that is not in `options.frames`.
 */
export function renderDeck(deck: Deck, options: RenderDeckOptions): string {
  validateDeck(deck, { framePaths: options.frames.keys() });
  const videoHref = pathToFileURL(options.sourcePath).href;
  const entries = flattenDeck(deck);
  const frameCache = new Map<string, string>();
  const slides = entries
    .map((entry) => renderSlide(entry, videoHref, options.frames, frameCache))
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${escapeHtml(deck.title)} · 完整课件</title>
<style>${themeCss}${LAYOUT_CSS}</style>
</head>
<body>
<div class="deck">
<main class="viewport" id="viewport" aria-label="课件">
<div class="stage" id="stage">
${slides}
</div>
</main>
<footer class="deck-bar" aria-label="翻页控制">
<span class="deck-chapter" data-chapter>${escapeHtml(deck.chapters[0]?.title ?? '')}</span>
<div class="deck-progress" role="progressbar" aria-label="阅读进度" aria-valuemin="1" aria-valuemax="${entries.length}" aria-valuenow="1"><span data-progress></span></div>
<span class="deck-count" data-count aria-live="polite">1 / ${entries.length}</span>
</footer>
</div>
<script>${DECK_SCRIPT}</script>
</body>
</html>`;
}
