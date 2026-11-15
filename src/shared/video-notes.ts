/**
 * The local "video to deck" utility: turn a course video into a paged deck
 * built from keyframes and the text visible on screen. Everything runs on this
 * machine; the only network calls go to the configured model provider.
 */

/** Video formats the pipeline can probe and read frames from. */
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

export function isSupportedMedia(path: string): boolean {
  const lower = path.toLowerCase();
  return VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export interface VideoNotesInput {
  /** Absolute paths to local video files. */
  videoPaths: string[];
  /**
   * Destination root. Lesson folders and the course index live here. Defaults
   * to a `笔记` folder next to the first video.
   */
  outputDir?: string;
}

/** Queue input: files and/or a folder scanned recursively by the main process. */
export interface VideoNotesEnqueueInput {
  /** Absolute paths to local video files. */
  videoPaths?: string[];
  /** Absolute folder path; scanned recursively for supported video files. */
  folder?: string;
  outputDir?: string;
}

export interface VideoNotesEstimate {
  lessons: number;
  durationSeconds: number;
  tokens: number;
  minutes: number;
}

export type VideoNotesStage =
  | 'probe'
  | 'keyframes'
  | 'screen'
  | 'outline'
  | 'notes'
  | 'enrich'
  | 'factcheck'
  | 'compose'
  | 'render'
  | 'layout'
  | 'pdf'
  | 'report'
  | 'done'
  | 'error';

export interface VideoNotesProgress {
  /** 0-based index of the video being processed. */
  videoIndex: number;
  videoCount: number;
  videoPath: string;
  stage: VideoNotesStage;
  message: string;
  /** Progress within the current stage (e.g. screen-read batches). */
  current?: number;
  total?: number;
}

export interface VideoNotesLesson {
  sourcePath: string;
  lessonDir: string;
  title: string;
  durationSeconds: number;
  /** Legacy v1/v2 lessons only; new decks count screen reads instead. */
  transcriptChars: number;
  noteChars: number;
  notesPath: string;
  /** Legacy quick lessons only; empty for deck lessons. */
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
  /** Legacy quick lessons kept a notes.html; nothing writes it any more. */
  htmlPath?: string;
  slidesPath?: string | null;
  pdfPath?: string | null;
  reportPath?: string | null;
  usage: VideoNotesUsage;
}

export interface VideoJob {
  id: string;
  videoPaths: string[];
  outputDir: string;
  status: VideoJobStatus;
  createdAt: string;
  lessons: VideoJobLesson[];
  estimate: { tokens: number; minutes: number };
  usage: VideoNotesUsage;
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
   * Legacy blocking call. Kept for older renderers; it now enqueues a deck job
   * and resolves with its result once the job settles.
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
