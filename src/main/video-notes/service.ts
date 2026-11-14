import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { access, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { formatLocalDate } from '../../shared/date';
import type { ModelClient, ModelResponse, ModelUsage } from '../agent/model-client';
import type {
  VideoNotesEstimate,
  VideoNotesFailure,
  VideoNotesInput,
  VideoNotesLanguage,
  VideoNotesLesson,
  VideoNotesMode,
  VideoNotesProgress,
  VideoNotesResult,
  VideoNotesStage
} from '../../shared/video-notes';
import { writeFileAtomic } from '../workspace/fs-utils';
import { exportDeckPdf, measureDeckHtml } from '../deck-browser';
import { formatDuration, renderIndexHtml, renderLessonHtml, type IndexLesson } from './html';
import { assertMediaTools, extractMp3Chunk, isSupportedMedia, probeDuration } from './media';
import {
  createMimoAsrClient,
  transcribeMedia,
  type MimoAsrConfig,
  type Transcript
} from './mimo';
import { generateNoteBody } from './notes';
import { readCheckpoint, runStep, writeCheckpoint, fingerprintOf } from './checkpoint';
import { extractKeyframes, type Keyframe } from './keyframes';
import { readScreens, type ScreenRead } from './screen-read';
import { collectOverflows, type SlideLayout, type SlideOverflow } from './deck/browser';
import {
  assembleDeck,
  composeChapter,
  refitSlide,
  COMPOSE_PROMPT_VERSION
} from './deck/compose';
import type { DeckNotes, EnrichCard, EnrichResult, FactIssue, Outline } from './deck/content';
import {
  applyContested,
  checkDeck,
  checkMaterial,
  reviseMaterial,
  FACTCHECK_PROMPT_VERSION
} from './deck/factcheck';
import { buildEnrichment, ENRICH_PROMPT_VERSION } from './deck/enrich';
import { buildNotes, renderNotesMarkdown, NOTES_PROMPT_VERSION } from './deck/notes';
import { buildOutline, OUTLINE_PROMPT_VERSION } from './deck/outline';
import { renderDeck } from './deck/render';
import { buildQualityReport } from './deck/report';
import { validateDeck, type Deck, type Slide } from './deck/schema';

export interface AsrConfig {
  baseURL: string;
  model: string;
  /** Never logged or persisted in settings. */
  apiKey: string | null;
}

export interface VideoNotesServiceOptions {
  /** Per-run ASR text caches live under this directory. */
  cacheRoot: string;
  getAsrConfig: () => Promise<AsrConfig>;
  getModelClient: () => Promise<ModelClient | null>;
  /** Model name used in checkpoint fingerprints; empty when unknown. */
  getModelName?: () => Promise<string>;
  now?: () => Date;
  /** Test seams; production uses the ffmpeg-backed implementations. */
  ensureTools?: () => Promise<void>;
  probe?: (source: string, signal?: AbortSignal) => Promise<number>;
  extract?: (
    source: string,
    destination: string,
    startSeconds: number,
    durationSeconds: number,
    signal?: AbortSignal
  ) => Promise<void>;
  createAsr?: (config: MimoAsrConfig) => (audio: Buffer, language: VideoNotesLanguage) => Promise<string>;
  /** Deck pipeline: keyframe extraction; production uses ffmpeg. */
  extractFrames?: (input: {
    videoPath: string;
    durationSeconds: number;
    outDir: string;
    signal: AbortSignal;
  }) => Promise<Keyframe[]>;
  /** Deck pipeline: layout measurement and PDF export; production uses Electron. */
  deckBrowser?: {
    measure(html: string): Promise<SlideLayout[]>;
    exportPdf(html: string, pdfPath: string): Promise<{ slides: number; bytes: number }>;
  };
}

export interface VideoLessonRunInput {
  mode: VideoNotesMode;
  videoPath: string;
  outputDir: string;
  language: VideoNotesLanguage;
  signal: AbortSignal;
  /** Folder names already claimed by the running job. */
  usedNames?: Set<string>;
  /** A lesson folder the job already created; ignored when outside outputDir. */
  lessonDir?: string;
  /** Re-runs this step and every later one (retry from a failed step). */
  fromStep?: string;
  onStage?: (
    stage: VideoNotesStage,
    message: string,
    extra?: Pick<VideoNotesProgress, 'current' | 'total'>
  ) => void;
}

export interface VideoLessonRunOutput {
  lessonDir: string;
  title: string;
  durationSeconds: number;
  transcriptChars: number;
  noteChars: number;
  notesPath: string;
  htmlPath: string;
  slidesPath: string | null;
  pdfPath: string | null;
  reportPath: string | null;
  usage: ModelUsage;
}

export interface VideoNotesService {
  /** Legacy batch call: keeps the pre-queue behaviour for its tests. */
  generate(
    input: VideoNotesInput,
    onProgress?: (progress: VideoNotesProgress) => void
  ): Promise<VideoNotesResult>;
  /** Runs one lesson with checkpoint skip/resume; used by the job queue. */
  runLesson(input: VideoLessonRunInput): Promise<VideoLessonRunOutput>;
  /** Rewrites index.html from every lesson folder that carries a meta.json. */
  refreshIndex(
    outputDir: string,
    videoPaths?: string[]
  ): Promise<{ indexPath: string; lessons: VideoNotesLesson[] }>;
  estimate(input: {
    mode: VideoNotesMode;
    videoPaths: string[];
    language?: VideoNotesLanguage;
  }): Promise<VideoNotesEstimate>;
}

/**
 * Pipeline steps in execution order. Quick mode runs probe, transcribe and
 * render (design 4.1 steps 1, 2, 10); deck mode runs every step after
 * transcribe. `meta` is written last but never checkpointed, so it is not here.
 */
export const VIDEO_NOTES_STEPS = [
  'probe',
  'transcribe',
  'keyframes',
  'screen-read',
  'outline',
  'notes',
  'enrich',
  'factcheck-a',
  'compose',
  'render',
  'layout',
  'factcheck-b',
  'export',
  'report'
] as const;
export type VideoNotesStep = (typeof VIDEO_NOTES_STEPS)[number];

/** Bump when the note prompt or its options change, to invalidate checkpoints. */
export const NOTE_PROMPT_VERSION = 1;

/**
 * The screen-read prompt has no exported version constant of its own; bump this
 * when its instructions or batch shape change so saved reads are re-requested.
 */
export const SCREEN_READ_PROMPT_VERSION = 1;

/** Layout corrections per deck; the design fixes this at two rounds. */
export const MAX_LAYOUT_ROUNDS = 2;

/** Program-generated shell pages are never handed to the refit model. */
const SHELL_SLIDE_TYPES: readonly Slide['type'][] = ['cover', 'agenda', 'summary'];

const MAX_FOLDER_ATTEMPTS = 500;
const QUICK_TOKENS_PER_LESSON = 50_000;
const DECK_TOKENS_PER_MINUTE = 11_000;
/** Fallback when ffprobe cannot report a duration. */
const FALLBACK_LESSON_MINUTES = 30;

interface LessonMetaBase {
  sourcePath: string;
  folder: string;
  title: string;
  durationSeconds: number;
  transcriptChars: number;
  noteChars: number;
  transcriptModel: string;
  generatedAt: string;
  summary: string;
}

interface LessonMeta extends LessonMetaBase {
  version: 1 | 2;
  mode?: VideoNotesMode;
  slidesPath?: string | null;
  pdfPath?: string | null;
  reportPath?: string | null;
  slideCount?: number;
}

const MODES: readonly VideoNotesMode[] = ['quick', 'deck'];

function isMode(value: unknown): value is VideoNotesMode {
  return typeof value === 'string' && (MODES as readonly string[]).includes(value);
}

export function abortError(): Error {
  const error = new Error('任务已取消。');
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true;
    if ((error as { code?: unknown }).code === 'ABORT_ERR') return true;
    return /aborted|abort/i.test(error.message);
  }
  return false;
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function stepIndex(step: string | undefined): number {
  return step === undefined ? -1 : (VIDEO_NOTES_STEPS as readonly string[]).indexOf(step);
}

function shouldForce(step: VideoNotesStep, fromStep: string | undefined): boolean {
  const from = stepIndex(fromStep);
  return from >= 0 && stepIndex(step) >= from;
}

/** Injects the job signal into every model request (prompts own the client). */
function withAbortSignal(client: ModelClient, signal: AbortSignal): ModelClient {
  return {
    complete(request) {
      return client.complete({ ...request, signal: request.signal ?? signal });
    }
  };
}

export interface UsageTracker {
  /** Client that records the usage of every call it forwards. */
  client: ModelClient;
  /** Returns the usage accumulated since the previous call, then resets it. */
  take(): ModelUsage;
}

function addUsageTo(target: ModelUsage, next: ModelUsage | undefined): void {
  if (next === undefined) return;
  target.inputTokens += Number.isFinite(next.inputTokens) ? next.inputTokens : 0;
  target.outputTokens += Number.isFinite(next.outputTokens) ? next.outputTokens : 0;
}

/**
 * Wraps a client so each pipeline step can take exactly its own token usage
 * and store it in its checkpoint. `take()` resets the counter, so a step that
 * fails halfway cannot leak its usage into the next one.
 */
export function withUsageTracker(client: ModelClient): UsageTracker {
  let pending: ModelUsage = { inputTokens: 0, outputTokens: 0 };
  return {
    client: {
      async complete(request): Promise<ModelResponse> {
        const response = await client.complete(request);
        addUsageTo(pending, response.usage);
        return response;
      }
    },
    take() {
      const taken = pending;
      pending = { inputTokens: 0, outputTokens: 0 };
      return taken;
    }
  };
}

function report(
  onProgress: ((progress: VideoNotesProgress) => void) | undefined,
  progress: VideoNotesProgress
): void {
  try {
    onProgress?.(progress);
  } catch {
    // A renderer that unmounted mid-run must not abort the pipeline.
  }
}

function samePath(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Keeps Windows/macOS reserved characters out of the folder name. */
export function sanitizeFolderName(value: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
    .trim();
  if (cleaned.length === 0 || cleaned === '.' || cleaned === '..') return '未命名课程';
  // CON, NUL, COM1 … cannot be used as file or folder names on Windows.
  return WINDOWS_RESERVED.test(cleaned) ? `${cleaned}-课程` : cleaned;
}

export function lessonTitleFor(sourcePath: string): string {
  const name = basename(sourcePath, extname(sourcePath)).trim();
  return name.length > 0 ? name : '未命名课程';
}

function nullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

/** Reads both meta versions; v1 folders must keep being reused by the index. */
async function readMeta(dir: string): Promise<LessonMeta | null> {
  try {
    const raw = await readFile(join(dir, 'meta.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<LessonMeta>;
    if (parsed.version !== 1 && parsed.version !== 2) return null;
    if (
      typeof parsed.sourcePath !== 'string' ||
      typeof parsed.folder !== 'string' ||
      typeof parsed.title !== 'string' ||
      typeof parsed.durationSeconds !== 'number' ||
      typeof parsed.transcriptChars !== 'number' ||
      typeof parsed.noteChars !== 'number' ||
      typeof parsed.transcriptModel !== 'string' ||
      typeof parsed.generatedAt !== 'string' ||
      typeof parsed.summary !== 'string'
    ) {
      return null;
    }
    if (parsed.version === 2 && !isMode(parsed.mode)) return null;
    if (
      !nullableString(parsed.slidesPath) ||
      !nullableString(parsed.pdfPath) ||
      !nullableString(parsed.reportPath)
    ) {
      return null;
    }
    // A lesson folder is always a direct child; a tampered meta must not make
    // the index read or link outside the output directory.
    if (basename(parsed.folder) !== parsed.folder || parsed.folder === '.' || parsed.folder === '..') {
      return null;
    }
    return parsed as LessonMeta;
  } catch {
    return null;
  }
}

async function directoryHasEntries(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

/**
 * Picks a lesson folder. A folder this tool wrote for the same source is reused;
 * a folder with foreign content is never overwritten.
 */
async function allocateLessonDir(
  root: string,
  sourcePath: string,
  usedNames: Set<string>
): Promise<{ dir: string; folder: string }> {
  const base = sanitizeFolderName(lessonTitleFor(sourcePath));
  for (let attempt = 0; attempt < MAX_FOLDER_ATTEMPTS; attempt += 1) {
    const folder = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const key = folder.toLowerCase();
    if (usedNames.has(key)) continue;
    const dir = join(root, folder);
    const meta = await readMeta(dir);
    if (meta !== null) {
      if (samePath(meta.sourcePath, sourcePath)) {
        usedNames.add(key);
        return { dir, folder };
      }
      continue;
    }
    if (await directoryHasEntries(dir)) continue;
    usedNames.add(key);
    return { dir, folder };
  }
  throw new Error(`无法为《${lessonTitleFor(sourcePath)}》分配输出文件夹。`);
}

async function transcriptCacheDir(
  cacheRoot: string,
  sourcePath: string,
  language: VideoNotesLanguage,
  model: string
): Promise<string> {
  const info = await stat(sourcePath).catch(() => null);
  const hash = createHash('sha1')
    .update(resolve(sourcePath))
    .update('|')
    .update(String(info?.size ?? 0))
    .update('|')
    .update(String(info?.mtimeMs ?? 0))
    .update('|')
    .update(language)
    .update('|')
    .update(model)
    .digest('hex');
  return join(cacheRoot, hash);
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildNotesMarkdown(options: {
  title: string;
  sourcePath: string;
  durationSeconds: number;
  transcript: Transcript;
  body: string;
  generatedAt: string;
}): string {
  return [
    '---',
    `title: ${yamlString(options.title)}`,
    `source: ${yamlString(options.sourcePath)}`,
    `duration_seconds: ${Math.round(options.durationSeconds)}`,
    `transcript_model: ${yamlString(options.transcript.model)}`,
    `generated_at: ${options.generatedAt}`,
    '---',
    '',
    `# ${options.title}`,
    '',
    `> 来源：${options.sourcePath} · 时长 ${formatDuration(options.durationSeconds)} · 转录 ${options.transcript.chars} 字`,
    '',
    options.body.trim(),
    ''
  ].join('\n');
}

/** The one-line summary used on the course index card. */
export function summarizeNote(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const overview = /##\s*一句话总览\s*\n+([\s\S]*?)(?=\n##\s|$)/.exec(normalized)?.[1];
  const fallback = normalized
    .split('\n')
    .find((line) => {
      const trimmed = line.trim();
      return (
        trimmed.length > 0 &&
        !trimmed.startsWith('#') &&
        !trimmed.startsWith('>') &&
        !trimmed.startsWith('---') &&
        !trimmed.startsWith('|')
      );
    });
  const source = overview ?? fallback ?? '';
  const text = source
    .replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0) return '（本讲暂无摘要）';
  return text.length > 120 ? `${text.slice(0, 118)}…` : text;
}

/** Deepest shared directory of the source files. */
export function commonDirectory(paths: string[]): string {
  if (paths.length === 0) return '';
  const split = paths.map((path) => resolve(dirname(path)).split(/[\\/]+/));
  const first = split[0]!;
  let length = first.length;
  for (const parts of split.slice(1)) {
    let index = 0;
    while (
      index < length &&
      index < parts.length &&
      parts[index]!.toLowerCase() === first[index]!.toLowerCase()
    ) {
      index += 1;
    }
    length = index;
  }
  const joined = first.slice(0, length).join(sep);
  return joined.length > 0 ? joined : dirname(resolve(paths[0]!));
}

function courseTitle(videoPaths: string[], outputDir: string): string {
  const common = commonDirectory(videoPaths);
  const name = common ? basename(common) : '';
  return name.length > 0 ? name : basename(outputDir);
}

/** Rewrites index.html from every lesson folder that carries a meta.json. */
async function rebuildIndex(
  outputDir: string,
  title: string,
  generatedAt: string
): Promise<{ indexPath: string; lessons: VideoNotesLesson[] }> {
  let entries: Dirent[];
  try {
    entries = await readdir(outputDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const metas: LessonMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await readMeta(join(outputDir, entry.name));
    if (meta !== null) metas.push(meta);
  }
  metas.sort(
    (left, right) =>
      left.folder.localeCompare(right.folder, 'zh-CN', { numeric: true }) ||
      left.sourcePath.localeCompare(right.sourcePath, 'zh-CN', { numeric: true })
  );

  const indexPath = join(outputDir, 'index.html');
  if (metas.length > 0) {
    const lessons: IndexLesson[] = metas.map((meta) => ({
      folder: meta.folder,
      title: meta.title,
      durationSeconds: meta.durationSeconds,
      transcriptChars: meta.transcriptChars,
      noteChars: meta.noteChars,
      summary: meta.summary
    }));
    await writeFileAtomic(indexPath, renderIndexHtml({ title, generatedAt, lessons }));
  }
  return {
    indexPath,
    lessons: metas.map((meta) => {
      const dir = join(outputDir, meta.folder);
      return {
        sourcePath: meta.sourcePath,
        lessonDir: dir,
        title: meta.title,
        durationSeconds: meta.durationSeconds,
        transcriptChars: meta.transcriptChars,
        noteChars: meta.noteChars,
        notesPath: join(dir, 'notes.md'),
        htmlPath: join(dir, 'notes.html')
      };
    })
  };
}

interface RenderStepOutput {
  title: string;
  folder: string;
  lessonDir: string;
  durationSeconds: number;
  transcriptChars: number;
  noteChars: number;
  transcriptModel: string;
  generatedAt: string;
  summary: string;
  notesPath: string;
  htmlPath: string;
  slidesPath: string | null;
  pdfPath: string | null;
  reportPath: string | null;
  slideCount: number;
}

/** A keyframe as saved in the checkpoint: the basename keeps the folder movable. */
interface SavedKeyframe {
  t: number;
  name: string;
  sharpness: number;
  scene: boolean;
}

interface KeyframeStepOutput {
  frames: SavedKeyframe[];
}

interface DeckRenderStepOutput {
  slidesPath: string;
  bytes: number;
  deckFingerprint: string;
}

interface DeckLayoutStepOutput {
  deck: Deck;
  slides: SlideLayout[];
  overflows: SlideOverflow[];
  rounds: number;
}

interface FactcheckAStepOutput {
  issues: FactIssue[];
  notes: DeckNotes;
  cards: EnrichCard[];
}

interface FactcheckBStepOutput {
  issues: FactIssue[];
  deck: Deck;
}

function renderOutputComplete(output: RenderStepOutput | undefined): output is RenderStepOutput {
  return (
    output !== undefined &&
    output !== null &&
    typeof output.lessonDir === 'string' &&
    typeof output.title === 'string' &&
    typeof output.notesPath === 'string' &&
    typeof output.htmlPath === 'string'
  );
}

function renderOutputMatches(
  output: RenderStepOutput | undefined,
  videoPath: string
): Promise<boolean> {
  if (!renderOutputComplete(output)) return Promise.resolve(false);
  return readMeta(output.lessonDir).then(
    (meta) => meta !== null && meta.version === 2 && samePath(meta.sourcePath, videoPath)
  );
}

/**
 * Rebuilds a deck from a flattened slide list: every slide keeps the chapter it
 * came from, so the layout step can replace one page with one or two pages
 * without disturbing chapter order.
 */
function rebuildDeck(source: Deck, entries: ReadonlyArray<{ chapter: number; slide: Slide }>): Deck {
  return {
    ...source,
    chapters: source.chapters.map((chapter, chapterIndex) => ({
      title: chapter.title,
      start: chapter.start,
      slides: entries
        .filter((entry) => entry.chapter === chapterIndex)
        .map((entry) => entry.slide)
    }))
  };
}

export function estimateFromDuration(
  mode: VideoNotesMode,
  lessons: number,
  durationSeconds: number
): VideoNotesEstimate {
  const knownMinutes = durationSeconds > 0 ? durationSeconds / 60 : 0;
  const minutesPerLesson = knownMinutes > 0 ? knownMinutes / Math.max(1, lessons) : FALLBACK_LESSON_MINUTES;
  const totalMinutes = knownMinutes > 0 ? knownMinutes : minutesPerLesson * lessons;
  const tokens =
    mode === 'deck'
      ? Math.round(totalMinutes * DECK_TOKENS_PER_MINUTE)
      : Math.max(1, lessons) * QUICK_TOKENS_PER_LESSON;
  const estimateMinutes =
    mode === 'deck'
      ? Math.max(1, Math.round(totalMinutes * 1.5))
      : Math.max(1, Math.round(totalMinutes * 0.5));
  return {
    lessons: Math.max(0, lessons),
    durationSeconds: Math.max(0, Math.round(durationSeconds)),
    tokens,
    minutes: estimateMinutes
  };
}

export function createVideoNotesService(options: VideoNotesServiceOptions): VideoNotesService {
  const now = options.now ?? (() => new Date());
  const ensureTools = options.ensureTools ?? assertMediaTools;
  const probe = options.probe ?? probeDuration;
  const extract = options.extract ?? extractMp3Chunk;
  const createAsr = options.createAsr ?? ((config) => createMimoAsrClient(config));
  const extractFrames =
    options.extractFrames ??
    ((input: { videoPath: string; durationSeconds: number; outDir: string; signal: AbortSignal }) =>
      extractKeyframes(input));
  const deckBrowser = options.deckBrowser ?? {
    measure: (html: string) => measureDeckHtml(html),
    exportPdf: (html: string, pdfPath: string) => exportDeckPdf(html, pdfPath)
  };
  let busy = false;
  let toolsReady: Promise<void> | null = null;

  /** ffmpeg is checked once per process; a failed check is retried next time. */
  function ensureToolsOnce(): Promise<void> {
    if (toolsReady === null) {
      toolsReady = ensureTools().catch((error: unknown) => {
        toolsReady = null;
        throw error;
      });
    }
    return toolsReady;
  }

  async function resolveLessonDir(
    outputDir: string,
    videoPath: string,
    usedNames: Set<string>,
    preferred: string | undefined
  ): Promise<{ dir: string; folder: string }> {
    if (preferred) {
      const dir = resolve(preferred);
      const root = resolve(outputDir);
      const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
      if (dir !== root && dir.startsWith(prefix)) {
        const folder = basename(dir);
        usedNames.add(folder.toLowerCase());
        return { dir, folder };
      }
      // Otherwise ignore a stale or tampered directory outside the output root.
    }
    const allocated = await allocateLessonDir(outputDir, videoPath, usedNames);
    return allocated;
  }

  async function fileExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  interface DeckRunContext {
    videoPath: string;
    lessonDir: string;
    folder: string;
    title: string;
    durationSeconds: number;
    transcript: Transcript;
    modelClient: ModelClient;
    modelName: string;
    signal: AbortSignal;
    fromStep: string | undefined;
    emit: (
      stage: VideoNotesStage,
      message: string,
      extra?: Pick<VideoNotesProgress, 'current' | 'total'>
    ) => void;
  }

  /**
   * Deck mode, design 4.1 steps 3–15: keyframes → screen-read → outline →
   * notes → enrich → factcheck-a → compose → render → layout → factcheck-b →
   * export → report → meta. Every step goes through `runStep`, so a resumed
   * lesson skips whatever is unchanged and keeps the earlier checkpoints.
   */
  async function runDeckPipeline(context: DeckRunContext): Promise<VideoLessonRunOutput> {
    const {
      videoPath,
      lessonDir,
      folder,
      title,
      durationSeconds,
      transcript,
      modelName,
      signal,
      fromStep,
      emit
    } = context;
    const startedAt = Date.now();
    const framesDir = join(lessonDir, 'frames');
    const notesPath = join(lessonDir, 'notes.md');
    const slidesPath = join(lessonDir, 'slides.html');
    const pdfPath = join(lessonDir, 'slides.pdf');
    const reportPath = join(lessonDir, 'report.md');

    const tracker = withUsageTracker(withAbortSignal(context.modelClient, signal));
    const model = tracker.client;
    const totalUsage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
    const addUsage = (usage: ModelUsage | undefined): void => addUsageTo(totalUsage, usage);

    /** Runs one step body and attributes exactly its model usage to it. */
    async function tracked<T>(work: () => Promise<T>): Promise<{ output: T; usage: ModelUsage }> {
      tracker.take(); // drop residue from an earlier failed attempt
      const output = await work();
      return { output, usage: tracker.take() };
    }

    // Step 2 artifact: the transcript is written next to the deck outputs.
    await writeFileAtomic(
      join(lessonDir, 'transcript.json'),
      `${JSON.stringify(transcript, null, 2)}\n`
    );
    const transcriptSignature = fingerprintOf(transcript);

    // Step 3: keyframes -----------------------------------------------------
    emit('keyframes', '正在抽取关键帧…');
    const keyframeFingerprint = fingerprintOf({
      step: 'keyframes',
      source: videoPath,
      durationSeconds
    });
    const extractKeyframeStep = (force: boolean) =>
      runStep<KeyframeStepOutput>({
        lessonDir,
        step: 'keyframes',
        force,
        fingerprint: keyframeFingerprint,
        run: () =>
          tracked(async () => {
            throwIfAborted(signal);
            const frames = await extractFrames({
              videoPath,
              durationSeconds,
              outDir: framesDir,
              signal
            });
            return {
              frames: frames.map((frame) => ({
                t: frame.t,
                name: basename(frame.path),
                sharpness: frame.sharpness,
                scene: frame.scene
              }))
            };
          }),
        now
      });

    let keyframeStep = await extractKeyframeStep(shouldForce('keyframes', fromStep));
    if (keyframeStep.skipped) {
      // frames/ may have been deleted; re-extract rather than fail downstream.
      const missing = await Promise.all(
        keyframeStep.output.frames.map((frame) =>
          fileExists(join(framesDir, frame.name)).then((exists) => !exists)
        )
      );
      if (missing.some(Boolean)) keyframeStep = await extractKeyframeStep(true);
    }
    addUsage(keyframeStep.usage);
    throwIfAborted(signal);

    const keyframes: Keyframe[] = keyframeStep.output.frames.map((frame) => ({
      t: frame.t,
      path: join(framesDir, frame.name),
      sharpness: frame.sharpness,
      scene: frame.scene
    }));
    const frames = new Map<string, string>(
      keyframes.map((frame) => [`frames/${basename(frame.path)}`, frame.path])
    );

    // Step 4: screen-read ---------------------------------------------------
    emit('screen', '正在读取屏幕上的文字…');
    let screenReadCount = 0;
    const screenStep = await runStep<ScreenRead[]>({
      lessonDir,
      step: 'screen-read',
      force: shouldForce('screen-read', fromStep),
      fingerprint: fingerprintOf({
        step: 'screen-read',
        upstream: keyframeStep.output,
        promptVersion: SCREEN_READ_PROMPT_VERSION,
        model: modelName
      }),
      run: () =>
        tracked(async () => {
          throwIfAborted(signal);
          return readScreens({
            frames: keyframes,
            client: model,
            signal,
            onBatch: (batch) => {
              screenReadCount += batch.length;
              emit('screen', `正在读取屏幕上的文字（已读 ${screenReadCount} 条）…`, {
                current: screenReadCount,
                total: keyframes.length
              });
            }
          });
        }),
      now
    });
    addUsage(screenStep.usage);
    const screenReads = screenStep.output;
    throwIfAborted(signal);

    // Step 5: outline -------------------------------------------------------
    emit('outline', '正在划分章节大纲…');
    const outlineStep = await runStep<Outline>({
      lessonDir,
      step: 'outline',
      force: shouldForce('outline', fromStep),
      fingerprint: fingerprintOf({
        step: 'outline',
        upstream: { transcript: transcriptSignature, screen: screenStep.output },
        promptVersion: OUTLINE_PROMPT_VERSION,
        model: modelName
      }),
      run: () =>
        tracked(() =>
          buildOutline({ client: model, transcript, screenReads, signal })
        ),
      now
    });
    addUsage(outlineStep.usage);
    const outline = outlineStep.output;
    throwIfAborted(signal);

    // Step 6: notes ---------------------------------------------------------
    emit('notes', '正在整理分章笔记…（这一步可能需要几分钟）');
    const notesStep = await runStep<DeckNotes>({
      lessonDir,
      step: 'notes',
      force: shouldForce('notes', fromStep),
      fingerprint: fingerprintOf({
        step: 'notes',
        upstream: {
          transcript: transcriptSignature,
          outline: outlineStep.output,
          screen: screenStep.output
        },
        promptVersion: NOTES_PROMPT_VERSION,
        model: modelName
      }),
      run: () =>
        tracked(() =>
          buildNotes({
            client: model,
            transcript,
            outline,
            screenReads,
            signal
          })
        ),
      now
    });
    addUsage(notesStep.usage);
    const notesMarkdown = renderNotesMarkdown(notesStep.output, {
      title,
      durationSeconds,
      sourcePath: videoPath
    });
    await writeFileAtomic(notesPath, notesMarkdown);
    throwIfAborted(signal);

    // Step 7: enrich --------------------------------------------------------
    emit('enrich', '正在补充复习卡片…');
    const enrichStep = await runStep<EnrichResult>({
      lessonDir,
      step: 'enrich',
      force: shouldForce('enrich', fromStep),
      fingerprint: fingerprintOf({
        step: 'enrich',
        upstream: {
          notes: notesStep.output,
          outline: outlineStep.output,
          transcript: transcriptSignature,
          screen: screenStep.output
        },
        promptVersion: ENRICH_PROMPT_VERSION,
        model: modelName
      }),
      run: () =>
        tracked(() =>
          buildEnrichment({
            client: model,
            notes: notesStep.output,
            outline,
            transcript,
            screenReads,
            signal
          })
        ),
      now
    });
    addUsage(enrichStep.usage);
    throwIfAborted(signal);

    // Step 8: fact-check A (notes + cards) ----------------------------------
    emit('factcheck', '正在核查笔记和补充卡片…');
    const factcheckAStep = await runStep<FactcheckAStepOutput>({
      lessonDir,
      step: 'factcheck-a',
      force: shouldForce('factcheck-a', fromStep),
      fingerprint: fingerprintOf({
        step: 'factcheck-a',
        upstream: {
          notes: notesStep.output,
          cards: enrichStep.output.cards,
          transcript: transcriptSignature
        },
        promptVersion: FACTCHECK_PROMPT_VERSION,
        model: modelName
      }),
      run: () =>
        tracked(async () => {
          throwIfAborted(signal);
          const checked = await checkMaterial({
            client: model,
            notes: notesStep.output,
            cards: enrichStep.output.cards,
            transcript,
            signal
          });
          if (checked.issues.length === 0) {
            return {
              issues: checked.issues,
              notes: notesStep.output,
              cards: enrichStep.output.cards
            };
          }
          const revised = await reviseMaterial({
            client: model,
            notes: notesStep.output,
            cards: enrichStep.output.cards,
            issues: checked.issues,
            transcript,
            signal
          });
          return { issues: checked.issues, notes: revised.notes, cards: revised.cards };
        }),
      now
    });
    addUsage(factcheckAStep.usage);
    const verifiedNotes = factcheckAStep.output.notes;
    const verifiedCards = factcheckAStep.output.cards;
    throwIfAborted(signal);

    // Step 9: compose (one call per chapter) --------------------------------
    emit('compose', '正在合成课件…');
    const composeStep = await runStep<Deck>({
      lessonDir,
      step: 'compose',
      force: shouldForce('compose', fromStep),
      fingerprint: fingerprintOf({
        step: 'compose',
        upstream: {
          outline: outlineStep.output,
          notes: verifiedNotes,
          cards: verifiedCards,
          screen: screenStep.output,
          keyframes: keyframeStep.output
        },
        promptVersion: COMPOSE_PROMPT_VERSION,
        model: modelName
      }),
      run: () =>
        tracked(async () => {
          const chapters: Array<{
            title: string;
            start: number;
            slides: Slide[];
            keyPoints: string[];
          }> = [];
          for (const [chapterIndex, chapter] of outline.chapters.entries()) {
            throwIfAborted(signal);
            emit(
              'compose',
              `正在合成课件（第 ${chapterIndex + 1}/${outline.chapters.length} 章）…`,
              { current: chapterIndex + 1, total: outline.chapters.length }
            );
            const chapterNotes = verifiedNotes.chapters[chapterIndex] ?? verifiedNotes.chapters.find(
              (entry) => entry.title.trim() === chapter.title.trim()
            );
            if (chapterNotes === undefined) {
              throw new Error(`第「${chapter.title}」章没有可用的笔记。`);
            }
            const slides = await composeChapter({
              client: model,
              chapter,
              notes: chapterNotes,
              cards: verifiedCards.filter((card) => card.chapter.trim() === chapter.title.trim()),
              screenReads,
              keyframes,
              durationSeconds,
              chapterIndex,
              chapterCount: outline.chapters.length,
              signal
            });
            chapters.push({
              title: chapter.title,
              start: chapter.start,
              slides,
              keyPoints: chapterNotes.keyPoints
            });
          }
          return assembleDeck({
            title,
            sourcePath: videoPath,
            durationSeconds,
            outline,
            chapters
          });
        }),
      now
    });
    addUsage(composeStep.usage);
    const composedDeck = composeStep.output;
    throwIfAborted(signal);

    // Step 10: render -------------------------------------------------------
    function renderHtml(deck: Deck): string {
      return renderDeck(deck, { sourcePath: videoPath, frames });
    }

    async function persistRender(deck: Deck, force: boolean): Promise<string> {
      const html = renderHtml(deck);
      const step = await runStep<DeckRenderStepOutput>({
        lessonDir,
        step: 'render',
        force: force || shouldForce('render', fromStep),
        fingerprint: fingerprintOf({
          step: 'render',
          mode: 'deck',
          upstream: { deck: fingerprintOf(deck), htmlBytes: html.length }
        }),
        run: () =>
          tracked(async () => {
            await writeFileAtomic(slidesPath, html);
            return {
              slidesPath,
              bytes: Buffer.byteLength(html, 'utf8'),
              deckFingerprint: fingerprintOf(deck)
            };
          }),
        now
      });
      addUsage(step.usage);
      if (step.skipped && !(await fileExists(slidesPath))) {
        await writeFileAtomic(slidesPath, html);
      }
      return html;
    }

    emit('render', '正在渲染课件页面…');
    const renderedHtml = await persistRender(composedDeck, false);
    throwIfAborted(signal);

    // Step 11: layout -------------------------------------------------------
    async function refitDeck(deck: Deck, overflows: readonly SlideOverflow[]): Promise<Deck> {
      let flat: Array<{ chapter: number; slide: Slide }> = [];
      deck.chapters.forEach((chapter, chapterIndex) => {
        for (const slide of chapter.slides) flat.push({ chapter: chapterIndex, slide });
      });

      let shift = 0;
      for (const overflow of [...overflows].sort((left, right) => left.index - right.index)) {
        throwIfAborted(signal);
        const position = overflow.index + shift;
        const target = flat[position];
        if (target === undefined) continue;
        // The shell pages are program-generated; the refit prompt forbids them.
        if (SHELL_SLIDE_TYPES.includes(target.slide.type)) continue;
        const chapterTitle = deck.chapters[target.chapter]?.title ?? '';
        const refitted = await refitSlide({
          client: model,
          slide: target.slide,
          excessPx: overflow.excessPx,
          chapterTitle,
          signal
        });
        const next = [
          ...flat.slice(0, position),
          ...refitted.map((slide) => ({ chapter: target.chapter, slide })),
          ...flat.slice(position + 1)
        ];
        const candidate = rebuildDeck(deck, next);
        try {
          validateDeck(candidate, { framePaths: frames.keys() });
        } catch {
          // A refit that breaks the deck rules is dropped; the overflow stays
          // in the report rather than failing the whole lesson.
          continue;
        }
        shift += refitted.length - 1;
        flat = next;
      }
      return rebuildDeck(deck, flat);
    }

    async function performLayout(layoutInput: {
      deck: Deck;
      html: string;
      force: boolean;
    }): Promise<DeckLayoutStepOutput> {
      const step = await runStep<DeckLayoutStepOutput>({
        lessonDir,
        step: 'layout',
        force: layoutInput.force || shouldForce('layout', fromStep),
        fingerprint: fingerprintOf({
          step: 'layout',
          mode: 'deck',
          upstream: {
            deck: fingerprintOf(layoutInput.deck),
            htmlBytes: layoutInput.html.length
          },
          promptVersion: COMPOSE_PROMPT_VERSION,
          model: modelName
        }),
        run: () =>
          tracked(async () => {
            let deck = layoutInput.deck;
            let html = layoutInput.html;
            emit('layout', '正在检查版面…');
            let slides = await deckBrowser.measure(html);
            let overflows = collectOverflows(slides);
            let rounds = 0;
            while (overflows.length > 0 && rounds < MAX_LAYOUT_ROUNDS) {
              throwIfAborted(signal);
              rounds += 1;
              emit('layout', `正在重排超出的页面（第 ${rounds} 轮）…`);
              deck = await refitDeck(deck, overflows);
              html = renderHtml(deck);
              await writeFileAtomic(slidesPath, html);
              slides = await deckBrowser.measure(html);
              overflows = collectOverflows(slides);
            }
            if (overflows.length === 0) emit('layout', '版面检查通过。');
            return { deck, slides, overflows, rounds };
          }),
        now
      });
      addUsage(step.usage);
      return step.output;
    }

    let layout = await performLayout({
      deck: composedDeck,
      html: renderedHtml,
      force: false
    });
    let finalDeck = layout.deck;
    let finalOverflows = layout.overflows;
    // Always rewrite: the file must match the (possibly refitted) final deck
    // even when the layout step itself was skipped.
    await writeFileAtomic(slidesPath, renderHtml(finalDeck));
    throwIfAborted(signal);

    // Step 12: fact-check B (whole deck) ------------------------------------
    emit('factcheck', '正在逐页核查课件…');
    const factcheckBStep = await runStep<FactcheckBStepOutput>({
      lessonDir,
      step: 'factcheck-b',
      force: shouldForce('factcheck-b', fromStep),
      fingerprint: fingerprintOf({
        step: 'factcheck-b',
        upstream: { deck: fingerprintOf(finalDeck), notes: verifiedNotes },
        promptVersion: FACTCHECK_PROMPT_VERSION,
        model: modelName
      }),
      run: () =>
        tracked(async () => {
          throwIfAborted(signal);
          const checked = await checkDeck({
            client: model,
            deck: finalDeck,
            notes: verifiedNotes,
            signal
          });
          return { issues: checked.issues, deck: applyContested(checked.deck, checked.issues) };
        }),
      now
    });
    addUsage(factcheckBStep.usage);
    const checkedDeck = factcheckBStep.output.deck;

    if (JSON.stringify(checkedDeck) !== JSON.stringify(finalDeck)) {
      // The fact-check changed pages: render and lay out the final content once
      // more (design 4.1: steps 10–11 run again, at most once).
      throwIfAborted(signal);
      emit('render', '正在重新渲染课件页面…');
      const checkedHtml = await persistRender(checkedDeck, true);
      layout = await performLayout({ deck: checkedDeck, html: checkedHtml, force: true });
      finalDeck = layout.deck;
      finalOverflows = layout.overflows;
      await writeFileAtomic(slidesPath, renderHtml(finalDeck));
    }
    throwIfAborted(signal);

    // Step 13: export -------------------------------------------------------
    emit('pdf', '正在导出 PDF…');
    const exportStep = await runStep<{ pdfPath: string; bytes: number }>({
      lessonDir,
      step: 'export',
      force: shouldForce('export', fromStep),
      fingerprint: fingerprintOf({
        step: 'export',
        mode: 'deck',
        upstream: { deck: fingerprintOf(finalDeck), slidesPath }
      }),
      run: () =>
        tracked(async () => {
          throwIfAborted(signal);
          const result = await deckBrowser.exportPdf(renderHtml(finalDeck), pdfPath);
          return { pdfPath, bytes: result.bytes };
        }),
      now
    });
    addUsage(exportStep.usage);
    if (exportStep.skipped && !(await fileExists(pdfPath))) {
      await deckBrowser.exportPdf(renderHtml(finalDeck), pdfPath);
    }
    throwIfAborted(signal);

    // Step 14: report -------------------------------------------------------
    emit('report', '正在生成质量报告…');
    const slideCount = finalDeck.chapters.reduce(
      (count, chapter) => count + chapter.slides.length,
      0
    );
    const reportMarkdown = buildQualityReport({
      title,
      durationSeconds,
      mode: 'deck',
      transcriptChars: transcript.chars,
      chunkCount: transcript.chunks.length,
      keyframeCount: keyframes.length,
      screenReadCount: screenReads.length,
      deck: finalDeck,
      overflow: finalOverflows,
      issuesA: factcheckAStep.output.issues,
      issuesB: factcheckBStep.output.issues,
      usage: { ...totalUsage },
      elapsedMs: Date.now() - startedAt
    });
    const reportStep = await runStep<{ reportPath: string }>({
      lessonDir,
      step: 'report',
      force: shouldForce('report', fromStep),
      fingerprint: fingerprintOf({
        step: 'report',
        mode: 'deck',
        upstream: {
          deck: fingerprintOf(finalDeck),
          issuesA: factcheckAStep.output.issues,
          issuesB: factcheckBStep.output.issues,
          overflow: finalOverflows,
          keyframeCount: keyframes.length,
          screenReadCount: screenReads.length,
          usage: totalUsage
        }
      }),
      run: async () => ({ output: { reportPath } }),
      now
    });
    addUsage(reportStep.usage);
    await writeFileAtomic(reportPath, reportMarkdown);

    // Step 15: meta (written last, never checkpointed) ----------------------
    const noteChars = notesMarkdown.trim().length;
    const overview =
      verifiedNotes.chapters[0]?.keyPoints[0] ?? verifiedNotes.chapters[0]?.blocks[0]?.text ?? '';
    const summary = summarizeNote(
      overview.trim().length === 0 ? '' : `## 一句话总览\n\n${overview}`
    );
    const meta: LessonMeta = {
      version: 2,
      mode: 'deck',
      sourcePath: videoPath,
      folder,
      title,
      durationSeconds,
      transcriptChars: transcript.chars,
      noteChars,
      transcriptModel: transcript.model,
      generatedAt: formatLocalDate(now()),
      summary,
      slidesPath,
      pdfPath,
      reportPath,
      slideCount
    };
    await writeFileAtomic(join(lessonDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

    emit('done', '本讲课件已生成。');
    return {
      lessonDir,
      title,
      durationSeconds,
      transcriptChars: transcript.chars,
      noteChars,
      notesPath,
      // Deck mode has no notes.html; the deck itself is the reading artifact.
      htmlPath: '',
      slidesPath,
      pdfPath,
      reportPath,
      usage: { ...totalUsage }
    };
  }

  async function runLesson(input: VideoLessonRunInput): Promise<VideoLessonRunOutput> {
    const { signal } = input;
    throwIfAborted(signal);
    const videoPath = resolve(input.videoPath);
    if (!isSupportedMedia(videoPath)) {
      throw new Error(`不支持的媒体格式：${basename(videoPath)}`);
    }
    const language: VideoNotesLanguage = input.language ?? 'auto';
    if (language !== 'auto' && language !== 'zh' && language !== 'en') {
      throw new Error('转写语言无效。');
    }
    const mode: VideoNotesMode = input.mode ?? 'quick';
    if (!isMode(mode)) throw new Error('生成模式无效。');
    const outputDir = resolve(input.outputDir);

    const [asrConfig, modelClient, modelName] = await Promise.all([
      options.getAsrConfig(),
      options.getModelClient(),
      options.getModelName ? options.getModelName() : Promise.resolve('')
    ]);
    if (!asrConfig.apiKey) {
      throw new Error('请先在设置中配置语音转写 API key。');
    }
    if (modelClient === null) {
      throw new Error('生成笔记需要一个可用的模型 provider，请先到设置中配置。');
    }
    await ensureToolsOnce();
    throwIfAborted(signal);

    await mkdir(outputDir, { recursive: true });
    await mkdir(options.cacheRoot, { recursive: true });
    const usedNames = input.usedNames ?? new Set<string>();
    const { dir: lessonDir, folder } = await resolveLessonDir(
      outputDir,
      videoPath,
      usedNames,
      input.lessonDir
    );
    await mkdir(lessonDir, { recursive: true });

    const emit = (
      stage: VideoNotesStage,
      message: string,
      extra?: Pick<VideoNotesProgress, 'current' | 'total'>
    ) => {
      try {
        input.onStage?.(stage, message, extra);
      } catch {
        // Progress reporting must never abort the pipeline.
      }
    };
    const fromStep = input.fromStep;

    const sourceInfo = await stat(videoPath).catch(() => null);

    // Step 1: probe ---------------------------------------------------------
    emit('probe', '正在读取视频信息…');
    const durationStep = await runStep<{ durationSeconds: number }>({
      lessonDir,
      step: 'probe',
      force: shouldForce('probe', fromStep),
      fingerprint: fingerprintOf({
        step: 'probe',
        source: videoPath,
        size: sourceInfo?.size ?? 0,
        mtimeMs: sourceInfo?.mtimeMs ?? 0
      }),
      run: async () => {
        const durationSeconds = await probe(videoPath, signal);
        return { output: { durationSeconds } };
      },
      now
    });
    const durationSeconds = durationStep.output.durationSeconds;
    if (!(durationSeconds > 0)) {
      throw new Error('无法读取视频时长，文件可能损坏或不是有效的媒体文件。');
    }
    throwIfAborted(signal);

    // Step 2: transcribe ----------------------------------------------------
    emit('audio', '正在提取音频…');
    const cacheDir = await transcriptCacheDir(
      options.cacheRoot,
      videoPath,
      language,
      asrConfig.model
    );
    const asr = createAsr({
      baseURL: asrConfig.baseURL,
      model: asrConfig.model,
      apiKey: asrConfig.apiKey,
      signal
    });
    const transcriptStep = await runStep<Transcript>({
      lessonDir,
      step: 'transcribe',
      force: shouldForce('transcribe', fromStep),
      fingerprint: fingerprintOf({
        step: 'transcribe',
        upstream: durationStep.output,
        source: videoPath,
        size: sourceInfo?.size ?? 0,
        mtimeMs: sourceInfo?.mtimeMs ?? 0,
        language,
        asrModel: asrConfig.model
      }),
      run: async () => {
        const transcript = await transcribeMedia(videoPath, {
          durationSeconds,
          cacheDir,
          encode: (destination, start, duration) =>
            extract(videoPath, destination, start, duration, signal),
          asr,
          language,
          model: asrConfig.model,
          signal,
          onProgress: (current, total) =>
            emit('transcribe', `正在转写音频（${current}/${total}）…`, { current, total })
        });
        if (transcript.chars === 0 || transcript.text.trim().length === 0) {
          throw new Error('没有识别到有效语音内容。');
        }
        return { output: transcript };
      },
      now
    });
    const transcript = transcriptStep.output;
    throwIfAborted(signal);

    if (mode === 'deck') {
      return runDeckPipeline({
        videoPath,
        lessonDir,
        folder,
        title: lessonTitleFor(videoPath),
        durationSeconds,
        transcript,
        modelClient,
        modelName,
        signal,
        fromStep,
        emit
      });
    }

    // Step 10: render (quick notes) ----------------------------------------
    const title = lessonTitleFor(videoPath);
    const renderFingerprint = fingerprintOf({
      step: 'render',
      upstream: { probe: durationStep.output, transcriptSignature: fingerprintOf(transcript) },
      promptVersion: NOTE_PROMPT_VERSION,
      model: modelName,
      options: { mode, temperature: 0.2, maxTokens: 12_000 }
    });
    const existingRender = shouldForce('render', fromStep)
      ? null
      : await readCheckpoint<RenderStepOutput>(lessonDir, 'render');
    let rendered: RenderStepOutput | null = null;
    let renderUsage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
    if (
      existingRender !== null &&
      existingRender.fingerprint === renderFingerprint &&
      (await renderOutputMatches(existingRender.output, videoPath))
    ) {
      rendered = existingRender.output;
      renderUsage = existingRender.usage;
      emit('html', '本讲已完成，跳过。');
    } else {
      emit('notes', '正在生成笔记…（这一步可能需要几分钟）');
      throwIfAborted(signal);
      const generated = await generateNoteBody(withAbortSignal(modelClient, signal), {
        title,
        sourcePath: videoPath,
        durationSeconds,
        transcript
      });
      throwIfAborted(signal);
      if (generated.body.trim().length === 0) {
        throw new Error('模型没有返回笔记内容。');
      }

      emit('html', '正在写入笔记和 HTML…');
      const generatedAt = formatLocalDate(now());
      const notesPath = join(lessonDir, 'notes.md');
      const htmlPath = join(lessonDir, 'notes.html');
      const markdown = buildNotesMarkdown({
        title,
        sourcePath: videoPath,
        durationSeconds,
        transcript,
        body: generated.body,
        generatedAt
      });
      const summary = summarizeNote(generated.body);
      const meta: LessonMeta = {
        version: 2,
        mode,
        sourcePath: videoPath,
        folder,
        title,
        durationSeconds,
        transcriptChars: transcript.chars,
        noteChars: generated.body.length,
        transcriptModel: transcript.model,
        generatedAt,
        summary,
        // Phase 0 only ships quick notes; the deck pipeline fills these later.
        slidesPath: null,
        pdfPath: null,
        reportPath: null,
        slideCount: 0
      };

      await writeFileAtomic(
        join(lessonDir, 'transcript.json'),
        `${JSON.stringify(transcript, null, 2)}\n`
      );
      await writeFileAtomic(notesPath, markdown);
      await writeFileAtomic(
        htmlPath,
        renderLessonHtml({
          title,
          sourcePath: videoPath,
          durationSeconds,
          transcriptChars: transcript.chars,
          transcriptModel: transcript.model,
          generatedAt,
          markdown: generated.body
        })
      );
      // Written last: a half-written lesson must not be picked up by the index.
      await writeFileAtomic(join(lessonDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);

      rendered = {
        title,
        folder,
        lessonDir,
        durationSeconds,
        transcriptChars: transcript.chars,
        noteChars: generated.body.length,
        transcriptModel: transcript.model,
        generatedAt,
        summary,
        notesPath,
        htmlPath,
        slidesPath: null,
        pdfPath: null,
        reportPath: null,
        slideCount: 0
      };
      renderUsage = generated.usage;
      await writeCheckpoint(lessonDir, 'render', {
        version: 1,
        step: 'render',
        fingerprint: renderFingerprint,
        output: rendered,
        usage: renderUsage,
        finishedAt: now().toISOString()
      });
    }

    emit('done', '本讲笔记已生成。');
    return {
      lessonDir: rendered.lessonDir,
      title: rendered.title,
      durationSeconds: rendered.durationSeconds,
      transcriptChars: rendered.transcriptChars,
      noteChars: rendered.noteChars,
      notesPath: rendered.notesPath,
      htmlPath: rendered.htmlPath,
      slidesPath: rendered.slidesPath,
      pdfPath: rendered.pdfPath,
      reportPath: rendered.reportPath,
      usage: {
        inputTokens: renderUsage.inputTokens,
        outputTokens: renderUsage.outputTokens
      }
    };
  }

  async function refreshIndex(
    outputDir: string,
    videoPaths?: string[]
  ): Promise<{ indexPath: string; lessons: VideoNotesLesson[] }> {
    const root = resolve(outputDir);
    const title =
      videoPaths && videoPaths.length > 0 ? courseTitle(videoPaths, root) : basename(root);
    return rebuildIndex(root, title, formatLocalDate(now()));
  }

  async function run(
    input: VideoNotesInput,
    onProgress?: (progress: VideoNotesProgress) => void
  ): Promise<VideoNotesResult> {
    if (!input || !Array.isArray(input.videoPaths) || input.videoPaths.length === 0) {
      throw new Error('请先选择视频文件。');
    }
    const language: VideoNotesLanguage = input.language ?? 'auto';
    if (language !== 'auto' && language !== 'zh' && language !== 'en') {
      throw new Error('转写语言无效。');
    }
    const videoPaths = [
      ...new Set(
        input.videoPaths
          .filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
          .map((path) => resolve(path))
      )
    ];
    if (videoPaths.length === 0) throw new Error('请先选择视频文件。');
    const unsupported = videoPaths.find((path) => !isSupportedMedia(path));
    if (unsupported) {
      throw new Error(`不支持的媒体格式：${basename(unsupported)}`);
    }

    const outputDir = resolve(
      input.outputDir && input.outputDir.trim().length > 0
        ? input.outputDir
        : join(dirname(videoPaths[0]!), '笔记')
    );
    // Preflight once so a missing key/provider rejects the whole batch before
    // a lesson folder is created (the queue path reports it per lesson).
    const [asrConfig, modelClient] = await Promise.all([
      options.getAsrConfig(),
      options.getModelClient()
    ]);
    if (!asrConfig.apiKey) {
      throw new Error('请先在设置中配置语音转写 API key。');
    }
    if (modelClient === null) {
      throw new Error('生成笔记需要一个可用的模型 provider，请先到设置中配置。');
    }
    await ensureToolsOnce();
    const controller = new AbortController();
    const usedNames = new Set<string>();
    const failures: VideoNotesFailure[] = [];

    for (let videoIndex = 0; videoIndex < videoPaths.length; videoIndex += 1) {
      const videoPath = videoPaths[videoIndex]!;
      try {
        await runLesson({
          mode: 'quick',
          videoPath,
          outputDir,
          language,
          signal: controller.signal,
          usedNames,
          onStage: (stage, message, extra) =>
            report(onProgress, {
              videoIndex,
              videoCount: videoPaths.length,
              videoPath,
              stage,
              message,
              ...extra
            })
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ videoPath, message });
        report(onProgress, {
          videoIndex,
          videoCount: videoPaths.length,
          videoPath,
          stage: 'error',
          message
        });
      }
    }

    const index = await refreshIndex(outputDir, videoPaths);
    return {
      outputDir,
      indexPath: index.indexPath,
      lessons: index.lessons,
      failures
    };
  }

  return {
    async generate(input, onProgress) {
      if (busy) throw new Error('已有视频笔记任务在运行，请等待它完成。');
      busy = true;
      try {
        return await run(input, onProgress);
      } finally {
        busy = false;
      }
    },
    runLesson,
    refreshIndex,
    async estimate(input) {
      let durationSeconds = 0;
      for (const path of input.videoPaths) {
        const duration = await probe(path).catch(() => 0);
        durationSeconds += duration > 0 ? duration : 0;
      }
      return estimateFromDuration(input.mode, input.videoPaths.length, durationSeconds);
    }
  };
}
