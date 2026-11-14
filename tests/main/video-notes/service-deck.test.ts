import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelClient, ModelRequest, ModelResponse } from '../../../src/main/agent/model-client';
import type { SlideLayout } from '../../../src/main/video-notes/deck/browser';
import type { Deck } from '../../../src/main/video-notes/deck/schema';
import {
  createVideoNotesService,
  type VideoLessonRunOutput
} from '../../../src/main/video-notes/service';
import type { VideoNotesStage } from '../../../src/shared/video-notes';

const NOW = () => new Date(2026, 10, 15, 9, 0, 0);
const DURATION_SECONDS = 600;

/** Smallest valid JPEG marker pair; the fake model never decodes it. */
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9
]);

const SCREEN_READS = JSON.stringify([
  { index: 1, kind: 'slide', text: '集合 A = {1, 2, 3}', occluded: false, keepImage: false },
  { index: 2, kind: 'slide', text: '子集的定义', occluded: false, keepImage: false }
]);

const OUTLINE = JSON.stringify({
  chapters: [
    { title: '集合的定义', start: 0, end: 300, points: ['集合是一些确定对象的整体'] },
    { title: '子集', start: 300, end: 600, points: ['子集的每个元素都属于原集合'] }
  ]
});

const NOTES = JSON.stringify({
  chapters: [
    {
      title: '集合的定义',
      start: 0,
      blocks: [
        { t: 0, text: '集合是一些确定对象的整体。', source: 'video' },
        { t: 120, text: '集合 A = {1, 2, 3}', source: 'screen' }
      ],
      keyPoints: ['集合由确定的元素组成']
    },
    {
      title: '子集',
      start: 300,
      blocks: [{ t: 360, text: '子集的每个元素都属于原集合。', source: 'video' }],
      keyPoints: ['子集关系要逐个元素判断']
    }
  ]
});

const CARDS = JSON.stringify({
  cards: [
    {
      chapter: '集合的定义',
      title: '空集是任何集合的子集',
      principle: '空集里没有元素，不可能出现不属于另一个集合的元素。',
      examples: [
        { wrong: '空集不是任何集合的子集', right: '空集是任何集合的子集' },
        { right: '判断子集先看元素归属' }
      ],
      pitfall: '把空集当成特殊集合单独讨论。',
      transfer: '换到任意集合，都先检查每个元素是否属于目标集合。',
      sources: [{ kind: 'infer' }]
    },
    {
      chapter: '子集',
      title: '子集必须逐个元素核对',
      principle: '子集的定义是元素归属，不是一个集合包含另一个集合。',
      examples: [
        { wrong: '元素个数少的集合一定是子集', right: '必须每个元素都属于原集合' },
        { right: '{1} 是 {1, 2} 的子集' }
      ],
      pitfall: '只看元素个数判断子集关系。',
      transfer: '换一个新集合，逐元素检查归属。',
      sources: [{ kind: 'video', t: 360 }]
    }
  ]
});

const COMPOSE = JSON.stringify([
  {
    type: 'points',
    id: 'p1',
    title: '集合由确定的元素组成',
    sources: [{ kind: 'video', t: 0 }],
    points: [{ text: '元素必须确定', source: { kind: 'video', t: 0 } }]
  }
]);

const REFIT = JSON.stringify({
  slides: [
    {
      type: 'points',
      id: 'p1',
      title: '重排后的页面',
      sources: [{ kind: 'video', t: 0 }],
      points: [{ text: '拆开后的要点', source: { kind: 'video', t: 0 } }]
    }
  ]
});

function variedText(length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(0x4e00 + ((index * 97 + 13) % 2000));
  }
  return text;
}

function promptOf(request: ModelRequest): string {
  return request.messages.map((message) => message.content).join('\n');
}

/** The fact-check B prompt ends with the deck JSON; echo it back unchanged. */
function deckFromCheckPrompt(prompt: string): Deck {
  const marker = '## 课件 JSON\n';
  const index = prompt.lastIndexOf(marker);
  if (index === -1) throw new Error('fact-check prompt has no deck section');
  return JSON.parse(prompt.slice(index + marker.length)) as Deck;
}

interface DeckCounts {
  screen: number;
  outline: number;
  notes: number;
  enrich: number;
  factcheckA: number;
  compose: number;
  refit: number;
  factcheckB: number;
}

interface ScriptedClientOptions {
  /** Called just before the outline answer; used to cancel mid-pipeline. */
  onOutline?: () => void;
  /** Return an unusable compose answer (twice) to fail the step. */
  failCompose?: boolean;
}

function scriptedClient(options: ScriptedClientOptions = {}) {
  const calls: ModelRequest[] = [];
  const counts: DeckCounts = {
    screen: 0,
    outline: 0,
    notes: 0,
    enrich: 0,
    factcheckA: 0,
    compose: 0,
    refit: 0,
    factcheckB: 0
  };
  const client: ModelClient = {
    async complete(request): Promise<ModelResponse> {
      calls.push(request);
      const prompt = promptOf(request);
      // Every answer bills the same amount so step usage is easy to check.
      const reply = (text: string): ModelResponse => ({
        text,
        usage: { inputTokens: 100, outputTokens: 50 }
      });

      if (prompt.includes('抄录「画面上的文字」')) {
        counts.screen += 1;
        return reply(SCREEN_READS);
      }
      if (prompt.includes('划分章节大纲')) {
        counts.outline += 1;
        options.onOutline?.();
        return reply(OUTLINE);
      }
      if (prompt.includes('分章笔记')) {
        counts.notes += 1;
        return reply(NOTES);
      }
      if (prompt.includes('编写补充卡片')) {
        counts.enrich += 1;
        return reply(CARDS);
      }
      if (prompt.includes('课件成品')) {
        counts.factcheckB += 1;
        const deck = deckFromCheckPrompt(prompt);
        return reply(JSON.stringify({ issues: [], deck }));
      }
      if (prompt.includes('独立核查员')) {
        counts.factcheckA += 1;
        return reply(JSON.stringify({ issues: [] }));
      }
      if (prompt.includes('章」的课件页面')) {
        counts.compose += 1;
        return reply(options.failCompose === true ? '这不是 JSON' : COMPOSE);
      }
      if (prompt.includes('重排一页课件')) {
        counts.refit += 1;
        return reply(REFIT);
      }
      throw new Error(`unscripted prompt: ${prompt.slice(0, 80)}`);
    }
  };
  return { client, calls, counts };
}

/** A client that must never be called; used to prove a resume skips every step. */
function silentClient() {
  const calls: ModelRequest[] = [];
  const client: ModelClient = {
    async complete(request): Promise<ModelResponse> {
      calls.push(request);
      throw new Error('模型不应被调用。');
    }
  };
  return { client, calls };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function countSlides(html: string): number {
  return html.split('<section class="slide').length - 1;
}

interface Fixture {
  root: string;
  video: string;
  outputDir: string;
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-video-deck-'));
  const video = join(root, '01-集合.mp4');
  await writeFile(video, 'video', 'utf8');
  return { root, video, outputDir: join(root, 'out') };
}

interface BrowserCalls {
  measured: string[];
  exported: string[];
}

function makeService(
  fixtureData: Fixture,
  client: ModelClient,
  options: { measure?: (html: string) => Promise<SlideLayout[]> } = {}
) {
  const browser: BrowserCalls = { measured: [], exported: [] };
  const measure =
    options.measure ??
    ((html: string) =>
      Promise.resolve(
        Array.from({ length: countSlides(html) }, (_unused, index) => ({ index, bottom: 500 }))
      ));
  const service = createVideoNotesService({
    cacheRoot: join(fixtureData.root, 'cache'),
    getAsrConfig: async () => ({ baseURL: 'https://host/v1', model: 'mimo-asr', apiKey: 'key' }),
    getModelClient: async () => client,
    getModelName: async () => 'fake-model',
    ensureTools: async () => undefined,
    probe: async () => DURATION_SECONDS,
    extract: async (_source, destination) => {
      await writeFile(destination, 'audio', 'utf8');
    },
    createAsr: () => async () => variedText(1000),
    extractFrames: async ({ outDir }) => {
      await mkdir(outDir, { recursive: true });
      const frames = [
        { t: 120, name: '120000.jpg' },
        { t: 480, name: '480000.jpg' }
      ];
      for (const frame of frames) await writeFile(join(outDir, frame.name), TINY_JPEG);
      return frames.map((frame, index) => ({
        t: frame.t,
        path: join(outDir, frame.name),
        sharpness: 10 + index,
        scene: false
      }));
    },
    deckBrowser: {
      async measure(html) {
        browser.measured.push(html);
        return measure(html);
      },
      async exportPdf(html, pdfPath) {
        browser.exported.push(html);
        await writeFile(pdfPath, Buffer.from('%PDF-1.4 fake'), 'utf8');
        return { slides: countSlides(html), bytes: 13 };
      }
    },
    now: NOW
  });
  return { service, browser };
}

function runDeck(
  service: ReturnType<typeof makeService>['service'],
  data: Fixture,
  extra: { signal?: AbortSignal; lessonDir?: string; onStage?: Parameters<typeof service.runLesson>[0]['onStage'] } = {}
): Promise<VideoLessonRunOutput> {
  return service.runLesson({
    mode: 'deck',
    videoPath: data.video,
    outputDir: data.outputDir,
    language: 'zh',
    signal: extra.signal ?? new AbortController().signal,
    ...(extra.lessonDir === undefined ? {} : { lessonDir: extra.lessonDir }),
    ...(extra.onStage === undefined ? {} : { onStage: extra.onStage })
  });
}

const EXPECTED_STEPS = [
  'probe',
  'transcribe',
  'keyframes',
  'screen-read',
  'outline',
  'notes',
  'enrich',
  'factcheck-a',
  'compose',
  'render',
  'layout',
  'factcheck-b',
  'export',
  'report'
];

describe('video notes deck pipeline', () => {
  let root: string;

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  test('writes every deck artifact and a v2 meta with the deck mode', async () => {
    const data = await fixture();
    root = data.root;
    const { client } = scriptedClient();
    const { service } = makeService(data, client);

    const result = await runDeck(service, data);

    const lessonDir = result.lessonDir;
    expect(result.slidesPath).toBe(join(lessonDir, 'slides.html'));
    expect(result.pdfPath).toBe(join(lessonDir, 'slides.pdf'));
    expect(result.reportPath).toBe(join(lessonDir, 'report.md'));
    expect(result.htmlPath).toBe('');

    expect(await exists(join(lessonDir, 'transcript.json'))).toBe(true);
    expect(await exists(join(lessonDir, 'notes.md'))).toBe(true);
    expect(await exists(result.slidesPath!)).toBe(true);
    expect(await exists(result.pdfPath!)).toBe(true);
    expect(await exists(result.reportPath!)).toBe(true);
    // Deck mode never writes the quick-mode HTML page.
    expect(await exists(join(lessonDir, 'notes.html'))).toBe(false);

    const slidesHtml = await readFile(result.slidesPath!, 'utf8');
    const notes = await readFile(join(lessonDir, 'notes.md'), 'utf8');
    expect(notes).toContain('## 集合的定义');
    expect(notes).toContain('〔画面〕集合 A = {1, 2, 3}');
    expect(slidesHtml).toContain('本讲小结');

    const meta = JSON.parse(await readFile(join(lessonDir, 'meta.json'), 'utf8')) as {
      version: number;
      mode: string;
      slidesPath: string;
      pdfPath: string;
      reportPath: string;
      slideCount: number;
      summary: string;
    };
    expect(meta.version).toBe(2);
    expect(meta.mode).toBe('deck');
    expect(meta.slidesPath).toBe(result.slidesPath);
    expect(meta.pdfPath).toBe(result.pdfPath);
    expect(meta.reportPath).toBe(result.reportPath);
    // cover + agenda + 2 chapter pages + summary
    expect(meta.slideCount).toBe(5);
    expect(meta.slideCount).toBe(countSlides(slidesHtml));
    expect(meta.summary).toContain('集合');

    const report = await readFile(result.reportPath!, 'utf8');
    expect(report).toContain('# 质量报告');
    expect(report).toContain('完整课件');
    expect(report).toContain('课件页数：5 页');

    // 8 model calls (screen, outline, notes, enrich, check-a, 2× compose, check-b).
    expect(result.usage).toEqual({ inputTokens: 800, outputTokens: 400 });
  });

  test('runs every step in order and checkpoints each one under work/', async () => {
    const data = await fixture();
    root = data.root;
    const { client } = scriptedClient();
    const { service } = makeService(data, client);
    const stages: VideoNotesStage[] = [];

    const result = await runDeck(service, data, {
      onStage: (stage) => {
        if (stages.at(-1) !== stage) stages.push(stage);
      }
    });

    for (const step of EXPECTED_STEPS) {
      const path = join(result.lessonDir, 'work', `${step}.json`);
      expect(await exists(path)).toBe(true);
      const record = JSON.parse(await readFile(path, 'utf8')) as {
        step: string;
        fingerprint: string;
        usage: { inputTokens: number; outputTokens: number };
      };
      expect(record.step).toBe(step);
      expect(record.fingerprint).toMatch(/^[0-9a-f]{40}$/);
      if (step === 'outline') expect(record.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
      if (step === 'keyframes') expect(record.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    }
    // meta is written last and is not a checkpoint.
    expect(await exists(join(result.lessonDir, 'work', 'meta.json'))).toBe(false);

    expect(stages).toEqual([
      'probe',
      'audio',
      'transcribe',
      'keyframes',
      'screen',
      'outline',
      'notes',
      'enrich',
      'factcheck',
      'compose',
      'render',
      'layout',
      'factcheck',
      'pdf',
      'report',
      'done'
    ]);
  });

  test('resuming with unchanged checkpoints makes no model calls', async () => {
    const data = await fixture();
    root = data.root;
    const first = scriptedClient();
    const { service: firstService } = makeService(data, first.client);
    const initial = await runDeck(firstService, data);
    expect(first.calls).toHaveLength(8);

    const second = silentClient();
    const { service: resumed } = makeService(data, second.client);
    const output = await runDeck(resumed, data, { lessonDir: initial.lessonDir });

    expect(second.calls).toHaveLength(0);
    expect(output.lessonDir).toBe(initial.lessonDir);
    expect(output.slidesPath).toBe(initial.slidesPath);
    expect(output.pdfPath).toBe(initial.pdfPath);
    expect(output.reportPath).toBe(initial.reportPath);
    // Usage is replayed from the checkpoints, not lost on resume.
    expect(output.usage).toEqual({ inputTokens: 800, outputTokens: 400 });
    expect(await exists(output.slidesPath!)).toBe(true);
    expect(await exists(output.pdfPath!)).toBe(true);
    expect(await exists(join(output.lessonDir, 'meta.json'))).toBe(true);
  });

  test('a failing deck lesson keeps the checkpoints it already finished', async () => {
    const data = await fixture();
    root = data.root;
    const { client } = scriptedClient({ failCompose: true });
    const { service } = makeService(data, client);

    await expect(runDeck(service, data)).rejects.toThrow(/compose|课件步骤/);

    const lessonDir = join(data.outputDir, '01-集合');
    for (const step of ['probe', 'transcribe', 'keyframes', 'screen-read', 'outline', 'notes', 'enrich', 'factcheck-a']) {
      expect(await exists(join(lessonDir, 'work', `${step}.json`))).toBe(true);
    }
    expect(await exists(join(lessonDir, 'work', 'compose.json'))).toBe(false);
    // No half-written lesson may reach the index.
    expect(await exists(join(lessonDir, 'meta.json'))).toBe(false);
  });

  test('cancelling during the outline keeps earlier checkpoints and throws AbortError', async () => {
    const data = await fixture();
    root = data.root;
    const controller = new AbortController();
    const { client } = scriptedClient({
      onOutline: () => {
        controller.abort();
        const error = new Error('任务已取消。');
        error.name = 'AbortError';
        throw error;
      }
    });
    const { service } = makeService(data, client);

    await expect(runDeck(service, data, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError'
    });

    const lessonDir = join(data.outputDir, '01-集合');
    for (const step of ['probe', 'transcribe', 'keyframes', 'screen-read']) {
      expect(await exists(join(lessonDir, 'work', `${step}.json`))).toBe(true);
    }
    expect(await exists(join(lessonDir, 'work', 'outline.json'))).toBe(false);
    expect(await exists(join(lessonDir, 'slides.html'))).toBe(false);
  });

  test('an overflowing page is refitted once and the refitted deck is rendered', async () => {
    const data = await fixture();
    root = data.root;
    const script = scriptedClient();
    const { service, browser } = makeService(data, script.client, {
      measure: async (html) => {
        const refitted = html.includes('重排后的页面');
        return Array.from({ length: countSlides(html) }, (_unused, index) => ({
          index,
          // Pages 3 and 4 overflow until the refit has been rendered.
          bottom: !refitted && (index === 2 || index === 3) ? 700 : 500
        }));
      }
    });

    const result = await runDeck(service, data);

    expect(script.counts.refit).toBe(2);
    const layout = JSON.parse(
      await readFile(join(result.lessonDir, 'work', 'layout.json'), 'utf8')
    ) as { output: { rounds: number; overflows: unknown[]; deck: Deck } };
    expect(layout.output.rounds).toBe(1);
    expect(layout.output.overflows).toEqual([]);

    const slidesHtml = await readFile(result.slidesPath!, 'utf8');
    expect(slidesHtml).toContain('重排后的页面');
    // The PDF is exported from the refitted deck as well.
    expect(browser.exported.at(-1)).toContain('重排后的页面');
    const refittedPages = layout.output.deck.chapters.flatMap((chapter) =>
      chapter.slides.filter((slide) => slide.title === '重排后的页面')
    );
    expect(refittedPages).toHaveLength(2);
  });

  test('stops after two refit rounds and reports the pages that still overflow', async () => {
    const data = await fixture();
    root = data.root;
    const script = scriptedClient();
    const { service } = makeService(data, script.client, {
      measure: async (html) =>
        Array.from({ length: countSlides(html) }, (_unused, index) => ({
          index,
          bottom: index === 2 ? 760 : 500
        }))
    });

    const result = await runDeck(service, data);

    expect(script.counts.refit).toBe(2);
    const layout = JSON.parse(
      await readFile(join(result.lessonDir, 'work', 'layout.json'), 'utf8')
    ) as { output: { rounds: number; overflows: Array<{ index: number; excessPx: number }> } };
    expect(layout.output.rounds).toBe(2);
    expect(layout.output.overflows).toHaveLength(1);
    expect(layout.output.overflows[0]!.excessPx).toBe(104);

    const report = await readFile(result.reportPath!, 'utf8');
    // The report lists the zero-based page index it measured.
    expect(report).toMatch(/第 2 页：内容底边 760 px，超出 104 px/);
  });
});
