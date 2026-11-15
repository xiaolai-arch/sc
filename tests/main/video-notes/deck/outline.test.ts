import { FakeModelClient } from '../../../../src/main/agent/model-client';
import type { Keyframe } from '../../../../src/main/video-notes/keyframes';
import type { ScreenRead } from '../../../../src/main/video-notes/screen-read';
import {
  buildOutline,
  buildOutlinePrompt,
  OUTLINE_PROMPT_VERSION
} from '../../../../src/main/video-notes/deck/outline';
import { DeckStepError } from '../../../../src/main/video-notes/deck/prompts';

function keyframeAt(t: number): Keyframe {
  return {
    t,
    path: `frames/${Math.round(t * 1000)}.jpg`,
    sharpness: 10,
    scene: false
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
  it('includes timestamped screen text and the frame count', () => {
    const prompt = buildOutlinePrompt(
      600,
      [keyframeAt(0), keyframeAt(65)],
      [readAt(0, '集合的定义'), readAt(65, '元素有三个性质'), readAt(65, '集合与元素')]
    );

    expect(prompt).toContain('[00:00] 集合的定义');
    expect(prompt).toContain('[01:05] 元素有三个性质');
    expect(prompt).toContain('集合与元素');
    expect(prompt).toContain('关键帧：2 张');
    expect(prompt).toContain('3–12');
    expect(prompt).toContain('视频时长：10:00');
    // No speech material exists, so the prompt forbids attributing anything to it.
    expect(prompt).toContain('没有语音转写');
    expect(prompt).toContain('老师说');
  });

  it('notes missing screen reads instead of leaving a blank section', () => {
    const prompt = buildOutlinePrompt(60, [keyframeAt(0)]);

    expect(prompt).toContain('（没有可用的画面文字。）');
  });

  it('caps a dense screen digest at roughly the budget', () => {
    const reads = Array.from({ length: 200 }, (_unused, index) =>
      readAt(index * 20, `第 ${index} 段画面文字${'。'.repeat(400)}`)
    );

    const prompt = buildOutlinePrompt(4_000, [keyframeAt(0)], reads);

    expect(prompt.length).toBeLessThan(15_000);
    // The digest is truncated, but it starts from the earliest frame.
    expect(prompt).toContain('第 0 段');
  });

  it('deduplicates identical screen text', () => {
    const prompt = buildOutlinePrompt(600, [], [
      readAt(10, '同一句画面文字'),
      readAt(20, '同一句画面文字')
    ]);

    expect(prompt.split('同一句画面文字')).toHaveLength(2);
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
      durationSeconds: duration,
      keyframes: [keyframeAt(0)],
      screenReads: [readAt(0, '内容')]
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
      durationSeconds: 800,
      keyframes: [],
      screenReads: [readAt(0, '内容')]
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
      durationSeconds: 600,
      keyframes: [],
      screenReads: [readAt(0, '内容')]
    });

    expect(outline.chapters[0]?.title).toBe('开场与概念');
  });

  it('retries once with the validation error in the request', async () => {
    const client = new FakeModelClient(['{"chapters":[]}', validAnswer()]);

    const outline = await buildOutline({
      client,
      durationSeconds: 600,
      keyframes: [],
      screenReads: [readAt(0, '内容')]
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
        durationSeconds: 600,
        keyframes: [],
        screenReads: [readAt(0, '内容')]
      })
    ).rejects.toBeInstanceOf(DeckStepError);
    expect(client.calls).toHaveLength(2);
  });

  it('exposes prompt version 2', () => {
    expect(OUTLINE_PROMPT_VERSION).toBe(2);
  });
});
