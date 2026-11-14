import { FakeModelClient } from '../../../../src/main/agent/model-client';
import type { Transcript } from '../../../../src/main/video-notes/mimo';
import type { ScreenRead } from '../../../../src/main/video-notes/screen-read';
import {
  buildOutline,
  buildOutlinePrompt,
  OUTLINE_PROMPT_VERSION
} from '../../../../src/main/video-notes/deck/outline';
import { DeckStepError } from '../../../../src/main/video-notes/deck/prompts';

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

/** A minimal answer with a single usable chapter. */
function validAnswer(): string {
  return JSON.stringify({
    chapters: [{ title: '开场与概念', start: 0, end: 600, points: ['集合的定义'] }]
  });
}

describe('buildOutlinePrompt', () => {
  it('includes timestamped transcript chunks and the screen digest', () => {
    const transcript = transcriptWith(
      [
        { start: 0, text: '我们先看集合的定义。' },
        { start: 65, text: '元素有三个性质。' }
      ],
      600
    );

    const prompt = buildOutlinePrompt(transcript, [readAt(70, '集合与元素')]);

    expect(prompt).toContain('[00:00] 我们先看集合的定义。');
    expect(prompt).toContain('[01:05] 元素有三个性质。');
    expect(prompt).toContain('集合与元素');
    expect(prompt).toContain('3–12');
    expect(prompt).toContain('视频时长：10:00');
  });

  it('notes missing screen reads instead of leaving a blank section', () => {
    const prompt = buildOutlinePrompt(
      transcriptWith([{ start: 0, text: '一句话。' }], 60)
    );

    expect(prompt).toContain('（没有读屏结果。）');
  });

  it('samples a long transcript down to roughly the budget', () => {
    const chunks = Array.from({ length: 200 }, (_, index) => ({
      start: index * 20,
      text: `第 ${index} 段讲解内容`.padEnd(400, '。')
    }));
    const transcript = transcriptWith(chunks, 4_000);

    const prompt = buildOutlinePrompt(transcript);

    expect(prompt.length).toBeLessThan(20_000);
    // The first and last chunks always survive the sampling.
    expect(prompt).toContain('第 0 段');
    expect(prompt).toContain('第 199 段');
  });
});

describe('buildOutline', () => {
  it('sorts chapters, clamps times into the video and drops empty windows', async () => {
    const duration = 1_000;
    const client = new FakeModelClient([
      JSON.stringify({
        chapters: [
          { title: '第二章', start: 700, end: 9_000, points: ['第二个知识点'] },
          { title: '第一章', start: -30, end: 300, points: ['第一个知识点'] },
          { title: '空章节', start: 500, end: 500, points: ['坏数据'] }
        ]
      })
    ]);

    const outline = await buildOutline({
      client,
      transcript: transcriptWith([{ start: 0, text: '内容' }], duration)
    });

    expect(outline.chapters.map((chapter) => chapter.title)).toEqual(['第一章', '第二章']);
    expect(outline.chapters[0]).toMatchObject({ start: 0, end: 300 });
    expect(outline.chapters[1]).toMatchObject({ start: 700, end: duration });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.noTools).toBe(true);
  });

  it('normalizes overlapping and reversed chapters', async () => {
    const client = new FakeModelClient([
      JSON.stringify({
        chapters: [
          { title: '甲', start: 100, end: 400, points: ['甲'] },
          { title: '乙', start: 300, end: 700, points: ['乙'] },
          { title: '反向', start: 900, end: 200, points: ['丙'] }
        ]
      })
    ]);

    const outline = await buildOutline({
      client,
      transcript: transcriptWith([{ start: 0, text: '内容' }], 800)
    });

    expect(outline.chapters).toEqual([
      { title: '甲', start: 0, end: 400, points: ['甲'] },
      { title: '乙', start: 300, end: 800, points: ['乙'] }
    ]);
  });

  it('accepts a fenced JSON answer', async () => {
    const client = new FakeModelClient([`\`\`\`json\n${validAnswer()}\n\`\`\``]);

    const outline = await buildOutline({
      client,
      transcript: transcriptWith([{ start: 0, text: '内容' }], 600)
    });

    expect(outline.chapters[0]?.title).toBe('开场与概念');
  });

  it('retries once with the validation error in the request', async () => {
    const client = new FakeModelClient(['{"chapters":[]}', validAnswer()]);

    const outline = await buildOutline({
      client,
      transcript: transcriptWith([{ start: 0, text: '内容' }], 600)
    });

    expect(outline.chapters).toHaveLength(1);
    expect(client.calls).toHaveLength(2);
    const retry = client.calls[1]?.messages.at(-1)?.content ?? '';
    expect(retry).toContain('chapters: needs at least one chapter');
  });

  it('fails with DeckStepError after two invalid answers', async () => {
    const client = new FakeModelClient(['{"chapters":[]}', '{"chapters":[]}']);

    await expect(
      buildOutline({
        client,
        transcript: transcriptWith([{ start: 0, text: '内容' }], 600)
      })
    ).rejects.toBeInstanceOf(DeckStepError);
    expect(client.calls).toHaveLength(2);
  });

  it('exposes prompt version 1', () => {
    expect(OUTLINE_PROMPT_VERSION).toBe(1);
  });
});
