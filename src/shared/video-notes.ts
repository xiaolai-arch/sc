/**
 * The local "video notes" utility: turn a course video into a Markdown note
 * (plus a self-contained HTML page) using MiMo ASR and the configured model.
 * Everything runs on this machine; the only network calls are the ASR endpoint
 * and the user's configured model provider.
 */

export type VideoNotesLanguage = 'auto' | 'zh' | 'en';

/** Media formats the video-note pipeline can probe and transcribe. */
export const VIDEO_EXTENSIONS = [
  '.mp4',
  '.mkv',
  '.mov',
  '.avi',
  '.webm',
  '.flv',
  '.ts',
  '.m4v',
  '.wmv',
  '.mpg',
  '.mpeg',
  '.rmvb'
] as const;

export const AUDIO_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
  '.opus',
  '.wma'
] as const;

export const MEDIA_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS] as const;

export function isSupportedMedia(path: string): boolean {
  const lower = path.toLowerCase();
  return MEDIA_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** Quick notes (existing behaviour) or the full deck pipeline (preview). */
export type VideoNotesMode = 'quick' | 'deck';

export interface VideoNotesInput {
  /** Absolute paths to local video/audio files. */
  videoPaths: string[];
  /**
   * Destination root. Lesson folders, transcript JSON and course index live
   * here. Defaults to a `笔记` folder next to the first video.
   */
  outputDir?: string;
  /** ASR language hint; defaults to auto. */
  language?: VideoNotesLanguage;
}

/** Queue input: files and/or a folder scanned recursively by the main process. */
export interface VideoNotesEnqueueInput {
  mode?: VideoNotesMode;
  /** Absolute paths to local video/audio files. */
  videoPaths?: string[];
  /** Absolute folder path; scanned recursively for supported media files. */
  folder?: string;
  outputDir?: string;
  language?: VideoNotesLanguage;
}

export interface VideoNotesEstimate {
  lessons: number;
  durationSeconds: number;
  tokens: number;
  minutes: number;
}

export type VideoNotesStage =
  | 'probe'
  | 'audio'
  | 'transcribe'
  | 'notes'
  | 'html'
  | 'done'
  | 'error';

export interface VideoNotesProgress {
  /** 0-based index of the video being processed. */
  videoIndex: number;
  videoCount: number;
  videoPath: string;
  stage: VideoNotesStage;
  message: string;
  /** Progress within the current stage (e.g. ASR chunks). */
  current?: number;
  total?: number;
}

export interface VideoNotesLesson {
  sourcePath: string;
  lessonDir: string;
  title: string;
  durationSeconds: number;
  transcriptChars: number;
  noteChars: number;
  notesPath: string;
  htmlPath: string;
}

export interface VideoNotesFailure {
  videoPath: string;
  message: string;
}

export interface VideoNotesResult {
  outputDir: string;
  indexPath: string;
  lessons: VideoNotesLesson[];
  /** One video failing must not discard the lessons that did succeed. */
  failures: VideoNotesFailure[];
}

export type VideoJobStatus =
  | 'queued'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type VideoLessonStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** Token accounting for one job or one lesson. */
export interface VideoNotesUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface VideoJobLesson {
  videoPath: string;
  status: VideoLessonStatus;
  /** Current (or last attempted) pipeline step, e.g. `probe`. */
  step?: string;
  message?: string;
  lessonDir?: string;
  title?: string;
  notesPath?: string;
  htmlPath?: string;
  slidesPath?: string | null;
  pdfPath?: string | null;
  reportPath?: string | null;
  usage: VideoNotesUsage;
}

export interface VideoJob {
  id: string;
  mode: VideoNotesMode;
  videoPaths: string[];
  outputDir: string;
  language: VideoNotesLanguage;
  status: VideoJobStatus;
  createdAt: string;
  lessons: VideoJobLesson[];
  estimate: { tokens: number; minutes: number };
  usage: VideoNotesUsage;
}

/** Renderer-facing transcription endpoint, including whether a key is saved. */
export interface TranscriptionConfigView {
  baseURL: string;
  model: string;
  hasApiKey: boolean;
}

export interface SaveTranscriptionConfigInput {
  baseURL: string;
  model: string;
  /** `undefined` keeps the saved key; an empty string clears it. */
  apiKey?: string;
}

export interface VideoNotesApi {
  /** Opens the native picker; null means the user cancelled. */
  pickVideoFiles(): Promise<string[] | null>;
  /**
   * Opens a folder picker for a whole course; null means cancelled. Optional so
   * older bridges and the browser prototype keep type-checking.
   */
  pickVideoFolder?(): Promise<string | null>;
  /** Opens the native folder picker; null means the user cancelled. */
  pickOutputDirectory(): Promise<string | null>;
  /**
   * Legacy blocking call. Kept for older renderers; it now enqueues a quick
   * job and resolves with its result once the job settles.
   */
  generateVideoNotes(
    input: VideoNotesInput,
    onProgress: (progress: VideoNotesProgress) => void
  ): Promise<VideoNotesResult>;
  /** Puts a job at the back of the queue and returns it immediately. */
  enqueueVideoNotes?(input: VideoNotesEnqueueInput): Promise<VideoJob>;
  /** Estimates lessons, duration, tokens and minutes without running. */
  estimateVideoNotes?(input: VideoNotesEnqueueInput): Promise<VideoNotesEstimate>;
  listVideoJobs?(): Promise<VideoJob[]>;
  cancelVideoJob?(id: string): Promise<VideoJob>;
  resumeVideoJob?(id: string): Promise<VideoJob>;
  retryVideoLesson?(input: { jobId: string; videoPath: string }): Promise<VideoJob>;
  removeVideoJob?(id: string): Promise<void>;
  /** Job snapshots pushed from the main process (max twice per second). */
  onVideoJobsChanged?(listener: (jobs: VideoJob[]) => void): () => void;
  /** Opens a generated HTML file or folder with the OS default handler. */
  openPath(path: string): Promise<string>;
}
