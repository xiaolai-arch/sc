import { pathToFileURL } from 'node:url';
import {
  renderIndexHtml,
  renderLessonHtml
} from '../../src/main/video-notes/html';

const sourcePath = 'C:\\Users\\34191\\courses\\01-集合.mp4';
const videoHref = pathToFileURL(sourcePath).href;

function lesson(markdown: string): string {
  return renderLessonHtml({
    title: '第一讲 集合',
    sourcePath,
    durationSeconds: 3725,
    transcriptChars: 12_345,
    transcriptModel: 'mimo-v2.5-asr',
    generatedAt: '2026-11-08',
    markdown
  });
}

describe('lesson HTML', () => {
  test('escapes raw HTML instead of rendering it', () => {
    const html = lesson('## 一、概念\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>');

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('drops unsafe link schemes but keeps the label', () => {
    const html = lesson(
      '## 一、链接\n\n[正常](https://example.com)\n\n[坏](javascript:alert(1))\n\n[混淆](java\nscript:alert(2))'
    );

    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('正常');
    expect(html).toContain('坏');
  });

  test('turns timestamp markers into seek links to the local video', () => {
    const html = lesson('## 一、集合 [01:05]\n\n重点在 [12:34]。');

    expect(html).toContain(`href="${videoHref}#t=65"`);
    expect(html).toContain(`href="${videoHref}#t=754"`);
    expect(html).toContain('打开原视频');
  });

  test('does not rewrite timestamps inside a code fence', () => {
    const html = lesson('## 一、代码\n\n```\n[01:05] 保持原样\n```');

    expect(html).toContain('[01:05] 保持原样');
    expect(html).not.toContain('#t=65');
  });

  test('turns each level-2 section into a slide with an agenda', () => {
    const html = lesson('## 一、总览\n\n### 细节\n\n内容\n\n## 二、练习\n\n更多');

    expect(html).toContain('class="slide cover');
    expect(html).toContain('class="slide agenda');
    expect(html.match(/class="slide content-slide/g)).toHaveLength(2);
    expect(html).toContain('<h2>一、总览</h2>');
    expect(html).toContain('<h2>二、练习</h2>');
    expect(html).toContain('data-goto="2"');
    expect(html).toContain('data-goto="3"');
    expect(html).toContain('aria-label="第 1 节：一、总览"');
  });

  test('ships keyboard, button and progress navigation', () => {
    const html = lesson('## 一、集合\n\n正文');

    expect(html).toContain('ArrowRight');
    expect(html).toContain('PageDown');
    expect(html).toContain('data-prev');
    expect(html).toContain('data-next');
    expect(html).toContain('aria-valuemax="4"');
    expect(html).toContain('class="deck-progress"');
  });

  test('renders a self-contained dark-mode page', () => {
    const html = lesson('## 一、集合\n\n正文');

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('prefers-color-scheme:dark');
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
  });
});

describe('course index HTML', () => {
  test('links every lesson and escapes metadata', () => {
    const html = renderIndexHtml({
      title: '高数 <入门>',
      generatedAt: '2026-11-08',
      lessons: [
        {
          folder: '01-集合',
          title: '第一讲 <集合>',
          durationSeconds: 1800,
          transcriptChars: 5000,
          noteChars: 800,
          summary: '讲了集合的 "基本" 概念。'
        },
        {
          folder: '02-函数',
          title: '第二讲 函数',
          durationSeconds: 2400,
          transcriptChars: 7000,
          noteChars: 900,
          summary: '函数定义域。'
        }
      ]
    });

    expect(html).toContain('高数 &lt;入门&gt;');
    expect(html).toContain('第一讲 &lt;集合&gt;');
    expect(html).toContain('讲了集合的 &quot;基本&quot; 概念。');
    expect(html).toContain('./01-%E9%9B%86%E5%90%88/notes.html');
    expect(html).toContain('./02-%E5%87%BD%E6%95%B0/notes.html');
    expect(html).toContain('共 <strong>2</strong> 讲');
    expect(html).toContain('1:10:00');
    // The index-specific card CSS must be present, not only the shared CSS.
    expect(html).toContain('.card:hover');
  });
});
