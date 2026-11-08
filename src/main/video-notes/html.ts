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

interface DeckSection {
  title: string;
  /** Inline HTML of the section heading (already sanitized by the renderer). */
  headingHtml: string;
  bodyHtml: string;
}

/** Splits the rendered note on level-2 headings: one section per slide. */
function splitSections(html: string): DeckSection[] {
  const sections: DeckSection[] = [];
  for (const chunk of html.split(/(?=<h2)/i)) {
    const trimmed = chunk.trim();
    if (trimmed.length === 0) continue;
    const match = /^<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*)$/i.exec(trimmed);
    if (match) {
      const headingHtml = match[1]!.trim();
      const title = stripTags(headingHtml).replace(/\s+/g, ' ').trim();
      sections.push({
        title: title.length > 0 ? title : '未命名小节',
        headingHtml,
        bodyHtml: match[2]!.trim()
      });
    } else {
      sections.push({ title: '概览', headingHtml: '概览', bodyHtml: trimmed });
    }
  }
  return sections;
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

const DECK_CSS = `
html,body{height:100%}
body.deck{overflow:hidden;background:var(--bg)}
body.deck::before{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(1100px 620px at 8% -10%,var(--accent-soft),transparent 62%),radial-gradient(900px 520px at 108% 112%,rgba(52,199,89,.08),transparent 60%)}
@media (prefers-color-scheme:dark){body.deck::before{background:radial-gradient(1100px 620px at 8% -10%,var(--accent-soft),transparent 62%),radial-gradient(900px 520px at 108% 112%,rgba(48,209,88,.06),transparent 60%)}}
.deck-app{position:relative;z-index:1;display:flex;flex-direction:column;height:100%}
.deck-stage{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:22px clamp(12px,3vw,40px) 8px}
.slide{position:absolute;inset:0;margin:auto;width:min(1120px,calc(100vw - 48px));height:min(690px,calc(100dvh - 132px));display:flex;flex-direction:column;padding:clamp(24px,3.4vw,52px);background:var(--panel);border:1px solid var(--line);border-radius:24px;box-shadow:0 24px 70px rgba(0,0,0,.09);opacity:0;visibility:hidden;pointer-events:none;transform:translate3d(26px,0,0) scale(.992);transition:opacity .28s ease,transform .32s cubic-bezier(.22,.8,.2,1),visibility .32s}
@media (prefers-color-scheme:dark){.slide{box-shadow:0 24px 70px rgba(0,0,0,.45)}}
.slide.active{opacity:1;visibility:visible;pointer-events:auto;transform:none;z-index:2}
.slide.before{transform:translate3d(-26px,0,0) scale(.992)}
.slide:focus{outline:none}
.slide:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
.slide-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px}
.kicker{color:var(--faint);font-size:11.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;font-variant-numeric:tabular-nums}
.kicker.deck-course{max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:none;letter-spacing:.02em;font-weight:500;font-size:12px}
.slide h1{margin:10px 0 18px;font-size:clamp(34px,4.6vw,64px);line-height:1.12;letter-spacing:-.03em;font-weight:680}
.slide h2{margin:4px 0 20px;font-size:clamp(23px,2.8vw,36px);line-height:1.3;letter-spacing:-.015em;font-weight:650}
.slide-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding-right:6px;font-size:clamp(14.5px,1.35vw,17px);line-height:1.78;scrollbar-width:thin;scrollbar-color:var(--line) transparent}
.slide-body::-webkit-scrollbar{width:6px}
.slide-body::-webkit-scrollbar-thumb{background:var(--line);border-radius:999px}
.slide-body h3{margin:22px 0 8px;font-size:clamp(17px,1.7vw,21px);font-weight:650}
.slide-body ul,.slide-body ol{margin:0 0 14px;padding-left:22px}
.slide-body li{margin:4px 0}
.slide-body p{margin:0 0 12px}
.slide-body table{font-size:clamp(12.5px,1.15vw,14px)}
.slide-body th,.slide-body td{padding:8px 10px}
.slide-body pre{font-size:clamp(11.5px,1.05vw,13px);line-height:1.6}
.slide-body blockquote{margin:14px 0}
.slide-main{flex:1;min-height:0;display:flex;flex-direction:column}
.slide-main.is-short{justify-content:center}
.slide-main.is-short .slide-body{flex:0 0 auto;overflow:visible}
.cover{justify-content:center;background:linear-gradient(145deg,var(--panel),var(--soft))}
.cover-inner{max-width:840px}
.cover-source{margin:0 0 20px;color:var(--faint);font-size:12.5px;word-break:break-all}
.cover-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:26px}
.button{border:0;cursor:pointer;font-family:inherit;font-size:13.5px}
.button.ghost{background:transparent;color:var(--muted);border:1px solid var(--line)}
.button.ghost:hover{background:var(--soft);opacity:1}
.deck-hint{margin-top:24px;color:var(--faint);font-size:12.5px;line-height:2}
.deck-hint kbd{display:inline-block;min-width:20px;margin:0 2px;padding:1px 6px;border:1px solid var(--line);border-radius:6px;background:var(--soft);color:var(--muted);font:11px/1.6 "SF Mono",ui-monospace,Menlo,Consolas,monospace;text-align:center}
.agenda-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;align-content:start;overflow:auto;overscroll-behavior:contain;min-height:0}
.agenda-list li{min-width:0}
.agenda-list button{display:flex;align-items:center;gap:12px;width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--soft);color:var(--text);text-align:left;cursor:pointer;font-family:inherit;font-size:13.5px;transition:border-color .16s ease,background .16s ease}
.agenda-list button:hover{border-color:var(--accent);background:var(--accent-soft)}
.agenda-num{color:var(--accent);font-size:11.5px;font-weight:700;letter-spacing:.08em;font-variant-numeric:tabular-nums}
.agenda-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.end{justify-content:center;align-items:flex-start}
.end h2{font-size:clamp(30px,4vw,48px)}
.end-summary{margin:0;color:var(--muted);font-size:14.5px}
.end-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
.deck-bar{display:flex;align-items:center;gap:16px;padding:0 clamp(16px,3vw,40px) max(14px,env(safe-area-inset-bottom))}
.deck-name{flex:0 1 260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--faint);font-size:12px}
.deck-controls{display:flex;align-items:center;gap:10px;flex:1;min-width:0;justify-content:flex-end}
.deck-progress{flex:1;max-width:320px;height:3px;border-radius:999px;background:var(--line);overflow:hidden}
.deck-progress span{display:block;height:100%;width:0;background:var(--accent);border-radius:999px;transition:width .3s ease}
.deck-count{min-width:52px;text-align:center;color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.deck-btn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;border:1px solid var(--line);background:var(--panel);color:var(--text);cursor:pointer;transition:background .16s ease,border-color .16s ease,opacity .16s ease}
.deck-btn:hover{background:var(--soft);border-color:var(--faint)}
.deck-btn:disabled{opacity:.3;cursor:default}
.deck-btn svg{width:18px;height:18px}
@media (max-width:760px){.slide{width:calc(100vw - 16px);height:calc(100dvh - 108px);border-radius:16px;padding:20px}.deck-stage{padding:8px 8px 4px}.deck-name{display:none}.deck-controls{gap:6px}.deck-progress{max-width:none}.slide h1{font-size:clamp(28px,9vw,42px)}.agenda-list{grid-template-columns:1fr}.deck-hint{display:none}}
@media (max-height:520px){.slide{padding:18px 22px}.slide h1{font-size:clamp(26px,6vh,40px)}}
@media (prefers-reduced-motion:reduce){.slide{transition:none}.deck-progress span{transition:none}}
@media print{html,body{height:auto;overflow:visible;background:#fff}body.deck::before{display:none}.deck-app{display:block;height:auto}.deck-stage{display:block;padding:0}.slide{position:relative;width:100%;height:auto;max-width:none;margin:0;padding:24px;border:0;border-radius:0;box-shadow:none;opacity:1;visibility:visible;transform:none;page-break-after:always}.slide:last-child{page-break-after:auto}.slide-body,.agenda-list{overflow:visible}.deck-bar{display:none}.deck-hint{display:none}}
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

const ICON_PREV =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_NEXT =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_AGENDA =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const ICON_FULLSCREEN =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Inline deck navigation. Kept dependency-free so the HTML stays offline-safe. */
const DECK_SCRIPT = `
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  if (slides.length === 0) return;
  var counter = document.querySelector('[data-count]');
  var progress = document.querySelector('[data-progress]');
  var bar = document.querySelector('.deck-progress');
  var prevBtn = document.querySelector('[data-prev]');
  var nextBtn = document.querySelector('[data-next]');
  var fullBtn = document.querySelector('[data-fullscreen]');
  var current = 0;
  var touchX = null;
  var touchY = null;

  function go(index, options) {
    options = options || {};
    var next = Math.max(0, Math.min(slides.length - 1, index));
    if (next === current && options.force !== true) return;
    slides.forEach(function (slide, i) {
      slide.classList.toggle('active', i === next);
      slide.classList.toggle('before', i < next);
      slide.classList.toggle('after', i > next);
      slide.toggleAttribute('inert', i !== next);
      slide.setAttribute('aria-hidden', i === next ? 'false' : 'true');
    });
    current = next;
    if (counter) counter.textContent = (next + 1) + ' / ' + slides.length;
    if (progress) progress.style.width = (((next + 1) / slides.length) * 100) + '%';
    if (bar) bar.setAttribute('aria-valuenow', String(next + 1));
    if (prevBtn) prevBtn.disabled = next === 0;
    if (nextBtn) nextBtn.disabled = next === slides.length - 1;
    if (options.hash !== false) {
      try { history.replaceState(null, '', '#slide-' + (next + 1)); } catch (error) {}
    }
    requestAnimationFrame(function () { centerSlide(slides[current]); });
  }

  function next() { if (current < slides.length - 1) go(current + 1); }
  function prev() { if (current > 0) go(current - 1); }

  function centerSlide(slide) {
    var main = slide.querySelector('.slide-main');
    if (!main) return;
    var body = main.querySelector('.slide-body');
    if (!body) return;
    main.classList.remove('is-short');
    if (body.scrollHeight <= body.clientHeight + 2) main.classList.add('is-short');
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-goto]'), function (element) {
    element.addEventListener('click', function () {
      go(Number(element.getAttribute('data-goto')));
    });
  });
  if (prevBtn) prevBtn.addEventListener('click', prev);
  if (nextBtn) nextBtn.addEventListener('click', next);
  var agendaBtn = document.querySelector('[data-agenda]');
  if (agendaBtn) agendaBtn.addEventListener('click', function () { go(1); });

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(function () {});
      }
    } else if (document.exitFullscreen) {
      document.exitFullscreen().catch(function () {});
    }
  }
  if (fullBtn) fullBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', function () {
    if (fullBtn) fullBtn.setAttribute('aria-pressed', document.fullscreenElement ? 'true' : 'false');
  });

  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    var key = event.key;
    var target = event.target;
    var interactive = target && target.closest && target.closest('button, a, input, textarea, select, [contenteditable="true"]');
    if (interactive && (key === ' ' || key === 'Enter')) return;
    var body = slides[current].querySelector('.slide-body, .agenda-list');

    if (key === 'ArrowRight' || key === 'PageDown' || key === ' ') {
      event.preventDefault(); next(); return;
    }
    if (key === 'ArrowLeft' || key === 'PageUp') {
      event.preventDefault(); prev(); return;
    }
    if (key === 'ArrowDown') {
      if (body && body.scrollHeight > body.clientHeight && body.scrollTop + body.clientHeight < body.scrollHeight - 4) {
        event.preventDefault();
        body.scrollBy({ top: body.clientHeight * 0.75, behavior: 'smooth' });
        return;
      }
      event.preventDefault(); next(); return;
    }
    if (key === 'ArrowUp') {
      if (body && body.scrollTop > 4) {
        event.preventDefault();
        body.scrollBy({ top: -body.clientHeight * 0.75, behavior: 'smooth' });
        return;
      }
      event.preventDefault(); prev(); return;
    }
    if (key === 'Home') { event.preventDefault(); go(0); return; }
    if (key === 'End') { event.preventDefault(); go(slides.length - 1); return; }
    if (key === 'f' || key === 'F') { event.preventDefault(); toggleFullscreen(); return; }
    if (key === 'o' || key === 'O') { event.preventDefault(); go(1); }
  });

  var stage = document.querySelector('.deck-stage');
  if (stage) {
    stage.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse') return;
      touchX = event.clientX;
      touchY = event.clientY;
    });
    stage.addEventListener('pointerup', function (event) {
      if (touchX === null) return;
      var dx = event.clientX - touchX;
      var dy = event.clientY - touchY;
      touchX = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (dx < 0) next(); else prev();
      }
    });
    stage.addEventListener('pointercancel', function () { touchX = null; });
  }

  function fromHash() {
    var match = /^#slide-(\\d+)$/.exec(window.location.hash);
    if (!match) return 0;
    var index = Number(match[1]) - 1;
    return Math.max(0, Math.min(slides.length - 1, index));
  }
  window.addEventListener('hashchange', function () {
    go(fromHash(), { hash: false });
  });
  window.addEventListener('resize', function () { centerSlide(slides[current]); });
  go(fromHash(), { hash: false, force: true });
})();
`;

export function renderLessonHtml(input: LessonHtmlInput): string {
  const videoHref = pathToFileURL(input.sourcePath).href;
  const sections = splitSections(markdownToHtml(input.markdown, videoHref));
  const total = sections.length + 3;
  const courseTitle = escapeHtml(input.title);
  const duration = formatDuration(input.durationSeconds);
  const transcriptChars = input.transcriptChars.toLocaleString('zh-CN');

  const cover = `<section class="slide cover active" data-slide="0" aria-label="封面" aria-hidden="false">
  <div class="cover-inner">
    <div class="eyebrow"><span class="dot"></span>课程笔记 · ${escapeHtml(input.generatedAt)}</div>
    <h1>${courseTitle}</h1>
    <p class="cover-source">${escapeHtml(input.sourcePath)}</p>
    <div class="meta">
      <span class="chip">时长 <strong>${duration}</strong></span>
      <span class="chip">转录 <strong>${transcriptChars}</strong> 字</span>
      <span class="chip">${escapeHtml(input.transcriptModel)}</span>
    </div>
    <div class="cover-actions">
      <button class="button" type="button" data-goto="1">开始阅读 <span aria-hidden="true">→</span></button>
      <a class="button secondary" href="${escapeHtml(videoHref)}">打开原视频</a>
      <a class="button ghost" href="./notes.md">Markdown 源文件</a>
    </div>
    <p class="deck-hint"><kbd>←</kbd><kbd>→</kbd> 翻页 · <kbd>空格</kbd> 下一页 · <kbd>F</kbd> 全屏 · <kbd>O</kbd> 目录</p>
  </div>
</section>`;

  const agendaItems = sections
    .map(
      (section, index) =>
        `<li><button type="button" data-goto="${index + 2}" title="${escapeHtml(section.title)}"><span class="agenda-num">${String(index + 1).padStart(2, '0')}</span><span class="agenda-title">${escapeHtml(section.title)}</span></button></li>`
    )
    .join('');
  const agenda = `<section class="slide agenda" data-slide="1" aria-label="目录" aria-hidden="true">
  <div class="slide-head"><span class="kicker">目录</span><span class="kicker">共 ${sections.length} 节</span></div>
  <h2>本讲内容</h2>
  <ol class="agenda-list">${agendaItems}</ol>
  <p class="deck-hint">点击标题跳转，或用 <kbd>←</kbd><kbd>→</kbd> 逐页阅读</p>
</section>`;

  const sectionSlides = sections
    .map(
      (section, index) => `<section class="slide content-slide" data-slide="${index + 2}" aria-label="第 ${index + 1} 节：${escapeHtml(section.title)}" aria-hidden="true">
  <div class="slide-head"><span class="kicker">${String(index + 1).padStart(2, '0')} / ${String(sections.length).padStart(2, '0')}</span><span class="kicker deck-course">${courseTitle}</span></div>
  <div class="slide-main">
    <h2>${section.headingHtml}</h2>
    <div class="slide-body">${section.bodyHtml}</div>
  </div>
</section>`
    )
    .join('\n');

  const end = `<section class="slide end" data-slide="${total - 1}" aria-label="结束" aria-hidden="true">
  <p class="kicker">END</p>
  <h2>本讲结束</h2>
  <p class="end-summary">${sections.length} 节知识点 · 转录 ${escapeHtml(transcriptChars)} 字 · 时长 ${duration}</p>
  <div class="end-actions">
    <button class="button" type="button" data-goto="0">回到封面</button>
    <button class="button secondary" type="button" data-goto="1">查看目录</button>
    <a class="button secondary" href="${escapeHtml(videoHref)}">打开原视频</a>
  </div>
  <p class="deck-hint">由 ASAKI 视频笔记生成 · ${escapeHtml(input.generatedAt)}</p>
</section>`;

  const bar = `<footer class="deck-bar">
  <span class="deck-name" title="${courseTitle}">${courseTitle}</span>
  <div class="deck-controls">
    <button class="deck-btn" type="button" data-prev aria-label="上一页" title="上一页 (←)">${ICON_PREV}</button>
    <div class="deck-progress" role="progressbar" aria-label="阅读进度" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="1"><span data-progress></span></div>
    <span class="deck-count" data-count aria-live="polite">1 / ${total}</span>
    <button class="deck-btn" type="button" data-agenda aria-label="打开目录" title="目录 (O)">${ICON_AGENDA}</button>
    <button class="deck-btn" type="button" data-fullscreen aria-label="全屏" aria-pressed="false" title="全屏 (F)">${ICON_FULLSCREEN}</button>
    <button class="deck-btn" type="button" data-next aria-label="下一页" title="下一页 (→)">${ICON_NEXT}</button>
  </div>
</footer>`;

  const content = `<div class="deck-app">
<div class="deck-stage">
${cover}
${agenda}
${sectionSlides}
${end}
</div>
${bar}
</div>
<script>${DECK_SCRIPT}</script>`;

  return shell({
    title: `${input.title} · 视频笔记`,
    bodyClass: 'deck',
    content,
    extraCss: DECK_CSS
  });
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
