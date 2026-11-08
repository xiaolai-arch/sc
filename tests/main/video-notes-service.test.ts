import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { createVideoNotesService, summarizeNote } from '../../src/main/video-notes/service';

const NOW = () => new Date(2026, 10, 8, 20, 0, 0);

function variedText(length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(0x4e00 + ((index * 97 + 13) % 2000));
  }
  return text;
}

const NOTE = [
  '## 一句话总览',
  '',
  '本讲讲集合的定义、元素与子集。',
  '',
  '## 一、集合的定义 [00:00]',
  '',
  '集合是一些确定对象的整体。',
  '',
  '## 二、子集 [03:00]',
  '',
  '子集的每个元素都属于原集合。'
].join('\n');

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function makeMediaFiles(root: string, names: string[]): string[] {
  return names.map((name) => join(root, name));
}

async function fixture(names: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'asaki-video-notes-'));
  const media = makeMediaFiles(root, names);
  await Promise.all(media.map((path) => writeFile(path, 'video', 'utf8')));
  return { root, media };
}

function makeService(options: {
  root: string;
  media: string[];
  responses: string[];
  probeFails?: string[];
  durations?: Record<string, number>;
}) {
  const model = new FakeModelClient(options.responses);
  const progress: Array<{ stage: string; message: string }> = [];
  const service = createVideoNotesService({
    cacheRoot: join(options.root, 'cache'),
    getAsrConfig: async () => ({
      baseURL: 'https://host/v1',
      model: 'mimo-v2.5-asr',
      apiKey: 'test-key'
    }),
    getModelClient: async () => model,
    ensureTools: async () => undefined,
    probe: async (source) => {
      if (options.probeFails?.includes(source)) return 0;
      return options.durations?.[source] ?? 600;
    },
    extract: async (_source, destination) => {
      await writeFile(destination, 'audio', 'utf8');
    },
    createAsr: () => async () => variedText(1000),
    now: NOW
  });
  return { service, model, progress };
}

describe('video notes service', () => {
  let root: string;

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('writes a lesson folder per video and rebuilds the index', async () => {
    const setup = await fixture(['01-集合.mp4', '02-函数.mp4']);
    root = setup.root;
    const outputDir = join(root, 'out');
    const { service, model } = makeService({
      root,
      media: setup.media,
      responses: [NOTE, NOTE]
    });

    const result = await service.generate({
      videoPaths: setup.media,
      outputDir,
      language: 'zh'
    });

    expect(result.failures).toEqual([]);
    expect(result.lessons).toHaveLength(2);
    expect(result.outputDir).toBe(outputDir);
    expect(await exists(result.indexPath)).toBe(true);

    const first = result.lessons[0]!;
    expect(first.title).toBe('01-集合');
    expect(first.lessonDir).toBe(join(outputDir, '01-集合'));
    const markdown = await readFile(first.notesPath, 'utf8');
    expect(markdown).toContain('# 01-集合');
    expect(markdown).toContain('## 一句话总览');
    expect(markdown).toContain('generated_at: 2026-11-08');

    const html = await readFile(first.htmlPath, 'utf8');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('本讲讲集合的定义、元素与子集。');
    expect(html).toContain('#t=0');

    const transcript = JSON.parse(
      await readFile(join(first.lessonDir, 'transcript.json'), 'utf8')
    ) as { chars: number; chunks: Array<{ start: number }> };
    expect(transcript.chars).toBeGreaterThan(0);
    expect(transcript.chunks.map((chunk) => chunk.start)).toEqual([0, 180, 360, 540]);

    const meta = JSON.parse(
      await readFile(join(first.lessonDir, 'meta.json'), 'utf8')
    ) as { summary: string; noteChars: number; sourcePath: string };
    expect(meta.summary).toContain('集合');
    expect(meta.noteChars).toBe(NOTE.length);
    expect(meta.sourcePath).toBe(setup.media[0]);

    const index = await readFile(result.indexPath, 'utf8');
    expect(index).toContain('01-集合');
    expect(index).toContain('02-函数');
    expect(model.calls).toHaveLength(2);
  });

  test('defaults to a 笔记 folder next to the first video', async () => {
    const setup = await fixture(['lesson.mp4']);
    root = setup.root;
    const { service } = makeService({ root, media: setup.media, responses: [NOTE] });

    const result = await service.generate({ videoPaths: setup.media });

    expect(result.outputDir).toBe(join(root, '笔记'));
    expect(result.lessons[0]!.lessonDir).toBe(join(root, '笔记', 'lesson'));
    expect(await exists(join(result.outputDir, 'index.html'))).toBe(true);
  });

  test('keeps successful lessons when another video fails', async () => {
    const setup = await fixture(['good.mp4', 'bad.mp4']);
    root = setup.root;
    const outputDir = join(root, 'out');
    const { service } = makeService({
      root,
      media: setup.media,
      responses: [NOTE],
      probeFails: [setup.media[1]!]
    });

    const result = await service.generate({ videoPaths: setup.media, outputDir });

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.videoPath).toBe(setup.media[1]);
    expect(result.lessons).toHaveLength(1);
    expect(result.lessons[0]!.title).toBe('good');
    const index = await readFile(result.indexPath, 'utf8');
    expect(index).toContain('good');
    expect(index).not.toContain('bad.mp4');
  });

  test('reuses its folder for the same source and never overwrites foreign folders', async () => {
    const setup = await fixture(['lesson.mp4']);
    root = setup.root;
    const outputDir = join(root, 'out');
    await mkdir(join(outputDir, 'lesson'), { recursive: true });
    await writeFile(join(outputDir, 'lesson', 'foreign.txt'), 'keep me', 'utf8');

    const { service } = makeService({ root, media: setup.media, responses: [NOTE, NOTE] });
    const first = await service.generate({ videoPaths: setup.media, outputDir });
    expect(first.lessons[0]!.lessonDir).toBe(join(outputDir, 'lesson-2'));
    expect(await readFile(join(outputDir, 'lesson', 'foreign.txt'), 'utf8')).toBe('keep me');

    const second = await service.generate({ videoPaths: setup.media, outputDir });
    expect(second.lessons).toHaveLength(1);
    expect(second.lessons[0]!.lessonDir).toBe(join(outputDir, 'lesson-2'));
    expect(await exists(join(outputDir, 'lesson-3'))).toBe(false);
  });

  test('reports progress per stage', async () => {
    const setup = await fixture(['lesson.mp4']);
    root = setup.root;
    const { service } = makeService({ root, media: setup.media, responses: [NOTE] });
    const progress: Array<{ stage: string; message: string; total?: number }> = [];

    await service.generate(
      { videoPaths: setup.media, outputDir: join(root, 'out') },
      (entry) => progress.push(entry)
    );

    expect(progress[0]!.stage).toBe('probe');
    expect(progress.some((entry) => entry.stage === 'transcribe')).toBe(true);
    expect(progress.some((entry) => entry.stage === 'notes')).toBe(true);
    expect(progress.at(-1)!.stage).toBe('done');
    const transcription = progress.find((entry) => entry.stage === 'transcribe');
    expect(transcription?.total).toBe(4);
  });

  test('requires an ASR key and a model client', async () => {
    const setup = await fixture(['lesson.mp4']);
    root = setup.root;
    const missingKey = createVideoNotesService({
      cacheRoot: join(root, 'cache'),
      getAsrConfig: async () => ({
        baseURL: 'https://host/v1',
        model: 'm',
        apiKey: null
      }),
      getModelClient: async () => new FakeModelClient([NOTE]),
      ensureTools: async () => undefined
    });
    await expect(
      missingKey.generate({ videoPaths: setup.media, outputDir: join(root, 'out') })
    ).rejects.toThrow(/API key/);

    const missingModel = createVideoNotesService({
      cacheRoot: join(root, 'cache'),
      getAsrConfig: async () => ({
        baseURL: 'https://host/v1',
        model: 'm',
        apiKey: 'key'
      }),
      getModelClient: async () => null,
      ensureTools: async () => undefined
    });
    await expect(
      missingModel.generate({ videoPaths: setup.media, outputDir: join(root, 'out') })
    ).rejects.toThrow(/模型 provider/);
  });

  test('rejects unsupported media before doing any work', async () => {
    const setup = await fixture(['notes.txt']);
    root = setup.root;
    const { service, model } = makeService({ root, media: setup.media, responses: [NOTE] });

    await expect(
      service.generate({ videoPaths: setup.media, outputDir: join(root, 'out') })
    ).rejects.toThrow(/不支持的媒体格式/);
    expect(model.calls).toHaveLength(0);
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