/**
 * The local "video notes" utility: turn a course video into a Markdown note
 * (plus a self-contained HTML page) using MiMo ASR and the configured model.
 * Everything runs on this machine; the only network calls are the ASR endpoint
 * and the user's configured model provider.
 */

export type VideoNotesLanguage = 'auto' | 'zh' | 'en';

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
  /** Opens the native folder picker; null means the user cancelled. */
  pickOutputDirectory(): Promise<string | null>;
  /**
   * Runs the whole pipeline. Progress is streamed while the promise resolves
   * with every lesson that was written.
   */
  generateVideoNotes(
    input: VideoNotesInput,
    onProgress: (progress: VideoNotesProgress) => void
  ): Promise<VideoNotesResult>;
  /** Opens a generated HTML file or folder with the OS default handler. */
  openPath(path: string): Promise<string>;
}
