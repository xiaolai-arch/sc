import { FakeModelClient } from '../../../../src/main/agent/model-client';
import type { ScreenRead } from '../../../../src/main/video-notes/screen-read';
import {
  buildNotes,
  splitNoteText,
  renderNotesMarkdown,
  NOTES_MAX_BLOCK_CHARS,
  NOTES_MAX_BLOCKS_PER_CHAPTER,
  NOTES_PROMPT_VERSION
} from '../../../../src/main/video-notes/deck/notes';
import { DeckStepError } from '../../../../src/main/video-notes/deck/prompts';
import type { DeckNotes, Outline } from '../../../../src/main/video-notes/deck/content';

function twoChapterOutline(): Outline {
  return {
    chapters: [
      { title: '大纲一', start: 0, end: 300, points: ['集合的定义'] },
      { title: '大纲二', start: 300, end: 600, points: ['元素的三个性质'] }
    ]
  };
}

function readAt(t: number, text: string): ScreenRead {
  return {
    frame: `frames/${Math.round(t * 1000)}.jpg`,
    t,
    kind: 'slide',
    text,
    occluded: false,
    keepImage: false
  };
}

const SCREEN_READS = [
  readAt(60, '集合与元素'),
  readAt(120, '集合有三个性质'),
  readAt(320, '再看元素的互异性')
];

/** The model only owns key points; blocks are filled from the screen reads. */
function keyPointsAnswer(): string {
  return JSON.stringify({
    chapters: [
      { title: '模型自己起的标题一', start: 0, keyPoints: ['记住定义'] },
      { title: '模型自己起的标题二', start: 999, keyPoints: ['记住性质'] }
    ]
  });
}

describe('buildNotes', () => {
  it('keeps outline order and titles and copies the screen text verbatim', async () => {
    const client = new FakeModelClient([keyPointsAnswer()]);

    const notes = await buildNotes({
      client,
      outline: twoChapterOutline(),
      screenReads: SCREEN_READS
    });

    expect(client.calls).toHaveLength(1);
    expect(notes.chapters.map((chapter) => chapter.title)).toEqual(['大纲一', '大纲二']);
    expect(notes.chapters[1]?.start).toBe(300);
    expect(notes.chapters[0]?.blocks).toEqual([
      { t: 60, text: '集合与元素', source: 'screen' },
      { t: 120, text: '集合有三个性质', source: 'screen' }
    ]);
    expect(notes.chapters[1]?.blocks).toEqual([
      { t: 320, text: '再看元素的互异性', source: 'screen' }
    ]);
    expect(notes.chapters[0]?.keyPoints).toEqual(['记住定义']);

    const prompt = client.calls[0]?.messages[0]?.content ?? '';
    expect(prompt).toContain('〔画面 01:00〕集合与元素');
    expect(prompt).toContain('没有语音转写');
    expect(prompt).toContain('老师说');
  });

  it('does not carry any model-written block text into the notes', async () => {
    const client = new FakeModelClient([
      JSON.stringify({
        chapters: [
          {
            title: '大纲一',
            start: 0,
            blocks: [{ t: 0, text: '老师说过的话。', source: 'video' }],
            keyPoints: ['一']
          },
          {
            title: '大纲二',
            start: 300,
            blocks: [{ t: 300, text: '另一句。', source: 'video' }],
            keyPoints: ['二']
          }
        ]
      })
    ]);

    const notes = await buildNotes({
      client,
      outline: twoChapterOutline(),
      screenReads: SCREEN_READS
    });

    const everything = notes.chapters.flatMap((chapter) =>
      chapter.blocks.map((block) => `${block.source}:${block.text}`)
    );
    expect(everything).toEqual([
      'screen:集合与元素',
      'screen:集合有三个性质',
      'screen:再看元素的互异性'
    ]);
  });

  it('uses the nearest read when a chapter window holds no frame', async () => {
    const client = new FakeModelClient([keyPointsAnswer()]);

    const notes = await buildNotes({
      client,
      outline: twoChapterOutline(),
      screenReads: [readAt(60, '只有第一章的文字')]
    });

    expect(notes.chapters[1]?.blocks).toHaveLength(1);
    expect(notes.chapters[1]?.blocks[0]?.text).toBe('只有第一章的文字');
  });

  it('splits a very long screen read into schema-sized blocks', async () => {
    const client = new FakeModelClient([keyPointsAnswer()]);
    const long = `${'甲'.repeat(700)}。${'乙'.repeat(700)}`;

    const notes = await buildNotes({
      client,
      outline: twoChapterOutline(),
      screenReads: [readAt(10, long)]
    });

    const blocks = notes.chapters[0]?.blocks ?? [];
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      expect(block.text.length).toBeLessThanOrEqual(NOTES_MAX_BLOCK_CHARS);
    }
    expect(blocks.map((block) => block.text).join('')).toContain('甲');
  });

  it('caps a dense chapter by sampling its blocks evenly', async () => {
    const client = new FakeModelClient([keyPointsAnswer()]);
    const reads = Array.from({ length: 100 }, (_unused, index) => readAt(index, `第 ${index} 条`));

    const notes = await buildNotes({
      client,
      outline: twoChapterOutline(),
      screenReads: reads
    });

    const blocks = notes.chapters[0]?.blocks ?? [];
    expect(blocks).toHaveLength(NOTES_MAX_BLOCKS_PER_CHAPTER);
    expect(blocks[0]?.text).toBe('第 0 条');
    expect(blocks.at(-1)?.text).toBe('第 99 条');
  });

  it('fails when the model skips a chapter', async () => {
    const client = new FakeModelClient([
      JSON.stringify({
        chapters: [{ title: '大纲一', start: 0, keyPoints: ['要点'] }]
      })
    ]);

    await expect(
      buildNotes({
        client,
        outline: twoChapterOutline(),
        screenReads: SCREEN_READS
      })
    ).rejects.toBeInstanceOf(DeckStepError);
  });

  it('fails when no frame carried readable text', async () => {
    const client = new FakeModelClient([keyPointsAnswer()]);

    await expect(
      buildNotes({
        client,
        outline: twoChapterOutline(),
        screenReads: [readAt(10, '   ')]
      })
    ).rejects.toBeInstanceOf(DeckStepError);
    expect(client.calls).toHaveLength(0);
  });

  it('exposes the prompt version and block limits', () => {
    expect(NOTES_PROMPT_VERSION).toBe(2);
    expect(NOTES_MAX_BLOCK_CHARS).toBe(600);
    expect(NOTES_MAX_BLOCKS_PER_CHAPTER).toBe(60);
  });
});

describe('splitNoteText', () => {
  it('keeps short text whole and cuts long text at a sentence end', () => {
    expect(splitNoteText('一句话')).toEqual(['一句话']);
    const pieces = splitNoteText(`${'甲'.repeat(500)}。${'乙'.repeat(500)}`);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]?.endsWith('。')).toBe(true);
  });
});

describe('renderNotesMarkdown', () => {
  it('writes times, screen markers and a 要点 list per chapter', () => {
    const notes: DeckNotes = {
      chapters: [
        {
          title: '一、集合',
          start: 0,
          blocks: [
            { t: 65, text: '集合的定义', source: 'screen' },
            { t: 90, text: '题干：下列说法正确的是？', source: 'screen' }
          ],
          keyPoints: ['集合的元素互不相同', '元素没有顺序']
        }
      ]
    };

    const markdown = renderNotesMarkdown(notes, {
      title: '第一讲 集合',
      durationSeconds: 3_725,
      sourcePath: 'C:\\courses\\01.mp4'
    });

    expect(markdown).toContain('# 第一讲 集合');
    expect(markdown).toContain('- 时长：62:05');
    expect(markdown).toContain('## 一、集合');
    expect(markdown).toContain('[01:05] 〔画面〕集合的定义');
    expect(markdown).toContain('[01:30] 〔画面〕题干：下列说法正确的是？');
    expect(markdown).toContain('**要点**');
    expect(markdown).toContain('- 集合的元素互不相同');
    expect(markdown).toContain('C:\\courses\\01.mp4');
  });
});
