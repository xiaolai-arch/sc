import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  AUDIO_EXTENSIONS,
  MEDIA_EXTENSIONS,
  VIDEO_EXTENSIONS,
  isSupportedMedia
} from '../../shared/video-notes';

export { AUDIO_EXTENSIONS, MEDIA_EXTENSIONS, VIDEO_EXTENSIONS, isSupportedMedia };

const run = promisify(execFile);

function ffmpegBinary(): string {
  return process.env.ASAKI_FFMPEG_PATH?.trim() || 'ffmpeg';
}

function ffprobeBinary(): string {
  return process.env.ASAKI_FFPROBE_PATH?.trim() || 'ffprobe';
}

const TOOL_TIMEOUT_MS = 15_000;

/** Verifies the ffmpeg pair before the first long extraction starts. */
export async function assertMediaTools(): Promise<void> {
  for (const [binary, label, envName] of [
    [ffmpegBinary(), 'ffmpeg', 'ASAKI_FFMPEG_PATH'],
    [ffprobeBinary(), 'ffprobe', 'ASAKI_FFPROBE_PATH']
  ] as const) {
    try {
      await run(binary, ['-version'], {
        windowsHide: true,
        timeout: TOOL_TIMEOUT_MS,
        maxBuffer: 1024 * 1024
      });
    } catch {
      throw new Error(
        `找不到 ${label}。请先安装 ffmpeg（并把 ${label} 加入 PATH），或设置 ${envName} 指向可执行文件。`
      );
    }
  }
}

/** Returns 0 when the container does not expose a duration. */
export async function probeDuration(source: string, signal?: AbortSignal): Promise<number> {
  const { stdout } = await run(
    ffprobeBinary(),
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      source
    ],
    {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      ...(signal ? { signal } : {})
    }
  );
  const value = Number.parseFloat(stdout.trim());
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Extracts one mono 16 kHz mp3 window, skipping the video stream. The optional
 * signal kills the ffmpeg child as soon as the job is cancelled.
 */
export async function extractMp3Chunk(
  source: string,
  destination: string,
  startSeconds: number,
  durationSeconds: number,
  signal?: AbortSignal
): Promise<void> {
  await run(
    ffmpegBinary(),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      startSeconds.toFixed(3),
      '-i',
      source,
      '-t',
      durationSeconds.toFixed(3),
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '64k',
      '-f',
      'mp3',
      destination
    ],
    {
      windowsHide: true,
      timeout: 10 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
      ...(signal ? { signal } : {})
    }
  );
}
