import { FakeModelClient } from '../../../../src/main/agent/model-client';
import type { Keyframe } from '../../../../src/main/video-notes/keyframes';
import type { ScreenRead } from '../../../../src/main/video-notes/screen-read';
import type { Outline, OutlineChapter } from '../../../../src/main/video-notes/deck/content';
import {
  assembleDeck,
  composeChapter,
  refitSlide,
  COMPOSE_PROMPT_VERSION,
  type ComposeChapterOptions
} from '../../../../src/main/video-notes/deck/compose';
import { DeckStepError } from '../../../../src/main/video-notes/deck/prompts';
import { validateDeck, type Slide } from '../../../../src/main/video-notes/deck/schema';

const CHAPTER: OutlineChapter = {
  title: '一、集合与元素',
  start: 0,
  end: 300,
  points: ['集合的定义', '元素的三个性质']
};

function composeOptions(
  client: FakeModelClient,
  overrides: Partial<ComposeChapterOptions> = {}
): ComposeChapterOptions {
  return {
    client,
    chapter: CHAPTER,
    notes: {
      title: CHAPTER.title,
      start: 0,
      blocks: [
        { t: 10, text: '集合是一组确定的对象的整体。', source: 'video' },
        { t: 20, text: '集合与元素', source: 'screen' }
      ],
      keyPoints: ['元素互不相同']
    },
    cards: [],
    screenReads: [],
    keyframes: [],
    durationSeconds: 600,
    chapterIndex: 0,
    chapterCount: 2,
    ...overrides
  };
}

function pointsSlide(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'points',
    id: 'points',
    title: '元素互不相同',
    sources: [{ kind: 'video', t: 10 }],
    points: [{ text: '元素互不相同', source: { kind: 'video', t: 10 } }],
    ...overrides
  };
}

function quoteSlide(id: string): Record<string, unknown> {
  return {
    type: 'quote',
    id,
    title: '一句话记住定义',
    sources: [{ kind: 'infer' }],
    text: '集合的元素互不相同。'
  };
}

function frameAt(t: number): Keyframe {
  return {
    t,
    path: `C:\\lesson\\frames\\${Math.round(t * 1000)}.jpg`,
    sharpness: 0,
    scene: false
  };
}

function readAt(t: number, keepImage: boolean): ScreenRead {
  return {
    frame: `frames/${Math.round(t * 1000)}.jpg`,
    t,
    kind: keepImage ? 'figure' : 'slide',
    text: keepImage ? '图表：集合的韦恩图' : '集合与元素',
    occluded: false,
    keepImage
  };
}

describe('composeChapter', () => {
  it('names all 13 slide types in the prompt', async () => {
    const client = new FakeModelClient([JSON.stringify([pointsSlide()])]);

    await composeChapter(composeOptions(client));

    const prompt = client.calls[0]?.messages[0]?.content ?? '';
    for (const type of [
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
    ]) {
      expect(prompt).toContain(`${type}（`);
    }
    expect(prompt).toContain('第 1/2 章');
    expect(prompt).toContain('集合是一组确定的对象的整体。');
    expect(prompt).toContain('〔画面〕集合与元素');
  });

  it('drops cover, agenda and summary and rewrites ids deck-wide', async () => {
    const client = new FakeModelClient([
      JSON.stringify([
        {
          type: 'cover',
          id: 'c',
          title: '封面',
          sources: [{ kind: 'video', t: 0 }]
        },
        {
          type: 'agenda',
          id: 'a',
          title: '目录',
          sources: [{ kind: 'video', t: 0 }],
          items: ['一、集合与元素']
        },
        {
          type: 'summary',
          id: 's',
          title: '小结',
          sources: [{ kind: 'video', t: 0 }],
          points: ['记住定义']
        },
        pointsSlide({ id: 'model-id' }),
        quoteSlide('q')
      ])
    ]);

    const slides = await composeChapter(composeOptions(client, { chapterIndex: 1 }));

    expect(slides.map((slide) => slide.type)).toEqual(['points', 'quote']);
    expect(slides.map((slide) => slide.id)).toEqual(['2-1', '2-2']);
  });

  it('keeps figure slides only for existing frames whose screen read keeps the image', async () => {
    const keyframes = [frameAt(10), frameAt(20), frameAt(30)];
    const screenReads = [readAt(10, false), readAt(20, true)];
    const client = new FakeModelClient([
      JSON.stringify([
        {
          type: 'figure',
          id: 'f1',
          title: '这张图不能放',
          sources: [{ kind: 'screen', t: 10 }],
          frame: 'frames/10000.jpg',
          keepImage: true,
          captions: ['说明']
        },
        {
          type: 'figure',
          id: 'f2',
          title: '韦恩图',
          sources: [{ kind: 'screen', t: 20 }],
          frame: 'frames/20000.jpg',
          keepImage: true,
          captions: ['说明']
        },
        {
          type: 'figure',
          id: 'f3',
          title: '不存在的帧',
          sources: [{ kind: 'screen', t: 30 }],
          frame: 'frames/99999.jpg',
          keepImage: true,
          captions: ['说明']
        },
        pointsSlide()
      ])
    ]);

    const slides = await composeChapter(
      composeOptions(client, { keyframes, screenReads })
    );

    expect(slides.map((slide) => slide.type)).toEqual(['figure', 'points']);
    expect(slides[0]).toMatchObject({ type: 'figure', frame: 'frames/20000.jpg', id: '1-1' });
    expect(slides[1]?.id).toBe('1-2');
  });

  it('clamps source and slide times into the video', async () => {
    const client = new FakeModelClient([
      JSON.stringify([
        pointsSlide({
          sources: [
            { kind: 'video', t: 9_999 },
            { kind: 'screen', t: 9_999 }
          ],
          t: 9_999
        })
      ])
    ]);

    const slides = await composeChapter(composeOptions(client));

    expect(slides[0]?.sources).toEqual([
      { kind: 'video', t: 600 },
      { kind: 'screen', t: 600 }
    ]);
    expect(slides[0]?.t).toBe(600);
  });

  it('fails when every slide was a shell slide', async () => {
    const client = new FakeModelClient([
      JSON.stringify([
        {
          type: 'cover',
          id: 'c',
          title: '封面',
          sources: [{ kind: 'video', t: 0 }]
        }
      ])
    ]);

    await expect(composeChapter(composeOptions(client))).rejects.toBeInstanceOf(
      DeckStepError
    );
  });

  it('exposes prompt version 1', () => {
    expect(COMPOSE_PROMPT_VERSION).toBe(1);
  });
});

function outlineWith(count: number): Outline {
  return {
    chapters: Array.from({ length: count }, (_, index) => ({
      title: `第${index + 1}章`,
      start: index * 60,
      end: (index + 1) * 60,
      points: [`知识点 ${index + 1}`]
    }))
  };
}

describe('assembleDeck', () => {
  it('adds cover, a truncated agenda and the closing summary', () => {
    const outline = outlineWith(10);
    const chapters = outline.chapters.map((chapter, index) => ({
      title: chapter.title,
      start: chapter.start,
      slides: [
        {
          type: 'points',
          id: `${index + 1}-1`,
          title: `${chapter.title}的结论`,
          sources: [{ kind: 'video', t: chapter.start }],
          points: [{ text: '要点', source: { kind: 'video', t: chapter.start } }]
        } as Slide
      ]
    }));

    const deck = assembleDeck({
      title: '第一讲 集合',
      sourcePath: 'C:\\courses\\01.mp4',
      durationSeconds: 600,
      outline,
      chapters,
      summaryPoints: ['要点一', '要点二', '要点三', '要点四']
    });

    expect(deck.chapters[0]?.slides[0]).toMatchObject({
      type: 'cover',
      id: 'cover',
      subtitle: '共 10 章',
      sources: [{ kind: 'video', t: 0 }]
    });
    const agenda = deck.chapters[0]?.slides[1];
    expect(agenda?.type).toBe('agenda');
    if (agenda?.type === 'agenda') expect(agenda.items).toHaveLength(8);

    const lastSlides = deck.chapters.at(-1)?.slides ?? [];
    const summary = lastSlides.at(-1);
    expect(summary?.type).toBe('summary');
    if (summary?.type === 'summary') {
      expect(summary.points).toEqual(['要点一', '要点二', '要点三']);
      expect(summary.sources).toEqual([{ kind: 'video', t: 540 }]);
    }

    expect(() => validateDeck(deck)).not.toThrow();
  });

  it('falls back to the last chapter key points for the summary', () => {
    const outline = outlineWith(2);
    const chapters = outline.chapters.map((chapter, index) => ({
      title: chapter.title,
      start: chapter.start,
      slides: [
        {
          type: 'points',
          id: `${index + 1}-1`,
          title: `${chapter.title}的结论`,
          sources: [{ kind: 'video', t: chapter.start }],
          points: [{ text: '要点', source: { kind: 'video', t: chapter.start } }]
        } as Slide
      ],
      ...(index === 1 ? { keyPoints: ['最后的重点'] } : {})
    }));

    const deck = assembleDeck({
      title: '第一讲 集合',
      sourcePath: 'C:\\courses\\01.mp4',
      durationSeconds: 120,
      outline,
      chapters
    });

    const summary = deck.chapters.at(-1)?.slides.at(-1);
    expect(summary?.type).toBe('summary');
    if (summary?.type === 'summary') expect(summary.points).toEqual(['最后的重点']);
  });

  it('wraps a deck failure in DeckStepError', () => {
    expect(() =>
      assembleDeck({
        title: '空课件',
        sourcePath: 'C:\\courses\\01.mp4',
        durationSeconds: 120,
        outline: outlineWith(1),
        chapters: []
      })
    ).toThrow(DeckStepError);
  });
});

describe('refitSlide', () => {
  const original = pointsSlide({ id: '3-2' }) as unknown as Slide;

  it('keeps the original id for a one-page answer', async () => {
    const client = new FakeModelClient([
      JSON.stringify({ slides: [pointsSlide({ id: 'x' })] })
    ]);

    const slides = await refitSlide({
      client,
      slide: original,
      excessPx: 120,
      chapterTitle: CHAPTER.title
    });

    expect(slides).toHaveLength(1);
    expect(slides[0]?.id).toBe('3-2');
    expect(client.calls[0]?.messages[0]?.content).toContain('超出 120px');
    expect(client.calls[0]?.messages[0]?.content).toContain('3-2');
  });

  it('suffixes the second page id with -b', async () => {
    const client = new FakeModelClient([
      JSON.stringify({
        slides: [pointsSlide({ id: 'x' }), pointsSlide({ id: 'y', title: '元素互不相同（续）' })]
      })
    ]);

    const slides = await refitSlide({
      client,
      slide: original,
      excessPx: 80,
      chapterTitle: CHAPTER.title
    });

    expect(slides).toHaveLength(2);
    expect(slides.map((slide) => slide.id)).toEqual(['3-2', '3-2-b']);
  });

  it('fails after two invalid answers', async () => {
    const client = new FakeModelClient(['{"slides":[]}', '{"slides":[]}']);

    await expect(
      refitSlide({
        client,
        slide: original,
        excessPx: 80,
        chapterTitle: CHAPTER.title
      })
    ).rejects.toBeInstanceOf(DeckStepError);
    expect(client.calls).toHaveLength(2);
  });
});
