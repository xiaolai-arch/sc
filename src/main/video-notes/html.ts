import { Renderer, marked, type Tokens } from 'marked';
import { pathToFileURL } from 'node:url';

export interface LessonHtmlInput {
  title: string;
  sourcePath: string;
  durationSeconds: number;
  transcriptChars: number;
  transcriptModel: string;
  generatedAt: string;
  markdown: string;
}

export interface IndexLesson {
  folder: string;
  title: string;
  durationSeconds: number;
  transcriptChars: number;
  noteChars: number;
  summary: string;
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

function parseTimestamp(value: string): number {
  const parts = value.split(':').map(Number);
  if (parts.length === 3) return (parts[0]! * 3600) + (parts[1]! * 60) + parts[2]!;
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

function safeHref(href: string, videoHref: string): string | null {
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

/** Turns `[12:34]` into a link that jumps to that point in the source video. */
function linkTimestamps(markdown: string, videoHref: string): string {
  if (!videoHref) return markdown;
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\](?!\()/g, (_match, timestamp: string) => {
        const seconds = parseTimestamp(timestamp);
        return `[\\[${timestamp}\\]](video-href#t=${seconds})`.replace(
          'video-href',
          videoHref
        );
      });
    })
    .join('\n');
}

const renderer = new Renderer();
renderer.html = ({ text }) => escapeHtml(text);
renderer.image = ({ text }) =>
  `<span class="image-note">［图片${text ? `：${escapeHtml(text)}` : ''}］</span>`;
renderer.link = function (this: Renderer, token: Tokens.Link): string {
  const label = this.parser.parseInline(token.tokens);
  const videoHref = (this.options as unknown as Record<string, unknown>)['videoHref'];
  const safe = safeHref(token.href, typeof videoHref === 'string' ? videoHref : '');
  if (safe === null) return label;
  const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
  const external = /^https?:/i.test(safe) ? ' target="_blank" rel="noreferrer"' : '';
  return `<a href="${escapeHtml(safe)}"${title}${external}>${label}</a>`;
};

function markdownToHtml(markdown: string, videoHref: string): string {
  // `videoHref` is threaded through the renderer options so link() can restrict
  // file: URLs to the lesson's own video without a module-level mutable.
  return marked.parse(linkTimestamps(markdown, videoHref), {
    async: false,
    renderer,
    videoHref
  } as Parameters<typeof marked.parse>[1]) as string;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

interface TocEntry {
  level: number;
  id: string;
  text: string;
}

function addHeadingAnchors(html: string): { html: string; toc: TocEntry[] } {
  const toc: TocEntry[] = [];
  const withIds = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_match, level: string, inner: string) => {
    const id = `section-${toc.length + 1}`;
    toc.push({ level: Number(level), id, text: stripTags(inner) });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
  return { html: withIds, toc };
}

function renderToc(toc: TocEntry[], className = ''): string {
  if (toc.length === 0) return '';
  return `<nav class="toc ${className}" aria-label="目录"><p class="toc-title">目录</p><ol>${toc
    .map(
      (entry) =>
        `<li class="toc-l${entry.level}"><a href="#${entry.id}">${escapeHtml(entry.text)}</a></li>`
    )
    .join('')}</ol></nav>`;
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
.layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:56px;margin-top:36px}
.toc{position:sticky;top:24px;align-self:start;max-height:calc(100vh - 48px);overflow:auto;padding-right:8px}
.toc-title{margin:0 0 10px;color:var(--faint);font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase}
.toc ol{list-style:none;margin:0;padding:0}
.toc li{margin:2px 0}
.toc a{display:block;padding:4px 10px;border-left:2px solid transparent;border-radius:0 8px 8px 0;color:var(--muted);font-size:13px;line-height:1.45}
.toc a:hover{background:var(--soft);color:var(--text);text-decoration:none}
.toc .toc-l3 a{padding-left:22px;font-size:12.5px;color:var(--faint)}
.content{min-width:0;max-width:820px}
.content h2{margin:46px 0 14px;padding-top:26px;border-top:1px solid var(--line);font-size:27px;line-height:1.35;letter-spacing:-.015em;font-weight:650}
.content h2:first-child{margin-top:0;padding-top:0;border-top:0}
.content h3{margin:30px 0 10px;font-size:19.5px;line-height:1.45;font-weight:620}
.content h2 a,.content h3 a{color:inherit}
.content h2 a:hover,.content h3 a:hover{color:var(--accent);text-decoration:none}
.content p{margin:0 0 15px}
.content ul,.content ol{margin:0 0 16px;padding-left:24px}
.content li{margin:5px 0}
.content li>p{margin:0}
blockquote{margin:18px 0;padding:12px 18px;border-left:3px solid var(--accent);border-radius:0 12px 12px 0;background:var(--accent-soft);color:var(--text)}
blockquote p:last-child{margin-bottom:0}
code{font-family:"SF Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em;padding:2px 6px;border-radius:6px;background:var(--soft)}
pre{padding:16px 18px;border-radius:14px;background:var(--soft);overflow:auto;line-height:1.55}
pre code{padding:0;background:none}
table{width:100%;border-collapse:collapse;margin:16px 0 22px;font-size:14.5px}
th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{background:var(--soft);font-weight:600;color:var(--muted);font-size:12.5px;letter-spacing:.02em}
tr:last-child td{border-bottom:0}
a[href*="#t="]{display:inline-block;padding:1px 6px;border-radius:6px;background:var(--accent-soft);font-size:.85em;font-variant-numeric:tabular-nums;color:var(--accent)}
a[href*="#t="]:hover{text-decoration:none;background:var(--accent);color:#fff}
.image-note{color:var(--faint);font-size:13px}
.footer{margin-top:64px;padding-top:20px;border-top:1px solid var(--line);color:var(--faint);font-size:12.5px}
.toc-mobile{display:none;margin-top:28px;padding:14px 16px;border-radius:14px;background:var(--panel);border:1px solid var(--line)}
.toc-mobile summary{cursor:pointer;font-weight:600;font-size:14px}
.toc-mobile .toc{position:static;max-height:none;margin-top:10px}
@media (max-width:960px){.layout{display:block;margin-top:24px}.toc{display:none}.toc-mobile{display:block}.content{max-width:none}h1{font-size:31px}}
@media print{body{background:#fff;color:#000}.toc,.toc-mobile,.hero-actions{display:none}.page{max-width:none;padding:0}.layout{display:block}.content h2{page-break-after:avoid}.content h2,.content h3{break-after:avoid}table,blockquote{break-inside:avoid}a{color:#000}}
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

export function renderLessonHtml(input: LessonHtmlInput): string {
  const videoHref = pathToFileURL(input.sourcePath).href;
  const rendered = addHeadingAnchors(markdownToHtml(input.markdown, videoHref));
  const toc = renderToc(rendered.toc);
  const mobileToc = renderToc(rendered.toc, 'mobile');
  const content = `<div class="page">
<header class="hero">
  <div class="eyebrow"><span class="dot"></span>视频笔记 · ${escapeHtml(input.generatedAt)}</div>
  <h1>${escapeHtml(input.title)}</h1>
  <div class="meta">
    <span class="chip">时长 <strong>${formatDuration(input.durationSeconds)}</strong></span>
    <span class="chip">转录 <strong>${input.transcriptChars.toLocaleString('zh-CN')}</strong> 字</span>
    <span class="chip">${escapeHtml(input.transcriptModel)}</span>
  </div>
  <div class="hero-actions">
    <a class="button" href="${escapeHtml(videoHref)}">打开原视频</a>
    <a class="button secondary" href="./notes.md">Markdown 源文件</a>
  </div>
</header>
<details class="toc-mobile"><summary>目录</summary>${mobileToc}</details>
<div class="layout">
  ${toc}
  <main class="content">
${rendered.html}
    <footer class="footer">由 ASAKI 视频笔记生成 · 转录 ${escapeHtml(input.transcriptModel)} · ${escapeHtml(input.generatedAt)}</footer>
  </main>
</div>
</div>`;
  return shell({ title: `${input.title} · 视频笔记`, bodyClass: 'lesson', content });
}

export function renderIndexHtml(input: CourseIndexInput): string {
  const totalDuration = input.lessons.reduce((sum, lesson) => sum + lesson.durationSeconds, 0);
  const totalChars = input.lessons.reduce((sum, lesson) => sum + lesson.transcriptChars, 0);
  const cards = input.lessons
    .map((lesson, index) => {
      const folder = encodeURIComponent(lesson.folder);
      return `<article class="card" style="--i:${index}">
  <div class="card-num">${String(index + 1).padStart(2, '0')}</div>
  <h2><a href="./${folder}/notes.html">${escapeHtml(lesson.title)}</a></h2>
  <p class="card-summary">${escapeHtml(lesson.summary)}</p>
  <div class="card-meta">
    <span>${formatDuration(lesson.durationSeconds)}</span>
    <span>${lesson.transcriptChars.toLocaleString('zh-CN')} 字转录</span>
    <span>${lesson.noteChars.toLocaleString('zh-CN')} 字笔记</span>
  </div>
  <div class="card-links">
    <a href="./${folder}/notes.html">阅读笔记</a>
    <a href="./${folder}/notes.md">Markdown</a>
  </div>
</article>`;
    })
    .join('\n');

  const content = `<div class="page index-page">
<header class="hero">
  <div class="eyebrow"><span class="dot"></span>课程索引 · ${escapeHtml(input.generatedAt)}</div>
  <h1>${escapeHtml(input.title)}</h1>
  <div class="meta">
    <span class="chip">共 <strong>${input.lessons.length}</strong> 讲</span>
    <span class="chip">总时长 <strong>${formatDuration(totalDuration)}</strong></span>
    <span class="chip">转录 <strong>${totalChars.toLocaleString('zh-CN')}</strong> 字</span>
  </div>
  <p class="index-intro">每讲都有知识点、时间戳、术语表和复习卡片。点击课程卡片开始阅读；时间戳可直接跳回原视频。</p>
</header>
<section class="cards">
${cards}
</section>
<footer class="footer">由 ASAKI 视频笔记生成 · ${escapeHtml(input.generatedAt)}</footer>
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
