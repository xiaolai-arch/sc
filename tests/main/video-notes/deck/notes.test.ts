import { FakeModelClient } from '../../../../src/main/agent/model-client';
import type { Transcript } from '../../../../src/main/video-notes/mimo';
import type { ScreenRead } from '../../../../src/main/video-notes/screen-read';
import {
  buildNotes,
  renderNotesMarkdown,
  NOTES_PROMPT_VERSION,
  NOTES_SPLIT_THRESHOLD_CHARS
} from '../../../../src/main/video-notes/deck/notes';
import { DeckStepError } from '../../../../src/main/video-notes/deck/prompts';
import type { DeckNotes, Outline } from '../../../../src/main/video-notes/deck/content';

function transcriptWith(
  chunks: Array<{ start: number; text: string }>,
  duration: number
): Transcript {
  return {
    source: 'C:\\courses\\01.mp4',
    duration,
    language: 'zh',
    model: 'test-asr',
    chars: chunks.reduce((total, chunk) => total + chunk.text.length, 0),
    text: chunks.map((chunk) => chunk.text).join(''),
    chunks
  };
}

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

const SHORT_TRANSCRIPT = transcriptWith(
  [
    { start: 0, text: '先讲集合的定义。' },
    { start: 120, text: '集合有三个性质。' },
    { start: 320, text: '再看元素的互异性。' }
  ],
  600
);

describe('buildNotes', () => {
  it('uses one call for a short transcript and keeps outline order and titles', async () => {
    const client = new FakeModelClient([
      JSON.stringify({
        chapters: [
          {
            title: '模型自己起的标题一',
            start: 0,
            blocks: [
              { t: 120, text: '集合有三个性质。', source: 'video' },
              { t: 60, text: '集合与元素', source: 'screen' }
            ],
            keyPoints: ['记住定义']
          },
          {
            title: '模型自己起的标题二',
            start: 999,
            blocks: [{ t: 320, text: '元素互不相同。', source: 'video' }],
            keyPoints: ['记住性质']
          }
        ]
      })
    ]);

    const notes = await buildNotes({
      client,
      transcript: SHORT_TRANSCRIPT,
      outline: twoChapterOutline(),
      screenReads: [readAt(60, '集合与元素')]
    });

    expect(client.calls).toHaveLength(1);
    expect(notes.chapters.map((chapter) => chapter.title)).toEqual(['大纲一', '大纲二']);
    expect(notes.chapters[1]?.start).toBe(300);
    expect(notes.chapters[0]?.blocks.map((block) => block.t)).toEqual([60, 120]);

    const prompt = client.calls[0]?.messages[0]?.content ?? '';
    expect(prompt).toContain('先讲集合的定义。');
    expect(prompt).toContain('〔画面〕集合与元素');
  });

  it('splits a long transcript into one call per chapter with only that chapter material', async () => {
    const longTranscript = transcriptWith(
      [
        { start: 0, text: `甲${'A'.repeat(70_000)}` },
        { start: 300, text: `乙${'B'.repeat(70_000)}` }
      ],
      600
    );
    expect(longTranscript.text.length).toBeGreaterThan(NOTES_SPLIT_THRESHOLD_CHARS);

    const client = new FakeModelClient([
      JSON.stringify({
        title: '模型标题一',
        start: 0,
        blocks: [{ t: 0, text: '甲章内容', source: 'video' }],
        keyPoints: ['甲']
      }),
      JSON.stringify({
        title: '模型标题二',
        start: 0,
        blocks: [{ t: 300, text: '乙章内容', source: 'video' }],
        keyPoints: ['乙']
      })
    ]);

    const notes = await buildNotes({
      client,
      transcript: longTranscript,
      outline: twoChapterOutline(),
      screenReads: []
    });

    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.messages[0]?.content).toContain('AAAA');
    expect(client.calls[0]?.messages[0]?.content).not.toContain('BBBB');
    expect(client.calls[1]?.messages[0]?.content).toContain('BBBB');
    expect(client.calls[1]?.messages[0]?.content).not.toContain('AAAA');

    expect(notes.chapters.map((chapter) => chapter.title)).toEqual(['大纲一', '大纲二']);
    expect(notes.chapters.map((chapter) => chapter.start)).toEqual([0, 300]);
    expect(notes.chapters[0]?.blocks[0]?.text).toBe('甲章内容');
    expect(notes.chapters[1]?.blocks[0]?.text).toBe('乙章内容');
  });

  it('fails when the model skips a chapter', async () => {
    const client = new FakeModelClient([
      JSON.stringify({
        chapters: [
          {
            title: '大纲一',
            start: 0,
            blocks: [{ t: 0, text: '只有一章', source: 'video' }],
            keyPoints: ['要点']
          }
        ]
      })
    ]);

    await expect(
      buildNotes({
        client,
        transcript: SHORT_TRANSCRIPT,
        outline: twoChapterOutline(),
        screenReads: []
      })
    ).rejects.toBeInstanceOf(DeckStepError);
  });

  it('exposes the prompt version and split threshold', () => {
    expect(NOTES_PROMPT_VERSION).toBe(1);
    expect(NOTES_SPLIT_THRESHOLD_CHARS).toBe(120_000);
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
            { t: 65, text: '老师讲的集合定义。', source: 'video' },
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
    expect(markdown).toContain('[01:05] 老师讲的集合定义。');
    expect(markdown).toContain('[01:30] 〔画面〕题干：下列说法正确的是？');
    expect(markdown).toContain('**要点**');
    expect(markdown).toContain('- 集合的元素互不相同');
    expect(markdown).toContain('C:\\courses\\01.mp4');
  });
});
