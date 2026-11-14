import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { renderDeck } from '../../../../src/main/video-notes/deck/render';
import { parseDeck } from '../../../../src/main/video-notes/deck/schema';

const sourcePath = 'C:\\Users\\34191\\courses\\01 集合.mp4';
const videoHref = pathToFileURL(sourcePath).href;

let tempDir: string;
let frames: Map<string, string>;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'deck-render-'));
  const framePath = join(tempDir, '1.jpg');
  // Not a real image: the renderer only base64-encodes the bytes.
  writeFileSync(
    framePath,
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9])
  );
  frames = new Map([['frames/1.jpg', framePath]]);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const SLIDE_TYPES = [
  'cover',
  'agenda',
  'section',
  'points',
  'passage',
  'figure',
  'compare',
  'insight',
  'derive',
  'quote',
  'code',
  'quiz',
  'summary'
] as const;

/** A deck that uses every slide type once. `text` fills every free text field. */
function deckJson(text = '普通文本'): any {
  return {
    version: 1,
    title: '第一讲 集合',
    sourcePath,
    durationSeconds: 3725,
    chapters: [
      {
        title: '一、基础',
        start: 0,
        slides: [
          {
            type: 'cover',
            id: 'cover',
            title: text,
            subtitle: text,
            sources: [{ kind: 'video', t: 0 }]
          },
          {
            type: 'agenda',
            id: 'agenda',
            title: text,
            items: [text, '第二个条目'],
            sources: [{ kind: 'infer' }]
          },
          {
            type: 'section',
            id: 'section',
            title: text,
            lead: text,
            sources: [{ kind: 'video', t: 10 }]
          },
          {
            type: 'points',
            id: 'points',
            title: text,
            sources: [{ kind: 'video', t: 65 }],
            points: [
              { text, source: { kind: 'screen', t: 70 } },
              { text: '第二点', source: { kind: 'video', t: 80 } }
            ]
          },
          {
            type: 'passage',
            id: 'passage',
            title: text,
            lines: [text, '第二行'],
            sources: [{ kind: 'screen', t: 90 }]
          },
          {
            type: 'figure',
            id: 'figure',
            title: text,
            sources: [{ kind: 'screen', t: 100 }],
            frame: 'frames/1.jpg',
            keepImage: true,
            captions: [text]
          },
          {
            type: 'compare',
            id: 'compare',
            title: text,
            sources: [{ kind: 'infer' }],
            columns: [
              { heading: text, items: [text] },
              { heading: '第二栏', items: [text] }
            ]
          },
          {
            type: 'insight',
            id: 'insight',
            title: text,
            sources: [{ kind: 'infer' }],
            principle: text,
            examples: [
              { wrong: text, right: text },
              { right: text }
            ],
            pitfall: text,
            transfer: text
          }
        ]
      },
      {
        title: '二、练习',
        start: 1800,
        slides: [
          {
            type: 'derive',
            id: 'derive',
            title: text,
            sources: [{ kind: 'infer' }],
            steps: [text, text]
          },
          {
            type: 'quote',
            id: 'quote',
            title: text,
            sources: [{ kind: 'video', t: 200 }],
            text
          },
          {
            type: 'code',
            id: 'code',
            title: text,
            sources: [{ kind: 'infer' }],
            language: 'ts',
            code: 'const x = 1;\nconsole.log(x);'
          },
          {
            type: 'quiz',
            id: 'quiz',
            title: text,
            sources: [{ kind: 'screen', t: 300 }],
            question: text,
            options: [text, text, '第三个选项'],
            answer: 2,
            explanation: text
          },
          {
            type: 'summary',
            id: 'summary',
            title: text,
            sources: [{ kind: 'ext', title: '牛津词典', page: 3 }],
            points: [text],
            next: text
          }
        ]
      }
    ]
  };
}

function render(text = '普通文本'): string {
  const deck = parseDeck(deckJson(text));
  return renderDeck(deck, { sourcePath, frames });
}

describe('deck renderer', () => {
  test('renders every slide type exactly once', () => {
    const html = render();

    for (const type of SLIDE_TYPES) {
      expect(html).toContain(`slide-${type}`);
    }
    expect(html.match(/class="slide /g)).toHaveLength(SLIDE_TYPES.length);
  });

  test('emits the exact CSP and no network references', () => {
    const html = render();

    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">`
    );
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('name="viewport"');
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toMatch(/<link\b/i);
  });

  test('escapes raw HTML in every text field and applies only bold/highlight', () => {
    const poison = '<script>alert(1)</script> & "引号" **粗体** ==重点== __原样__ `代码`';
    const html = render(poison);
    const escaped = '&lt;script&gt;alert(1)&lt;/script&gt;';

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain(escaped);
    expect(html).toContain('&amp; &quot;引号&quot;');
    // The text lands in dozens of fields; make sure we exercised more than one.
    expect((html.match(new RegExp(escaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length).toBeGreaterThan(10);
    expect(html).toContain('<strong>粗体</strong>');
    expect(html).toContain('<mark>重点</mark>');
    expect(html).toContain('__原样__');
    expect(html).toContain('`代码`');
    expect(html).not.toContain('<em>');
  });

  test('inlines the figure as a data URI', () => {
    const html = render();

    expect(html).toContain('src="data:image/jpeg;base64,');
    expect(html).toContain('decoding="sync"');
  });

  test('builds seek links for video and screen sources', () => {
    const html = render();

    expect(videoHref).toContain('%20');
    expect(html).toContain(`href="${videoHref}#t=0"`);
    expect(html).toContain(`href="${videoHref}#t=65"`);
    expect(html).toContain(`href="${videoHref}#t=70"`);
    expect(html).toContain('视频 01:05');
    expect(html).toContain('画面 01:10');
    expect(html).toContain('推断');
    expect(html).toContain('外部资料');
    expect(html).toContain('牛津词典');
    expect(html).toContain('第 3 页');
  });

  test('never gives infer or ext sources a seek link', () => {
    const inferDeck = parseDeck({
      version: 1,
      title: '推断',
      sourcePath,
      durationSeconds: 100,
      chapters: [
        {
          title: '一、推断',
          start: 0,
          slides: [
            {
              type: 'quote',
              id: 'quote',
              title: '推断页',
              sources: [{ kind: 'infer' }],
              text: '由视频推出'
            }
          ]
        }
      ]
    });
    const inferHtml = renderDeck(inferDeck, { sourcePath, frames });

    expect(inferHtml).toContain('推断');
    expect(inferHtml).not.toContain('#t=');

    const extDeck = parseDeck({
      version: 1,
      title: '外部资料',
      sourcePath,
      durationSeconds: 100,
      chapters: [
        {
          title: '一、扩展',
          start: 0,
          slides: [
            {
              type: 'quote',
              id: 'quote',
              title: '扩展页',
              sources: [{ kind: 'ext', title: '牛津词典', page: 7 }],
              text: '词典释义'
            }
          ]
        }
      ]
    });
    const extHtml = renderDeck(extDeck, { sourcePath, frames });

    expect(extHtml).toContain('外部资料 · 牛津词典 · 第 7 页');
    expect(extHtml).not.toContain('#t=');
  });

  test('includes navigation, hash restore, quiz reveal and layout hooks', () => {
    const html = render();

    expect(html).toContain('window.__deckLayout');
    expect(html).toContain('window.location.hash');
    expect(html).toContain('history.replaceState');
    expect(html).toContain('ArrowRight');
    expect(html).toContain('PageDown');
    expect(html).toContain('Home');
    expect(html).toContain('End');
    expect(html).toContain('pointerup');
    expect(html).toContain('data-quiz');
    expect(html).toContain('class="quiz-answer" data-answer hidden');
    expect(html).toContain('显示答案');
    expect(html).toContain('data-count');
    expect(html).toContain('data-progress');
  });

  test('carries the theme, dark palette and print page', () => {
    const html = render();

    expect(html).toContain('--teal:#0f766e');
    expect(html).toContain('--orange:#c2410c');
    expect(html).toContain('@media (prefers-color-scheme:dark)');
    expect(html).toContain('"Microsoft YaHei"');
    expect(html).toContain('--font-title:60px');
    expect(html).toContain('@page{size:13.333in 7.5in;margin:0}');
    expect(html).toContain('.deck-bar{display:none}');
    expect(html).toContain('.quiz-answer[hidden]{display:flex}');
    // The stage must not clip the stacked slides on paper.
    expect(html).toContain('.stage{position:static;width:13.333in;height:auto;');
    expect(html).toContain('.slide:last-child{page-break-after:auto;break-after:auto}');
  });

  test('is deterministic for the same input', () => {
    expect(render()).toBe(render());
  });

  test('rejects a figure whose frame is not provided', () => {
    const json = deckJson();
    json.chapters[0].slides[5].frame = 'frames/missing.jpg';
    const deck = parseDeck(json);

    expect(() => renderDeck(deck, { sourcePath, frames })).toThrow(
      /frame "frames\/missing\.jpg" does not exist/
    );
  });
});
