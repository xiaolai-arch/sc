import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelClient } from '../../src/main/agent/model-client';
import {
  createVideoNotesService,
  estimateFromDuration,
  summarizeNote
} from '../../src/main/video-notes/service';

const NOW = () => new Date(2026, 10, 8, 20, 0, 0);

describe('video notes service preflight', () => {
  let root: string;

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('rejects unsupported media before doing any work', async () => {
    root = await mkdtemp(join(tmpdir(), 'asaki-video-notes-'));
    const notes = join(root, 'notes.txt');
    await writeFile(notes, 'text', 'utf8');
    const model = new FakeModelClient([]);
    const service = createVideoNotesService({
      getModelClient: async () => model,
      ensureTools: async () => undefined,
      now: NOW
    });

    await expect(
      service.generate({ videoPaths: [notes], outputDir: join(root, 'out') })
    ).rejects.toThrow(/不支持的媒体格式/);
    expect(model.calls).toHaveLength(0);
  });

  test('requires a model provider', async () => {
    root = await mkdtemp(join(tmpdir(), 'asaki-video-notes-'));
    const video = join(root, 'lesson.mp4');
    await writeFile(video, 'video', 'utf8');
    const service = createVideoNotesService({
      getModelClient: async () => null,
      ensureTools: async () => undefined,
      now: NOW
    });

    await expect(
      service.generate({ videoPaths: [video], outputDir: join(root, 'out') })
    ).rejects.toThrow(/模型 provider/);
  });
});

describe('estimateFromDuration', () => {
  test('counts 11,000 tokens per minute of video and 1.5× minutes', () => {
    expect(estimateFromDuration(2, 1200)).toEqual({
      lessons: 2,
      durationSeconds: 1200,
      tokens: 220_000,
      minutes: 30
    });
  });

  test('falls back to a 30 minute lesson when the duration is unknown', () => {
    expect(estimateFromDuration(1, 0)).toEqual({
      lessons: 1,
      durationSeconds: 0,
      tokens: 330_000,
      minutes: 45
    });
  });
});

describe('summarizeNote', () => {
  test('uses the overview section and strips markdown', () => {
    expect(summarizeNote(`## 一句话总览\n\n**本讲**讲[集合](https://x) [00:12]。\n\n## 一、内容`)).toBe(
      '本讲 讲集合 。'
    );
  });

  test('falls back to the first paragraph', () => {
    expect(summarizeNote('## 一、内容\n\n第一段内容。\n\n第二段。')).toBe('第一段内容。');
  });

  test('handles an empty note', () => {
    expect(summarizeNote('')).toBe('（本讲暂无摘要）');
  });
});
