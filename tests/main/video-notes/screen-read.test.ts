import path from 'node:path';
import { FakeModelClient, ModelImageUnsupportedError } from '../../../src/main/agent/model-client';
import type { Keyframe } from '../../../src/main/video-notes/keyframes';
import {
  DEFAULT_SCREEN_READ_TIMEOUT_MS,
  buildScreenPrompt,
  formatScreenLabel,
  markOccluded,
  parseScreenReads,
  readScreens,
  ScreenParseError,
  type ScreenBatchError
} from '../../../src/main/video-notes/screen-read';

function frameAt(t: number, ms = Math.round(t * 1000)): Keyframe {
  return {
    t,
    path: path.join('lesson', 'frames', `${ms}.jpg`),
    sharpness: 0,
    scene: false
  };
}

/** A valid model answer for `count` frames, all simple slides. */
function answerFor(count: number): string {
  return JSON.stringify(
    Array.from({ length: count }, (_, i) => ({
      index: i + 1,
      kind: 'slide',
      text: `第 ${i + 1} 帧`,
      occluded: false,
      keepImage: false
    }))
  );
}

describe('formatScreenLabel', () => {
  it('formats screen times as 〔画面 mm:ss〕', () => {
    expect(formatScreenLabel(754)).toBe('〔画面 12:34〕');
    expect(formatScreenLabel(0)).toBe('〔画面 00:00〕');
    expect(formatScreenLabel(5)).toBe('〔画面 00:05〕');
  });

  it('does not wrap minutes at 60 and pads to two digits', () => {
    expect(formatScreenLabel(6000 + 59)).toBe('〔画面 100:59〕');
  });

  it('clamps negative and non-finite input to zero', () => {
    expect(formatScreenLabel(-3)).toBe('〔画面 00:00〕');
    expect(formatScreenLabel(Number.NaN)).toBe('〔画面 00:00〕');
  });
});

describe('markOccluded', () => {
  it('appends the marker when text has none', () => {
    expect(markOccluded('主谓一致')).toBe('主谓一致〔遮挡〕');
  });

  it('leaves an existing marker alone, wherever it sits', () => {
    expect(markOccluded('主谓〔遮挡〕一致')).toBe('主谓〔遮挡〕一致');
  });

  it('turns empty text into the marker', () => {
    expect(markOccluded('')).toBe('〔遮挡〕');
    expect(markOccluded('   ')).toBe('〔遮挡〕');
  });

  it('is idempotent', () => {
    const once = markOccluded('题干');
    expect(markOccluded(once)).toBe(once);
    expect(markOccluded(markOccluded(once))).toBe(once);
  });
});

describe('buildScreenPrompt', () => {
  it('asks for a strict JSON array with the four-frame limit and every field', () => {
    const prompt = buildScreenPrompt(Array.from({ length: 4 }, (_, i) => frameAt(i)));

    expect(prompt).toContain('JSON 数组');
    expect(prompt).toContain('最多一次处理 4 张画面');
    for (const field of ['index', 'kind', 'text', 'occluded', 'keepImage']) {
      expect(prompt).toContain(field);
    }
    expect(prompt).toContain('speaker-only');
    expect(prompt).toContain('handwriting');
    expect(prompt).toContain('figure');
    expect(prompt).toContain('逐字');
    expect(prompt).toContain('绝不编造');
    expect(prompt).toContain('〔遮挡〕');
  });

  it('refers to frames only by index, never by path', () => {
    const prompt = buildScreenPrompt([frameAt(12), frameAt(30)]);
    expect(prompt).not.toContain('frames/');
    expect(prompt).not.toContain('.jpg');
    expect(prompt).toContain('编号从 1 到 2');
  });
});

describe('parseScreenReads', () => {
  const item =
    '{"index":1,"kind":"slide","text":"题干","occluded":false,"keepImage":false}';

  it('parses fenced JSON', () => {
    const drafts = parseScreenReads('```json\n[' + item + ']\n```');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ index: 1, kind: 'slide', text: '题干' });
  });

  it('parses leading prose', () => {
    expect(parseScreenReads('好的，结果如下：\n[' + item + ']')).toHaveLength(1);
  });

  it('parses trailing prose', () => {
    expect(parseScreenReads('[' + item + ']\n以上是全部结果。')).toHaveLength(1);
  });

  it('drops malformed items instead of inventing reads', () => {
    const drafts = parseScreenReads(
      '[' +
        '{"index":1,"kind":"slide","text":"甲"},' +
        '{"index":2,"kind":"slide"},' +
        '{"index":3,"kind":"mystery","text":"乙"}' +
        ']'
    );
    // The second item has no text and is unreadable; the third keeps its real
    // text and falls back to a known kind.
    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.text)).toEqual(['甲', '乙']);
    expect(drafts[1].kind).toBe('other');
  });

  it('derives occluded and keepImage defaults', () => {
    const drafts = parseScreenReads(
      '[{"index":1,"kind":"slide","text":"被挡住〔遮挡〕"},{"index":2,"kind":"figure","text":""}]'
    );
    expect(drafts[0].occluded).toBe(true);
    expect(drafts[1].keepImage).toBe(true);
  });

  it('throws when there is no JSON array', () => {
    expect(() => parseScreenReads('我无法完成这个请求。')).toThrow(ScreenParseError);
  });
});

describe('readScreens', () => {
  it('maps frames and times from the keyframes, drops speaker-only, marks occlusion', async () => {
    const frames = [frameAt(12), frameAt(30), frameAt(45), frameAt(60)];
    const client = new FakeModelClient([
      JSON.stringify([
        {
          index: 1,
          kind: 'slide',
          text: '名词  动词',
          occluded: false,
          keepImage: false,
          // The model must not be able to smuggle in attribution.
          frame: 'frames/evil.jpg',
          t: 9999
        },
        { index: 2, kind: 'handwriting', text: '注意：主谓一致', occluded: true, keepImage: true },
        { index: 3, kind: 'speaker-only', text: '', occluded: false, keepImage: false },
        { index: 4, kind: 'figure', text: '', occluded: false, keepImage: true }
      ])
    ]);

    const reads = await readScreens({ frames, client });

    expect(reads).toHaveLength(3);
    expect(reads.map((read) => read.frame)).toEqual([
      'frames/12000.jpg',
      'frames/30000.jpg',
      'frames/60000.jpg'
    ]);
    expect(reads.map((read) => read.t)).toEqual([12, 30, 60]);
    expect(reads[0]).toMatchObject({ kind: 'slide', occluded: false, keepImage: false });
    expect(reads[1]).toMatchObject({
      kind: 'handwriting',
      text: '注意：主谓一致〔遮挡〕',
      occluded: true,
      keepImage: true
    });
    expect(reads[2]).toMatchObject({ kind: 'figure', keepImage: true });
  });

  it('reports retained reads per batch through onBatch', async () => {
    const frames = [frameAt(1), frameAt(2)];
    const batches: number[] = [];
    const client = new FakeModelClient([
      JSON.stringify([
        { index: 1, kind: 'slide', text: '甲' },
        { index: 2, kind: 'speaker-only', text: '' }
      ])
    ]);

    await readScreens({ frames, client, onBatch: (reads) => batches.push(reads.length) });

    expect(batches).toEqual([1]);
  });

  it('retries a bad answer once and returns only the entries that parsed', async () => {
    const frames = [frameAt(1), frameAt(2), frameAt(3), frameAt(4)];
    const client = new FakeModelClient([
      '抱歉，我无法输出 JSON。',
      JSON.stringify([
        { index: 1, kind: 'slide', text: '第一帧' },
        { index: 3, kind: 'figure', text: '', keepImage: true }
      ])
    ]);

    const reads = await readScreens({ frames, client });

    expect(client.calls).toHaveLength(2);
    expect(reads.map((read) => read.frame)).toEqual(['frames/1000.jpg', 'frames/3000.jpg']);
    expect(reads.map((read) => read.t)).toEqual([1, 3]);
    // Frames 2 and 4 had no usable answer and must not be invented.
    expect(reads.some((read) => read.t === 2 || read.t === 4)).toBe(false);
  });

  it('surfaces a second failure through onBatchError and omits the batch', async () => {
    const frames = [frameAt(1), frameAt(2), frameAt(3), frameAt(4)];
    const errors: ScreenBatchError[] = [];
    const client = new FakeModelClient(['不是 JSON', '还不是 JSON']);

    const reads = await readScreens({
      frames,
      client,
      onBatchError: (update) => errors.push(update)
    });

    expect(reads).toEqual([]);
    expect(client.calls).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ batch: 0, frames: 4, read: 0 });
    expect(errors[0].message.length).toBeGreaterThan(0);
  });

  it('batches nine frames into 4 / 4 / 1 calls with images in order', async () => {
    const frames = Array.from({ length: 9 }, (_, i) => frameAt((i + 1) * 12));
    const client = new FakeModelClient([answerFor(4), answerFor(4), answerFor(1)]);

    const reads = await readScreens({ frames, client });

    expect(reads).toHaveLength(9);
    expect(client.calls).toHaveLength(3);
    expect(client.calls.map((call) => call.messages[0].images?.length)).toEqual([4, 4, 1]);
    expect(client.calls.map((call) => call.messages[0].images?.map((image) => image.path))).toEqual([
      frames.slice(0, 4).map((frame) => frame.path),
      frames.slice(4, 8).map((frame) => frame.path),
      frames.slice(8).map((frame) => frame.path)
    ]);
    for (const call of client.calls) {
      expect(call.noTools).toBe(true);
      expect(call.timeoutMs).toBe(DEFAULT_SCREEN_READ_TIMEOUT_MS);
      expect(call.messages[0].images?.every((image) => image.mediaType === 'image/jpeg')).toBe(true);
    }
  });

  it('honours a timeout override and never exceeds four frames per call', async () => {
    const frames = Array.from({ length: 3 }, (_, i) => frameAt(i + 1));
    const client = new FakeModelClient([answerFor(3)]);

    await readScreens({ frames, client, timeoutMs: 5_000, batchSize: 10 });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].timeoutMs).toBe(5_000);
    expect(client.calls[0].messages[0].images).toHaveLength(3);
  });

  it('forwards the abort signal to the model request', async () => {
    const controller = new AbortController();
    const client = new FakeModelClient([answerFor(1)]);

    await readScreens({ frames: [frameAt(1)], client, signal: controller.signal });

    expect(client.calls[0].signal).toBe(controller.signal);
  });

  it('throws an abort error without calling the model when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new FakeModelClient([]);

    await expect(
      readScreens({ frames: [frameAt(1)], client, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(client.calls).toHaveLength(0);
  });

  it('propagates ModelImageUnsupportedError unchanged and does not retry', async () => {
    const error = new ModelImageUnsupportedError('zcode');
    const client = new FakeModelClient([error]);

    await expect(readScreens({ frames: [frameAt(1)], client })).rejects.toBe(error);
    expect(client.calls).toHaveLength(1);
  });

  it('returns nothing for an empty frame list without calling the model', async () => {
    const client = new FakeModelClient([]);
    expect(await readScreens({ frames: [], client })).toEqual([]);
    expect(client.calls).toHaveLength(0);
  });
});
