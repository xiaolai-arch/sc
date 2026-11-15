import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import {
  createVideoJobsService,
  LEGACY_QUICK_MESSAGE,
  scanVideoFolder
} from '../../../src/main/video-notes/jobs';
import {
  estimateFromDuration,
  type VideoLessonRunInput,
  type VideoLessonRunOutput
} from '../../../src/main/video-notes/service';
import type { VideoNotesStage } from '../../../src/shared/video-notes';

function outputFor(input: VideoLessonRunInput): VideoLessonRunOutput {
  const lessonDir =
    input.lessonDir ?? join(input.outputDir, basename(input.videoPath, extname(input.videoPath)));
  return {
    lessonDir,
    title: basename(input.videoPath, extname(input.videoPath)),
    durationSeconds: 600,
    screenReadCount: 12,
    noteChars: 50,
    notesPath: join(lessonDir, 'notes.md'),
    slidesPath: join(lessonDir, 'slides.html'),
    pdfPath: join(lessonDir, 'slides.pdf'),
    reportPath: join(lessonDir, 'report.md'),
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
      estimate: async ({ videoPaths }) => estimateFromDuration(videoPaths.length, 600),
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

    const jobA = await jobs.enqueue({ videoPaths: [first] });
    const jobB = await jobs.enqueue({ videoPaths: [second] });
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

    const job = await jobs.enqueue({ videoPaths: [video] });
    await expect(jobs.enqueue({ videoPaths: [video] })).rejects.toThrow(/已在队列中/);
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

    const job = await jobs.enqueue({ videoPaths: [video] });
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
          input.onStage?.('outline', '正在划分章节大纲…');
          throw new Error('大纲失败。');
        }
        return outputFor(input);
      }
    });

    const job = await jobs.enqueue({ videoPaths: [video] });
    const failed = await jobs.settled(job.id);
    expect(failed.status).toBe('failed');
    expect(failed.lessons[0]!.status).toBe('failed');
    expect(failed.lessons[0]!.step).toBe('outline');

    await jobs.retryLesson(job.id, video);
    const done = await jobs.settled(job.id);
    expect(done.status).toBe('done');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.fromStep).toBe('outline');

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

    const job = await jobs.enqueue({ folder: media });
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

  test('maps stages onto their pipeline steps', async () => {
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
      const job = await jobs.enqueue({ videoPaths: [video] });
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

    const first = await jobs.enqueue({ videoPaths: [join(root, '1.mp4')] });
    await jobs.settled(first.id);
    const second = await jobs.enqueue({ videoPaths: [join(root, '2.mp4')] });
    await jobs.settled(second.id);
    const third = await jobs.enqueue({ videoPaths: [join(root, '3.mp4')] });
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

    const job = await jobs.enqueue({ videoPaths: [video] });
    await waitUntil(() => started);
    await jobs.interruptRunning();
    expect((await jobs.settled(job.id)).status).toBe('interrupted');
    jobs.dispose();

    const reloaded = makeJobs();
    const list = await reloaded.list();
    expect(list.find((entry) => entry.id === job.id)?.status).toBe('interrupted');
    reloaded.dispose();
  });

  test('loads a legacy quick-mode job as failed with a migration message', async () => {
    const video = join(root, 'old.mp4');
    await writeFile(video, 'video');
    const legacyJob = {
      id: 'job-old',
      mode: 'quick',
      language: 'zh',
      videoPaths: [video],
      outputDir: join(root, 'out'),
      status: 'queued',
      createdAt: '2026-11-01T00:00:00.000Z',
      lessons: [{ videoPath: video, status: 'running', usage: { inputTokens: 1, outputTokens: 1 } }],
      estimate: { tokens: 50_000, minutes: 10 },
      usage: { inputTokens: 0, outputTokens: 0 }
    };
    await writeFile(join(root, 'jobs.json'), JSON.stringify({ version: 1, jobs: [legacyJob] }));

    const jobs = makeJobs();
    const [job] = await jobs.list();
    expect(job).toBeDefined();
    expect(job!.status).toBe('failed');
    expect(job!.lessons[0]!.status).toBe('failed');
    expect(job!.lessons[0]!.message).toBe(LEGACY_QUICK_MESSAGE);
    // The removed `mode`/`language` fields are dropped on the rewrite.
    const stored = JSON.parse(await readFile(join(root, 'jobs.json'), 'utf8')) as {
      jobs: Array<Record<string, unknown>>;
    };
    expect(stored.jobs[0]).not.toHaveProperty('mode');
    expect(stored.jobs[0]).not.toHaveProperty('language');
    jobs.dispose();
  });
});
