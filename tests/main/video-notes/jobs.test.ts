import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { FakeModelClient } from '../../../src/main/agent/model-client';
import { createVideoJobsService, scanVideoFolder } from '../../../src/main/video-notes/jobs';
import {
  createVideoNotesService,
  estimateFromDuration,
  type VideoLessonRunInput,
  type VideoLessonRunOutput
} from '../../../src/main/video-notes/service';
import type { VideoNotesStage } from '../../../src/shared/video-notes';

const NOW = () => new Date(2026, 10, 15, 12, 0, 0);

function outputFor(input: VideoLessonRunInput): VideoLessonRunOutput {
  const lessonDir =
    input.lessonDir ?? join(input.outputDir, basename(input.videoPath, extname(input.videoPath)));
  return {
    lessonDir,
    title: basename(input.videoPath, extname(input.videoPath)),
    durationSeconds: 600,
    transcriptChars: 100,
    noteChars: 50,
    notesPath: join(lessonDir, 'notes.md'),
    htmlPath: join(lessonDir, 'notes.html'),
    slidesPath: null,
    pdfPath: null,
    reportPath: null,
    usage: { inputTokens: 10, outputTokens: 5 }
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

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
  '集合是一些确定对象的整体。'
].join('\n');

describe('video job queue', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'asaki-video-jobs-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  function makeJobs(
    overrides: Partial<Parameters<typeof createVideoJobsService>[0]> = {}
  ) {
    let counter = 0;
    return createVideoJobsService({
      filePath: join(root, 'jobs.json'),
      now: () => new Date(Date.UTC(2026, 10, 15, 3, 0, counter++)),
      randomId: () => `${++counter}`,
      emitIntervalMs: 0,
      runLesson: async (input) => outputFor(input),
      estimate: async ({ mode, videoPaths }) =>
        estimateFromDuration(mode, videoPaths.length, 600),
      refreshIndex: async () => undefined,
      ...overrides
    });
  }

  test('runs one job at a time and keeps lessons sequential', async () => {
    const first = join(root, '01.mp4');
    const second = join(root, '02.mp4');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: VideoLessonRunInput[] = [];
    const jobs = makeJobs({
      runLesson: async (input) => {
        calls.push(input);
        await gate;
        return outputFor(input);
      }
    });

    const jobA = await jobs.enqueue({ mode: 'quick', videoPaths: [first] });
    const jobB = await jobs.enqueue({ mode: 'quick', videoPaths: [second] });
    await waitUntil(() => calls.length === 1);

    let list = await jobs.list();
    expect(list.find((job) => job.id === jobA.id)?.status).toBe('running');
    expect(list.find((job) => job.id === jobB.id)?.status).toBe('queued');

    release();
    const doneA = await jobs.settled(jobA.id);
    const doneB = await jobs.settled(jobB.id);
    expect(doneA.status).toBe('done');
    expect(doneB.status).toBe('done');
    expect(doneB.lessons[0]!.status).toBe('done');
    expect(calls.map((call) => call.videoPath)).toEqual([first, second]);

    list = await jobs.list();
    expect(list.map((job) => job.status)).toEqual(['done', 'done']);
    jobs.dispose();
  });

  test('rejects a video that is already queued or running', async () => {
    const video = join(root, '01.mp4');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const jobs = makeJobs({
      runLesson: async (input) => {
        await gate;
        return outputFor(input);
      }
    });

    const job = await jobs.enqueue({ mode: 'quick', videoPaths: [video] });
    await expect(
      jobs.enqueue({ mode: 'quick', videoPaths: [video] })
    ).rejects.toThrow(/已在队列中/);
    release();
    await jobs.settled(job.id);
    jobs.dispose();
  });

  test('cancel aborts the step signal and keeps completed checkpoints', async () => {
    const video = join(root, '01.mp4');
    let seen: AbortSignal | null = null;
    const jobs = makeJobs({
      runLesson: (input) =>
        new Promise<VideoLessonRunOutput>((_resolve, reject) => {
          seen = input.signal;
          input.signal.addEventListener('abort', () => {
            const error = new Error('任务已取消。');
            error.name = 'AbortError';
            reject(error);
          });
        })
    });

    const job = await jobs.enqueue({ mode: 'quick', videoPaths: [video] });
    await waitUntil(() => seen !== null);
    const cancelled = await jobs.cancel(job.id);
    expect(cancelled.status).toBe('cancelled');

    const settled = await jobs.settled(job.id);
    expect(settled.status).toBe('cancelled');
    expect(settled.lessons[0]!.status).toBe('pending');
    expect(seen!.aborted).toBe(true);
    jobs.dispose();
  });

  test('retries a failed lesson from its failed step', async () => {
    const video = join(root, '01.mp4');
    const calls: VideoLessonRunInput[] = [];
    const jobs = makeJobs({
      runLesson: async (input) => {
        calls.push(input);
        if (calls.length === 1) {
          input.onStage?.('transcribe', '正在转写音频…');
          throw new Error('转写失败。');
        }
        return outputFor(input);
      }
    });

    const job = await jobs.enqueue({ mode: 'quick', videoPaths: [video] });
    const failed = await jobs.settled(job.id);
    expect(failed.status).toBe('failed');
    expect(failed.lessons[0]!.status).toBe('failed');
    expect(failed.lessons[0]!.step).toBe('transcribe');

    await jobs.retryLesson(job.id, video);
    const done = await jobs.settled(job.id);
    expect(done.status).toBe('done');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.fromStep).toBe('transcribe');

    jobs.dispose();
  });

  test('scans folders recursively in natural order and ignores non-media files', async () => {
    const media = join(root, 'media');
    await mkdir(join(media, 'sub'), { recursive: true });
    await Promise.all([
      writeFile(join(media, '10.mp4'), 'x'),
      writeFile(join(media, '2.mp4'), 'x'),
      writeFile(join(media, 'sub', '3.mp4'), 'x'),
      writeFile(join(media, 'notes.txt'), 'x')
    ]);

    const found = await scanVideoFolder(media);
    expect(found).toEqual([
      join(media, '2.mp4'),
      join(media, '10.mp4'),
      join(media, 'sub', '3.mp4')
    ]);

    await mkdir(join(root, 'big'));
    await Promise.all(
      Array.from({ length: 201 }, (_unused, index) =>
        writeFile(join(root, 'big', `${index + 1}.mp4`), 'x')
      )
    );
    await expect(scanVideoFolder(join(root, 'big'))).rejects.toThrow(/超过 200 个/);
  });

  test('enqueues a whole folder and accumulates usage per lesson', async () => {
    const media = join(root, 'media');
    await mkdir(media, { recursive: true });
    await Promise.all([
      writeFile(join(media, '10.mp4'), 'x'),
      writeFile(join(media, '2.mp4'), 'x')
    ]);
    const jobs = makeJobs();

    const job = await jobs.enqueue({ mode: 'quick', folder: media });
    expect(job.videoPaths).toEqual([join(media, '2.mp4'), join(media, '10.mp4')]);
    expect(job.lessons).toHaveLength(2);

    const settled = await jobs.settled(job.id);
    expect(settled.status).toBe('done');
    expect(settled.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    expect(settled.lessons.map((lesson) => lesson.usage)).toEqual([
      { inputTokens: 10, outputTokens: 5 },
      { inputTokens: 10, outputTokens: 5 }
    ]);
    jobs.dispose();
  });

  test('maps deck stages onto their pipeline steps', async () => {
    const cases: Array<[VideoNotesStage, string]> = [
      ['keyframes', 'keyframes'],
      ['screen', 'screen-read'],
      ['outline', 'outline'],
      ['notes', 'notes'],
      ['enrich', 'enrich'],
      ['factcheck', 'factcheck-a'],
      ['compose', 'compose'],
      ['render', 'render'],
      ['layout', 'layout'],
      ['pdf', 'export'],
      ['report', 'report']
    ];

    for (const [stage, expected] of cases) {
      const video = join(root, `${stage}.mp4`);
      const jobs = makeJobs({
        filePath: join(root, `jobs-${stage}.json`),
        runLesson: async (input) => {
          input.onStage?.(stage, 'working…');
          throw new Error('步骤失败。');
        }
      });
      const job = await jobs.enqueue({ mode: 'deck', videoPaths: [video] });
      const failed = await jobs.settled(job.id);
      expect(failed.lessons[0]!.step).toBe(expected);
      jobs.dispose();
    }
  });

  test('persists the queue and keeps only the newest finished jobs', async () => {
    let tick = 0;
    const jobs = makeJobs({
      finishedLimit: 2,
      now: () => new Date(Date.UTC(2026, 10, 15, 3, 0, tick++))
    });

    const first = await jobs.enqueue({ mode: 'quick', videoPaths: [join(root, '1.mp4')] });
    await jobs.settled(first.id);
    const second = await jobs.enqueue({ mode: 'quick', videoPaths: [join(root, '2.mp4')] });
    await jobs.settled(second.id);
    const third = await jobs.enqueue({ mode: 'quick', videoPaths: [join(root, '3.mp4')] });
    await jobs.settled(third.id);

    const list = await jobs.list();
    expect(list.map((job) => job.id)).toEqual([third.id, second.id]);

    const stored = JSON.parse(await readFile(join(root, 'jobs.json'), 'utf8')) as {
      jobs: Array<{ id: string }>;
    };
    expect(stored.jobs.map((job) => job.id).sort()).toEqual([second.id, third.id].sort());
    jobs.dispose();
  });

  test('marks an interrupted running job and reloads it as interrupted', async () => {
    const video = join(root, '01.mp4');
    let started = false;
    const jobs = makeJobs({
      runLesson: (input) =>
        new Promise<VideoLessonRunOutput>((_resolve, reject) => {
          started = true;
          input.signal.addEventListener('abort', () => {
            const error = new Error('任务已中断。');
            error.name = 'AbortError';
            reject(error);
          });
        })
    });

    const job = await jobs.enqueue({ mode: 'quick', videoPaths: [video] });
    await waitUntil(() => started);
    await jobs.interruptRunning();
    expect((await jobs.settled(job.id)).status).toBe('interrupted');
    jobs.dispose();

    const reloaded = makeJobs();
    const list = await reloaded.list();
    expect(list.find((entry) => entry.id === job.id)?.status).toBe('interrupted');
    reloaded.dispose();
  });

  test('reuses a version-1 lesson folder instead of creating a duplicate', async () => {
    const source = join(root, 'lesson-v1.mp4');
    await writeFile(source, 'video');
    const outputDir = join(root, 'out');
    const lessonDir = join(outputDir, 'lesson-v1');
    await mkdir(lessonDir, { recursive: true });
    await writeFile(
      join(lessonDir, 'meta.json'),
      `${JSON.stringify(
        {
          version: 1,
          sourcePath: source,
          folder: 'lesson-v1',
          title: 'lesson-v1',
          durationSeconds: 600,
          transcriptChars: 10,
          noteChars: 10,
          transcriptModel: 'mimo',
          generatedAt: '2026-11-01',
          summary: '旧版笔记'
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const service = createVideoNotesService({
      cacheRoot: join(root, 'cache'),
      getAsrConfig: async () => ({
        baseURL: 'https://host/v1',
        model: 'mimo-v2.5-asr',
        apiKey: 'test-key'
      }),
      getModelClient: async () => new FakeModelClient([NOTE]),
      getModelName: async () => 'fake-model',
      ensureTools: async () => undefined,
      probe: async () => 600,
      extract: async (_source, destination) => {
        await writeFile(destination, 'audio', 'utf8');
      },
      createAsr: () => async () => variedText(1000),
      now: NOW
    });

    const jobs = makeJobs({
      runLesson: (input) => service.runLesson(input),
      estimate: (input) =>
        service.estimate({ mode: input.mode, videoPaths: input.videoPaths })
    });

    const job = await jobs.enqueue({ mode: 'quick', videoPaths: [source], outputDir });
    const settled = await jobs.settled(job.id);
    expect(settled.status).toBe('done');
    expect(settled.lessons[0]!.lessonDir).toBe(lessonDir);
    expect(await exists(join(outputDir, 'lesson-v1-2'))).toBe(false);

    const meta = JSON.parse(await readFile(join(lessonDir, 'meta.json'), 'utf8')) as {
      version: number;
      mode: string;
      sourcePath: string;
    };
    expect(meta).toMatchObject({ version: 2, mode: 'quick', sourcePath: source });

    jobs.dispose();
  });
});
