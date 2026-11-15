import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type {
  VideoJob,
  VideoJobLesson,
  VideoJobStatus,
  VideoNotesEnqueueInput,
  VideoNotesEstimate,
  VideoNotesUsage
} from '../../shared/video-notes';
import { readFileOrNull, writeFileAtomic, createMutex } from '../workspace/fs-utils';
import { isSupportedMedia } from './media';
import {
  estimateFromDuration,
  isAbortError,
  type VideoLessonRunInput,
  type VideoLessonRunOutput
} from './service';

/** One task can hold at most this many videos (design 4.6 recommendation A6). */
export const MAX_JOB_VIDEOS = 200;
/** Completed jobs older than this are pruned from the persisted queue. */
export const FINISHED_JOB_LIMIT = 50;
const JOBS_VERSION = 1;
const MAX_SCAN_DEPTH = 12;

export interface VideoJobsOptions {
  filePath: string;
  runLesson: (input: VideoLessonRunInput) => Promise<VideoLessonRunOutput>;
  estimate: (input: { videoPaths: string[] }) => Promise<VideoNotesEstimate>;
  /** Rewrites index.html after a job settles. */
  refreshIndex?: (outputDir: string, videoPaths: string[]) => Promise<void>;
  /** Test seam; production scans the filesystem. */
  scanFolder?: (folder: string) => Promise<string[]>;
  now?: () => Date;
  randomId?: () => string;
  finishedLimit?: number;
  /** IPC snapshots are capped at two per second. */
  emitIntervalMs?: number;
}

export interface VideoJobsService {
  enqueue(input: VideoNotesEnqueueInput): Promise<VideoJob>;
  list(): Promise<VideoJob[]>;
  cancel(id: string): Promise<VideoJob>;
  resume(id: string): Promise<VideoJob>;
  retryLesson(jobId: string, videoPath: string): Promise<VideoJob>;
  remove(id: string): Promise<void>;
  estimate(input: VideoNotesEnqueueInput): Promise<VideoNotesEstimate>;
  /** Resolves once the job reaches a terminal status. */
  settled(id: string): Promise<VideoJob>;
  /** Subscribes to throttled snapshots (newest first). */
  onChanged(listener: (jobs: VideoJob[]) => void): () => void;
  /** Aborts the running job and marks it (and queued work) interrupted. */
  interruptRunning(): Promise<void>;
  dispose(): void;
}

const TERMINAL_STATUSES: readonly VideoJobStatus[] = [
  'done',
  'failed',
  'cancelled',
  'interrupted'
];

const JOB_STATUSES: readonly VideoJobStatus[] = [
  'queued',
  'running',
  'done',
  'failed',
  'cancelled',
  'interrupted'
];

const LESSON_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;

/** Persisted jobs from before the screen-only rewrite say why they cannot run. */
export const LEGACY_QUICK_MESSAGE = '快速笔记已移除，请重新生成课件。';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTerminal(status: VideoJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function emptyUsage(): VideoNotesUsage {
  return { inputTokens: 0, outputTokens: 0 };
}

function addUsage(target: VideoNotesUsage, next: VideoNotesUsage): void {
  target.inputTokens += Number.isFinite(next.inputTokens) ? next.inputTokens : 0;
  target.outputTokens += Number.isFinite(next.outputTokens) ? next.outputTokens : 0;
}

function normalizeUsage(value: unknown): VideoNotesUsage {
  if (!isRecord(value)) return emptyUsage();
  const number = (input: unknown): number =>
    typeof input === 'number' && Number.isFinite(input) && input > 0 ? Math.round(input) : 0;
  return { inputTokens: number(value['inputTokens']), outputTokens: number(value['outputTokens']) };
}

function samePath(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** Natural order so `2` sorts before `10`. */
export function naturalCompare(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

/**
 * Recursively collects supported media files from a course folder. Symlinks
 * are skipped so a loop cannot hang the scan.
 */
export async function scanVideoFolder(
  folder: string,
  limit = MAX_JOB_VIDEOS
): Promise<string[]> {
  const root = resolve(folder);
  const results: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && isSupportedMedia(entry.name)) {
        results.push(join(dir, entry.name));
      }
    }
  }

  await walk(root, 0);
  results.sort(naturalCompare);
  if (results.length > limit) {
    throw new Error(`文件夹中的视频超过 ${limit} 个，请先筛选。`);
  }
  return results;
}

function cloneJob(job: VideoJob): VideoJob {
  return structuredClone(job);
}

function normalizeLesson(value: unknown): VideoJobLesson | null {
  if (!isRecord(value) || typeof value['videoPath'] !== 'string') return null;
  const rawStatus = value['status'];
  const status =
    typeof rawStatus === 'string' && (LESSON_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as VideoJobLesson['status'])
      : 'pending';
  const optionalString = (key: string): string | undefined =>
    typeof value[key] === 'string' ? (value[key] as string) : undefined;
  return {
    videoPath: value['videoPath'],
    status,
    ...(optionalString('step') !== undefined ? { step: optionalString('step') } : {}),
    ...(optionalString('message') !== undefined ? { message: optionalString('message') } : {}),
    ...(optionalString('lessonDir') !== undefined ? { lessonDir: optionalString('lessonDir') } : {}),
    ...(optionalString('title') !== undefined ? { title: optionalString('title') } : {}),
    ...(optionalString('notesPath') !== undefined ? { notesPath: optionalString('notesPath') } : {}),
    ...(optionalString('htmlPath') !== undefined ? { htmlPath: optionalString('htmlPath') } : {}),
    slidesPath: typeof value['slidesPath'] === 'string' ? value['slidesPath'] : null,
    pdfPath: typeof value['pdfPath'] === 'string' ? value['pdfPath'] : null,
    reportPath: typeof value['reportPath'] === 'string' ? value['reportPath'] : null,
    usage: normalizeUsage(value['usage'])
  };
}

function normalizeJob(value: unknown): VideoJob | null {
  if (!isRecord(value)) return null;
  const { id, outputDir, status, createdAt } = value;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof outputDir !== 'string' || outputDir.length === 0) return null;
  if (typeof status !== 'string' || !(JOB_STATUSES as readonly string[]).includes(status)) {
    return null;
  }
  if (typeof createdAt !== 'string') return null;
  const videoPaths = Array.isArray(value['videoPaths'])
    ? value['videoPaths'].filter((entry): entry is string => typeof entry === 'string')
    : [];
  if (videoPaths.length === 0) return null;
  const lessons = Array.isArray(value['lessons'])
    ? value['lessons']
        .map(normalizeLesson)
        .filter((lesson): lesson is VideoJobLesson => lesson !== null)
    : [];
  const estimate = isRecord(value['estimate'])
    ? {
        tokens:
          typeof value['estimate']['tokens'] === 'number' ? value['estimate']['tokens'] : 0,
        minutes:
          typeof value['estimate']['minutes'] === 'number' ? value['estimate']['minutes'] : 0
      }
    : { tokens: 0, minutes: 0 };
  // Quick-note jobs cannot run any more: the queue keeps them visible as failed
  // so the user can remove them, but it never resumes them.
  const legacyQuick = value['mode'] === 'quick';
  if (legacyQuick) {
    for (const lesson of lessons) {
      lesson.status = 'failed';
      lesson.message = LEGACY_QUICK_MESSAGE;
    }
  }
  return {
    id,
    videoPaths,
    outputDir,
    status: legacyQuick ? 'failed' : (status as VideoJobStatus),
    createdAt,
    lessons,
    estimate,
    usage: normalizeUsage(value['usage'])
  };
}

/** Maps a progress stage to the checkpoint step it belongs to. */
function stageToStep(stage: string): string {
  switch (stage) {
    case 'screen':
      return 'screen-read';
    case 'factcheck':
      return 'factcheck-a';
    case 'pdf':
      return 'export';
    case 'done':
      return 'done';
    default:
      return stage;
  }
}

/**
 * A single background queue for video-note jobs. One job runs at a time and
 * lessons inside a job stay sequential; the queue is persisted so a restart
 * can show what was interrupted and resume it from its checkpoints.
 */
export function createVideoJobsService(options: VideoJobsOptions): VideoJobsService {
  const now = options.now ?? (() => new Date());
  const randomId = options.randomId ?? (() => randomUUID());
  const scanFolder = options.scanFolder ?? ((folder: string) => scanVideoFolder(folder));
  const finishedLimit = Math.max(1, options.finishedLimit ?? FINISHED_JOB_LIMIT);
  const emitIntervalMs = Math.max(0, options.emitIntervalMs ?? 500);
  const runExclusively = createMutex();

  let jobs: VideoJob[] = [];
  let running: { jobId: string; controller: AbortController } | null = null;
  let drainPromise: Promise<void> | null = null;
  let emitTimer: ReturnType<typeof setTimeout> | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let lastEmitAt = 0;
  const listeners = new Set<(snapshot: VideoJob[]) => void>();
  const waiters = new Map<string, Array<(job: VideoJob) => void>>();

  function snapshot(): VideoJob[] {
    return [...jobs].reverse().map(cloneJob);
  }

  async function persist(): Promise<void> {
    await runExclusively(() =>
      writeFileAtomic(options.filePath, `${JSON.stringify({ version: JOBS_VERSION, jobs }, null, 2)}\n`)
    );
  }

  function schedulePersist(): void {
    if (persistTimer !== null) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persist().catch(() => undefined);
    }, 250);
    persistTimer.unref?.();
  }

  function flushEmit(): void {
    lastEmitAt = Date.now();
    const current = snapshot();
    for (const listener of listeners) {
      try {
        listener(current);
      } catch {
        // A closed window must not break the queue.
      }
    }
  }

  function scheduleEmit(): void {
    if (listeners.size === 0) return;
    if (emitTimer !== null) return;
    const wait = Math.max(0, emitIntervalMs - (Date.now() - lastEmitAt));
    emitTimer = setTimeout(() => {
      emitTimer = null;
      flushEmit();
    }, wait);
    emitTimer.unref?.();
  }

  function resolveWaiters(job: VideoJob): void {
    const pending = waiters.get(job.id);
    if (!pending) return;
    waiters.delete(job.id);
    const value = cloneJob(job);
    for (const resolveWaiter of pending) resolveWaiter(value);
  }

  function prune(): void {
    const finished = jobs
      .filter((job) => isTerminal(job.status))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const keep = new Set(finished.slice(0, finishedLimit).map((job) => job.id));
    jobs = jobs.filter((job) => !isTerminal(job.status) || keep.has(job.id));
  }

  async function settle(job: VideoJob): Promise<void> {
    try {
      await options.refreshIndex?.(job.outputDir, job.videoPaths);
    } catch {
      // A missing index must not hide the job result.
    }
    prune();
    await persist().catch(() => undefined);
    scheduleEmit();
    resolveWaiters(job);
  }

  function findJob(id: string): VideoJob {
    const job = jobs.find((entry) => entry.id === id);
    if (!job) throw new Error('任务不存在。');
    return job;
  }

  async function runJob(job: VideoJob): Promise<void> {
    job.status = 'running';
    await persist().catch(() => undefined);
    scheduleEmit();

    const controller = new AbortController();
    running = { jobId: job.id, controller };
    const usedNames = new Set<string>();

    try {
      for (const lesson of job.lessons) {
        if (job.status !== 'running' || controller.signal.aborted) break;
        if (lesson.status === 'done') {
          if (lesson.lessonDir) usedNames.add(basename(lesson.lessonDir).toLowerCase());
          continue;
        }

        lesson.status = 'running';
        lesson.message = undefined;
        lesson.step = lesson.step && lesson.step !== 'done' ? lesson.step : 'probe';
        const fromStep = lesson.step;
        schedulePersist();
        scheduleEmit();

        try {
          const output = await options.runLesson({
            videoPath: lesson.videoPath,
            outputDir: job.outputDir,
            signal: controller.signal,
            usedNames,
            ...(lesson.lessonDir ? { lessonDir: lesson.lessonDir } : {}),
            ...(fromStep ? { fromStep } : {}),
            onStage: (stage, message) => {
              lesson.step = stageToStep(stage);
              lesson.message = message;
              schedulePersist();
              scheduleEmit();
            }
          });
          lesson.status = 'done';
          lesson.step = 'done';
          lesson.message = undefined;
          lesson.lessonDir = output.lessonDir;
          lesson.title = output.title;
          lesson.notesPath = output.notesPath;
          lesson.slidesPath = output.slidesPath;
          lesson.pdfPath = output.pdfPath;
          lesson.reportPath = output.reportPath;
          lesson.usage = {
            inputTokens: output.usage.inputTokens,
            outputTokens: output.usage.outputTokens
          };
          addUsage(job.usage, lesson.usage);
          usedNames.add(basename(output.lessonDir).toLowerCase());
        } catch (error) {
          // cancel()/interruptRunning() may have changed the status while the
          // step was awaiting; TypeScript still narrows it to 'running' here.
          const currentStatus = job.status as VideoJobStatus;
          const aborted =
            controller.signal.aborted || isAbortError(error) || currentStatus !== 'running';
          if (aborted) {
            lesson.status = 'pending';
            lesson.message = currentStatus === 'interrupted' ? '已中断' : '已取消';
            break;
          }
          lesson.status = 'failed';
          lesson.message =
            error instanceof Error ? error.message : String(error).slice(0, 500);
        }

        await persist().catch(() => undefined);
        scheduleEmit();
      }
    } finally {
      running = null;
      if (job.status === 'running') {
        const failed = job.lessons.some((lesson) => lesson.status === 'failed');
        const allDone = job.lessons.every(
          (lesson) => lesson.status === 'done' || lesson.status === 'skipped'
        );
        job.status = allDone && !failed ? 'done' : 'failed';
      }
      await settle(job);
    }
  }

  async function drain(): Promise<void> {
    for (;;) {
      const next = jobs.find((job) => job.status === 'queued');
      if (!next) return;
      await runJob(next);
    }
  }

  function scheduleDrain(): void {
    if (drainPromise !== null) return;
    drainPromise = drain()
      .catch(() => undefined)
      .finally(() => {
        drainPromise = null;
        if (jobs.some((job) => job.status === 'queued')) scheduleDrain();
      });
  }

  async function resolveInputPaths(input: VideoNotesEnqueueInput): Promise<string[]> {
    const collected: string[] = [];
    if (typeof input.folder === 'string' && input.folder.trim().length > 0) {
      const folder = input.folder.trim();
      if (!isAbsolute(folder)) throw new Error('文件夹路径无效。');
      collected.push(...(await scanFolder(folder)));
    }
    for (const path of input.videoPaths ?? []) {
      if (typeof path !== 'string' || path.trim().length === 0) {
        throw new Error('视频路径无效。');
      }
      const absolute = resolve(path);
      if (!isAbsolute(path)) throw new Error(`视频路径无效：${basename(path)}`);
      if (!isSupportedMedia(absolute)) {
        throw new Error(`不支持的媒体格式：${basename(absolute)}`);
      }
      if (!collected.some((existing) => samePath(existing, absolute))) {
        collected.push(absolute);
      }
    }
    if (collected.length === 0) throw new Error('请先选择视频文件。');
    if (collected.length > MAX_JOB_VIDEOS) {
      throw new Error(`一次最多处理 ${MAX_JOB_VIDEOS} 个文件。`);
    }
    return collected;
  }

  const loaded = (async () => {
    let raw: string | null;
    try {
      raw = await readFileOrNull(options.filePath);
    } catch {
      // An unreadable queue file must not block new jobs.
      return;
    }
    if (raw === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const entries = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed['jobs'])
        ? parsed['jobs']
        : [];
    const restored = entries
      .map(normalizeJob)
      .filter((job): job is VideoJob => job !== null);
    // Rewriting drops the removed `mode`/`language` fields from old entries.
    let changed = entries.some((entry) => isRecord(entry) && entry['mode'] === 'quick');
    for (const job of restored) {
      // A job cannot still be running after a restart; the user resumes it.
      if (job.status === 'running' || job.status === 'queued') {
        job.status = 'interrupted';
        changed = true;
      }
      for (const lesson of job.lessons) {
        if (lesson.status === 'running') {
          lesson.status = 'pending';
          changed = true;
        }
      }
    }
    jobs = restored;
    if (changed) await persist().catch(() => undefined);
  })();

  async function ready(): Promise<void> {
    await loaded;
  }

  return {
    async enqueue(input) {
      await ready();
      const videoPaths = await resolveInputPaths(input);

      const active = jobs.filter((job) => job.status === 'queued' || job.status === 'running');
      const duplicate = videoPaths.find((path) =>
        active.some((job) => job.videoPaths.some((existing) => samePath(existing, path)))
      );
      if (duplicate) throw new Error(`已在队列中：${basename(duplicate)}`);

      const outputDir = resolve(
        input.outputDir && input.outputDir.trim().length > 0
          ? input.outputDir
          : join(dirname(videoPaths[0]!), '笔记')
      );
      let estimate: VideoNotesEstimate;
      try {
        estimate = await options.estimate({ videoPaths });
      } catch {
        estimate = estimateFromDuration(videoPaths.length, 0);
      }

      const job: VideoJob = {
        id: `job-${randomId()}`,
        videoPaths,
        outputDir,
        status: 'queued',
        createdAt: now().toISOString(),
        lessons: videoPaths.map((videoPath) => ({
          videoPath,
          status: 'pending',
          usage: emptyUsage()
        })),
        estimate: { tokens: estimate.tokens, minutes: estimate.minutes },
        usage: emptyUsage()
      };
      jobs.push(job);
      await persist();
      scheduleEmit();
      scheduleDrain();
      return cloneJob(job);
    },

    async list() {
      await ready();
      return snapshot();
    },

    async cancel(id) {
      await ready();
      const job = findJob(id);
      if (isTerminal(job.status)) return cloneJob(job);
      job.status = 'cancelled';
      for (const lesson of job.lessons) {
        if (lesson.status === 'running') {
          lesson.status = 'pending';
          lesson.message = '已取消';
        }
      }
      if (running?.jobId === job.id) running.controller.abort();
      await persist();
      scheduleEmit();
      resolveWaiters(job);
      return cloneJob(job);
    },

    async resume(id) {
      await ready();
      const job = findJob(id);
      if (job.status === 'queued' || job.status === 'running') return cloneJob(job);
      if (job.status === 'done') throw new Error('任务已完成。');
      for (const lesson of job.lessons) {
        if (lesson.status === 'running' || lesson.status === 'failed') {
          lesson.status = 'pending';
        }
        lesson.message = undefined;
      }
      job.status = 'queued';
      await persist();
      scheduleEmit();
      scheduleDrain();
      return cloneJob(job);
    },

    async retryLesson(jobId, videoPath) {
      await ready();
      const job = findJob(jobId);
      if (job.status === 'queued' || job.status === 'running') {
        throw new Error('任务正在运行，请先取消后再重试。');
      }
      const lesson = job.lessons.find((entry) => samePath(entry.videoPath, videoPath));
      if (!lesson) throw new Error('任务里没有这讲。');
      if (lesson.status === 'done') throw new Error('本讲已完成。');
      lesson.status = 'pending';
      lesson.message = undefined;
      job.status = 'queued';
      await persist();
      scheduleEmit();
      scheduleDrain();
      return cloneJob(job);
    },

    async remove(id) {
      await ready();
      const job = findJob(id);
      if (job.status === 'running' || job.status === 'queued') {
        throw new Error('请先取消正在运行的任务。');
      }
      jobs = jobs.filter((entry) => entry.id !== id);
      waiters.delete(id);
      await persist();
      scheduleEmit();
    },

    async estimate(input) {
      await ready();
      const videoPaths = await resolveInputPaths(input);
      return options.estimate({ videoPaths });
    },

    async settled(id) {
      await ready();
      const job = findJob(id);
      if (isTerminal(job.status)) return cloneJob(job);
      return new Promise<VideoJob>((resolveWaiter) => {
        const pending = waiters.get(id) ?? [];
        pending.push(resolveWaiter);
        waiters.set(id, pending);
      });
    },

    onChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async interruptRunning() {
      await ready();
      const current = running;
      if (current !== null) {
        const job = jobs.find((entry) => entry.id === current.jobId);
        if (job && job.status === 'running') {
          job.status = 'interrupted';
          for (const lesson of job.lessons) {
            if (lesson.status === 'running') {
              lesson.status = 'pending';
              lesson.message = '已中断';
            }
          }
        }
        current.controller.abort();
      }
      for (const job of jobs) {
        if (job.status === 'queued') {
          job.status = 'interrupted';
          for (const lesson of job.lessons) {
            if (lesson.status === 'running') lesson.status = 'pending';
          }
        }
      }
      await persist().catch(() => undefined);
      scheduleEmit();
      for (const job of jobs) {
        if (isTerminal(job.status)) resolveWaiters(job);
      }
    },

    dispose() {
      if (emitTimer !== null) clearTimeout(emitTimer);
      if (persistTimer !== null) clearTimeout(persistTimer);
      emitTimer = null;
      persistTimer = null;
      listeners.clear();
    }
  };
}
