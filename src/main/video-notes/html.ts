export interface IndexLesson {
  folder: string;
  title: string;
  durationSeconds: number;
  /** Legacy v1/v2 lessons only; v3 decks count screen reads instead. */
  transcriptChars: number;
  noteChars: number;
  /** Present for v3 lessons: how many frames carried readable text. */
  screenReadCount?: number;
  summary: string;
  /** Deck lessons link to their slides first; legacy quick lessons keep notes.html. */
  mode?: 'quick' | 'deck';
  /** File names inside the lesson folder, e.g. `slides.html`. */
  slidesFile?: string | null;
  pdfFile?: string | null;
  reportFile?: string | null;
}

export interface CourseIndexInput {
  title: string;
  generatedAt: string;
  lessons: IndexLesson[];
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

/**
 * Restricts a model-written link to safe schemes. `file:` links are only
 * allowed to the lesson's own video, so a note can never open an arbitrary
 * local path. The deck renderer keeps a mirrored copy of this rule.
 */
export function safeHref(href: string, videoHref: string): string | null {
  const value = href.trim();
  // Browsers ignore tabs/newlines inside a scheme, so check the compact form
  // too: `java\nscript:` must not slip through as a "relative" URL.
  const compact = value.replace(/[\u0000- \u007f]/g, '').toLowerCase();
  if (/javascript:|data:|vbscript:/i.test(compact)) return null;
  if (value === '' || value.startsWith('#')) return value;
  if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value)) return value;
  // file: links are only allowed for the lesson's own video.
  if (/^file:/i.test(value) && (videoHref === '' || value.startsWith(videoHref))) return value;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return null;
}

const BASE_CSS = `
:root{--bg:#fbfbfd;--panel:#fff;--text:#1d1d1f;--muted:#6e6e73;--faint:#86868b;--line:rgba(0,0,0,.09);--soft:#f5f5f7;--accent:#0071e3;--accent-soft:rgba(0,113,227,.09);--radius:18px}
@media (prefers-color-scheme:dark){:root{--bg:#0f0f10;--panel:#1c1c1e;--text:#f5f5f7;--muted:#a1a1a6;--faint:#8e8e93;--line:rgba(255,255,255,.1);--soft:#242426;--accent:#4da3ff;--accent-soft:rgba(10,132,255,.18)}}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:24px}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.8 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.page{max-width:1180px;margin:0 auto;padding:40px 24px 80px}
.hero{padding:8px 0 28px;border-bottom:1px solid var(--line)}
.eyebrow{display:flex;align-items:center;gap:8px;color:var(--faint);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.eyebrow .dot{width:6px;height:6px;border-radius:50%;background:var(--accent)}
h1{margin:12px 0 10px;font-size:38px;line-height:1.2;letter-spacing:-.02em;font-weight:650}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:999px;background:var(--soft);color:var(--muted);font-size:12.5px}
.chip strong{color:var(--text);font-weight:600}
.hero-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
.button{display:inline-flex;align-items:center;gap:7px;min-height:38px;padding:0 16px;border-radius:999px;background:var(--accent);color:#fff;font-size:13.5px;font-weight:600;transition:transform .16s ease,opacity .16s ease}
.button.secondary{background:var(--soft);color:var(--text)}
.button:hover{opacity:.88;text-decoration:none;transform:translateY(-1px)}
.footer{margin-top:64px;padding-top:20px;border-top:1px solid var(--line);color:var(--faint);font-size:12.5px}
@media print{body{background:#fff;color:#000}.page{max-width:none;padding:0}a{color:#000}}
`;

function shell(options: {
  title: string;
  bodyClass: string;
  content: string;
  extraCss?: string;
}): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(options.title)}</title>
<style>${BASE_CSS}${options.extraCss ?? ''}</style>
</head>
<body class="${options.bodyClass}">
${options.content}
</body>
</html>`;
}

export function renderIndexHtml(input: CourseIndexInput): string {
  const totalDuration = input.lessons.reduce((sum, lesson) => sum + lesson.durationSeconds, 0);
  const totalChars = input.lessons.reduce((sum, lesson) => sum + lesson.transcriptChars, 0);
  const totalScreenReads = input.lessons.reduce(
    (sum, lesson) => sum + (lesson.screenReadCount ?? 0),
    0
  );
  // v3 lessons have no transcript; the header counts what they do have.
  const hasScreenReads = input.lessons.some((lesson) => lesson.screenReadCount !== undefined);
  const cards = input.lessons
    .map((lesson, index) => {
      const folder = encodeURIComponent(lesson.folder);
      const slides = lesson.slidesFile ? encodeURIComponent(lesson.slidesFile) : null;
      const pdf = lesson.pdfFile ? encodeURIComponent(lesson.pdfFile) : null;
      const report = lesson.reportFile ? encodeURIComponent(lesson.reportFile) : null;
      // The card title opens the reading artifact: slides for decks, notes.html
      // for legacy quick notes (which is what older lessons have).
      const primary = slides !== null ? `./${folder}/${slides}` : `./${folder}/notes.html`;
      const links = [
        slides !== null ? `<a href="./${folder}/${slides}">浏览课件</a>` : '',
        // Deck lessons have no notes.html; legacy quick lessons still do.
        lesson.mode === 'deck' ? '' : `<a href="./${folder}/notes.html">阅读笔记</a>`,
        `<a href="./${folder}/notes.md">Markdown</a>`,
        pdf !== null ? `<a href="./${folder}/${pdf}">PDF</a>` : '',
        report !== null ? `<a href="./${folder}/${report}">质量报告</a>` : ''
      ].filter((link) => link !== '');
      const countLabel =
        lesson.screenReadCount !== undefined
          ? `${lesson.screenReadCount.toLocaleString('zh-CN')} 条画面文字`
          : `${lesson.transcriptChars.toLocaleString('zh-CN')} 字转录`;
      return `<article class="card" style="--i:${index}">
  <div class="card-num">${String(index + 1).padStart(2, '0')}</div>
  <h2><a href="${primary}">${escapeHtml(lesson.title)}</a></h2>
  <p class="card-summary">${escapeHtml(lesson.summary)}</p>
  <div class="card-meta">
    <span>${formatDuration(lesson.durationSeconds)}</span>
    <span>${countLabel}</span>
    <span>${lesson.noteChars.toLocaleString('zh-CN')} 字笔记</span>
  </div>
  <div class="card-links">
    ${links.join('\n    ')}
  </div>
</article>`;
    })
    .join('\n');

  const countChip = hasScreenReads
    ? `<span class="chip">画面文字 <strong>${totalScreenReads.toLocaleString('zh-CN')}</strong> 条</span>`
    : `<span class="chip">转录 <strong>${totalChars.toLocaleString('zh-CN')}</strong> 字</span>`;
  const content = `<div class="page index-page">
<header class="hero">
  <div class="eyebrow"><span class="dot"></span>课程索引 · ${escapeHtml(input.generatedAt)}</div>
  <h1>${escapeHtml(input.title)}</h1>
  <div class="meta">
    <span class="chip">共 <strong>${input.lessons.length}</strong> 讲</span>
    <span class="chip">总时长 <strong>${formatDuration(totalDuration)}</strong></span>
    ${countChip}
  </div>
  <p class="index-intro">每讲是一份按画面内容分页的课件，带来源标记、补充卡片和质量报告。点击课程卡片开始浏览；带时间的标记可直接跳回原视频。</p>
</header>
<section class="cards">
${cards}
</section>
<footer class="footer">由 ASAKI 视频转课件生成 · ${escapeHtml(input.generatedAt)}</footer>
</div>`;

  const indexCss = `
.index-intro{margin:22px 0 0;max-width:640px;color:var(--muted);font-size:14.5px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:18px;margin-top:32px}
.card{position:relative;display:flex;flex-direction:column;padding:24px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);transition:transform .18s ease,box-shadow .18s ease;animation:rise .45s ease both;animation-delay:calc(var(--i) * 35ms)}
.card:hover{transform:translateY(-3px);box-shadow:0 14px 34px rgba(0,0,0,.08)}
@media (prefers-color-scheme:dark){.card:hover{box-shadow:0 14px 34px rgba(0,0,0,.4)}}
.card-num{color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.12em}
.card h2{margin:10px 0 8px;font-size:19px;line-height:1.4;letter-spacing:-.01em}
.card h2 a{color:var(--text)}
.card-summary{margin:0;color:var(--muted);font-size:13.5px;line-height:1.7;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:16px;color:var(--faint);font-size:12px}
.card-links{display:flex;gap:16px;margin-top:auto;padding-top:18px;font-size:13px;font-weight:600}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.card{animation:none}}
`;
  return shell({
    title: `${input.title} · 课程索引`,
    bodyClass: 'index',
    content,
    extraCss: indexCss
  });
}
