import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { formatLocalDate } from '../../shared/date';
import type { ModelClient } from '../agent/model-client';
import type {
  VideoNotesFailure,
  VideoNotesInput,
  VideoNotesLanguage,
  VideoNotesLesson,
  VideoNotesProgress,
  VideoNotesResult,
  VideoNotesStage
} from '../../shared/video-notes';
import { formatDuration, renderIndexHtml, renderLessonHtml, type IndexLesson } from './html';
import { assertMediaTools, extractMp3Chunk, isSupportedMedia, probeDuration } from './media';
import {
  createMimoAsrClient,
  transcribeMedia,
  type MimoAsrConfig,
  type Transcript
} from './mimo';
import { generateNoteBody } from './notes';

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
  now?: () => Date;
  /** Test seams; production uses the ffmpeg-backed implementations. */
  ensureTools?: () => Promise<void>;
  probe?: (source: string) => Promise<number>;
  extract?: (
    source: string,
    destination: string,
    startSeconds: number,
    durationSeconds: number
  ) => Promise<void>;
  createAsr?: (config: MimoAsrConfig) => (audio: Buffer, language: VideoNotesLanguage) => Promise<string>;
}

export interface VideoNotesService {
  generate(
    input: VideoNotesInput,
    onProgress?: (progress: VideoNotesProgress) => void
  ): Promise<VideoNotesResult>;
}

const META_VERSION = 1;
const MAX_FOLDER_ATTEMPTS = 500;

interface LessonMeta {
  version: typeof META_VERSION;
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

async function readMeta(dir: string): Promise<LessonMeta | null> {
  try {
    const raw = await readFile(join(dir, 'meta.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<LessonMeta>;
    if (
      parsed.version !== META_VERSION ||
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
    await writeFile(indexPath, renderIndexHtml({ title, generatedAt, lessons }), 'utf8');
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

export function createVideoNotesService(options: VideoNotesServiceOptions): VideoNotesService {
  const now = options.now ?? (() => new Date());
  const ensureTools = options.ensureTools ?? assertMediaTools;
  const probe = options.probe ?? probeDuration;
  const extract = options.extract ?? extractMp3Chunk;
  const createAsr = options.createAsr ?? ((config) => createMimoAsrClient(config));
  let busy = false;

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
    await ensureTools();

    await mkdir(outputDir, { recursive: true });
    await mkdir(options.cacheRoot, { recursive: true });

    const asr = createAsr({
      baseURL: asrConfig.baseURL,
      model: asrConfig.model,
      apiKey: asrConfig.apiKey
    });
    const usedNames = new Set<string>();
    const lessons: VideoNotesLesson[] = [];
    const failures: VideoNotesFailure[] = [];

    for (let videoIndex = 0; videoIndex < videoPaths.length; videoIndex += 1) {
      const videoPath = videoPaths[videoIndex]!;
      const emit = (
        stage: VideoNotesStage,
        message: string,
        extra: Pick<VideoNotesProgress, 'current' | 'total'> = {}
      ) =>
        report(onProgress, {
          videoIndex,
          videoCount: videoPaths.length,
          videoPath,
          stage,
          message,
          ...extra
        });

      try {
        emit('probe', '正在读取视频信息…');
        const durationSeconds = await probe(videoPath);
        if (!(durationSeconds > 0)) {
          throw new Error('无法读取视频时长，文件可能损坏或不是有效的媒体文件。');
        }

        emit('audio', '正在提取音频…');
        const cacheDir = await transcriptCacheDir(
          options.cacheRoot,
          videoPath,
          language,
          asrConfig.model
        );
        const transcript = await transcribeMedia(videoPath, {
          durationSeconds,
          cacheDir,
          encode: (destination, start, duration) =>
            extract(videoPath, destination, start, duration),
          asr,
          language,
          model: asrConfig.model,
          onProgress: (current, total) =>
            emit('transcribe', `正在转写音频（${current}/${total}）…`, { current, total })
        });
        if (transcript.chars === 0 || transcript.text.trim().length === 0) {
          throw new Error('没有识别到有效语音内容。');
        }

        emit('notes', '正在生成笔记…（这一步可能需要几分钟）');
        const title = lessonTitleFor(videoPath);
        const generated = await generateNoteBody(modelClient, {
          title,
          sourcePath: videoPath,
          durationSeconds,
          transcript
        });
        if (generated.body.trim().length === 0) {
          throw new Error('模型没有返回笔记内容。');
        }

        emit('html', '正在写入笔记和 HTML…');
        const { dir: lessonDir, folder } = await allocateLessonDir(
          outputDir,
          videoPath,
          usedNames
        );
        await mkdir(lessonDir, { recursive: true });
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
        const meta: LessonMeta = {
          version: META_VERSION,
          sourcePath: videoPath,
          folder,
          title,
          durationSeconds,
          transcriptChars: transcript.chars,
          noteChars: generated.body.length,
          transcriptModel: transcript.model,
          generatedAt,
          summary: summarizeNote(generated.body)
        };

        await writeFile(
          join(lessonDir, 'transcript.json'),
          `${JSON.stringify(transcript, null, 2)}\n`,
          'utf8'
        );
        await writeFile(notesPath, markdown, 'utf8');
        await writeFile(
          htmlPath,
          renderLessonHtml({
            title,
            sourcePath: videoPath,
            durationSeconds,
            transcriptChars: transcript.chars,
            transcriptModel: transcript.model,
            generatedAt,
            markdown: generated.body
          }),
          'utf8'
        );
        // Written last: a half-written lesson must not be picked up by the index.
        await writeFile(
          join(lessonDir, 'meta.json'),
          `${JSON.stringify(meta, null, 2)}\n`,
          'utf8'
        );

        lessons.push({
          sourcePath: videoPath,
          lessonDir,
          title,
          durationSeconds,
          transcriptChars: transcript.chars,
          noteChars: generated.body.length,
          notesPath,
          htmlPath
        });
        emit('done', '本讲笔记已生成。');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ videoPath, message });
        emit('error', message);
      }
    }

    const generatedAt = formatLocalDate(now());
    const index = await rebuildIndex(
      outputDir,
      courseTitle(videoPaths, outputDir),
      generatedAt
    );

    return {
      outputDir,
      indexPath: index.indexPath,
      lessons: index.lessons.length > 0 ? index.lessons : lessons,
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
    }
  };
}
