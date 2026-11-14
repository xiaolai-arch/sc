import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  createAbortError,
  spawnFfmpeg,
  type FfmpegSpawn,
  type SpawnFfmpegOptions
} from './frames';

export const DEFAULT_SAMPLE_INTERVAL_SECONDS = 12;
export const DEFAULT_SCENE_THRESHOLD = 0.3;
export const DEFAULT_DUPLICATE_HAMMING_DISTANCE = 6;
export const DEFAULT_DUPLICATE_MEAN_DIFF = 0.08;
export const DEFAULT_MIN_SPACING_SECONDS = 20;
export const DEFAULT_TRANSITION_MAX_SECONDS = 2;
export const DEFAULT_FRAMES_PER_TEN_MINUTES = 12;
export const DEFAULT_MAX_FRAMES = 80;
export const DEFAULT_CANDIDATE_WIDTH = 320;
export const DEFAULT_EXPORT_WIDTH = 1280;
export const DEFAULT_JPEG_QUALITY = 3;

/** Final exported frames. */
export interface Keyframe {
  t: number;
  path: string;
  sharpness: number;
  scene: boolean;
}

/** 64-bit difference hash, split into two unsigned 32-bit words. */
export interface DHash {
  hi: number;
  lo: number;
}

export type RgbMean = readonly [number, number, number];

export interface FrameMetrics {
  dhash: DHash;
  meanRgb: RgbMean;
  sharpness: number;
}

export interface KeyframeCandidate extends FrameMetrics {
  t: number;
  scene: boolean;
}

export interface FrameCluster {
  start: number;
  end: number;
  scene: boolean;
  representative: KeyframeCandidate;
  frames: KeyframeCandidate[];
}

export interface ShowinfoRecord {
  /** ffmpeg's input frame number (`n:`), not the candidate ordinal. */
  index: number;
  ptsTime: number | null;
  width: number;
  height: number;
}

export interface SampleCandidatesOptions {
  videoPath: string;
  signal?: AbortSignal;
  sampleIntervalSeconds?: number;
  sceneThreshold?: number;
  candidateWidth?: number;
  ffmpegPath?: string;
  spawnFn?: FfmpegSpawn;
  killTreeFn?: SpawnFfmpegOptions['killTreeFn'];
  onStderrLine?: (line: string) => void;
}

export interface SelectKeyframeOptions {
  durationSeconds: number;
  duplicateHammingDistance?: number;
  duplicateMeanDiff?: number;
  transitionMaxSeconds?: number;
  minSpacingSeconds?: number;
  framesPerTenMinutes?: number;
  maxFrames?: number;
}

export interface ExtractKeyframesOptions extends SelectKeyframeOptions {
  videoPath: string;
  outDir: string;
  signal?: AbortSignal;
  sampleIntervalSeconds?: number;
  sceneThreshold?: number;
  candidateWidth?: number;
  exportWidth?: number;
  jpegQuality?: number;
  ffmpegPath?: string;
  spawnFn?: FfmpegSpawn;
  killTreeFn?: SpawnFfmpegOptions['killTreeFn'];
}

// ---------------------------------------------------------------------------
// Frame analysis (raw RGB, no native dependencies)
// ---------------------------------------------------------------------------

/** ITU-R BT.601 luma, matching the usual grayscale conversion. */
export function toGrayscale(
  rgb: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const pixels = width * height;
  const gray = new Uint8Array(pixels);
  for (let i = 0, j = 0; i < pixels; i += 1, j += 3) {
    gray[i] = Math.round(0.299 * rgb[j] + 0.587 * rgb[j + 1] + 0.114 * rgb[j + 2]);
  }
  return gray;
}

/** Block average (box filter) used to shrink a frame without image codecs. */
function blockAverageGray(
  gray: Uint8Array,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number
): Float64Array {
  const out = new Float64Array(outWidth * outHeight);
  for (let oy = 0; oy < outHeight; oy += 1) {
    const y0 = Math.floor((oy * height) / outHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * height) / outHeight));
    for (let ox = 0; ox < outWidth; ox += 1) {
      const x0 = Math.floor((ox * width) / outWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * width) / outWidth));
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1 && y < height; y += 1) {
        const row = y * width;
        for (let x = x0; x < x1 && x < width; x += 1) {
          sum += gray[row + x];
          count += 1;
        }
      }
      out[oy * outWidth + ox] = count > 0 ? sum / count : 0;
    }
  }
  return out;
}

/**
 * dHash: resize to 9x8 gray blocks, then record whether each right neighbor is
 * brighter than its left neighbor. 8*8 = 64 bits.
 */
export function dHashFromGray(
  gray: Uint8Array,
  width: number,
  height: number
): DHash {
  const grid = blockAverageGray(gray, width, height, 9, 8);
  let hi = 0;
  let lo = 0;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = grid[y * 9 + x];
      const right = grid[y * 9 + x + 1];
      const bit = right > left ? 1 : 0;
      const index = y * 8 + x;
      if (index < 32) lo = (lo | (bit << index)) >>> 0;
      else hi = (hi | (bit << (index - 32))) >>> 0;
    }
  }
  return { hi, lo };
}

export function dHashFromRgb(
  rgb: Uint8Array,
  width: number,
  height: number
): DHash {
  return dHashFromGray(toGrayscale(rgb, width, height), width, height);
}

export function popcount32(value: number): number {
  let x = value >>> 0;
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

export function hammingDistance(a: DHash, b: DHash): number {
  return popcount32(a.hi ^ b.hi) + popcount32(a.lo ^ b.lo);
}

/** Mean RGB per channel over a 32x32 block average, normalized to 0..1. */
export function meanRgbFromRgb(
  rgb: Uint8Array,
  width: number,
  height: number
): RgbMean {
  const outWidth = 32;
  const outHeight = 32;
  const sums = [0, 0, 0];
  let blocks = 0;
  for (let oy = 0; oy < outHeight; oy += 1) {
    const y0 = Math.floor((oy * height) / outHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * height) / outHeight));
    for (let ox = 0; ox < outWidth; ox += 1) {
      const x0 = Math.floor((ox * width) / outWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * width) / outWidth));
      const block = [0, 0, 0];
      let count = 0;
      for (let y = y0; y < y1 && y < height; y += 1) {
        for (let x = x0; x < x1 && x < width; x += 1) {
          const index = (y * width + x) * 3;
          block[0] += rgb[index];
          block[1] += rgb[index + 1];
          block[2] += rgb[index + 2];
          count += 1;
        }
      }
      if (count === 0) continue;
      sums[0] += block[0] / count;
      sums[1] += block[1] / count;
      sums[2] += block[2] / count;
      blocks += 1;
    }
  }
  if (blocks === 0) return [0, 0, 0];
  return [sums[0] / blocks / 255, sums[1] / blocks / 255, sums[2] / blocks / 255];
}

export function meanChannelDifferences(a: RgbMean, b: RgbMean): RgbMean {
  return [Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])];
}

/** Laplacian (4-neighbor kernel) response variance; flat frames score ~0. */
export function laplacianVariance(
  gray: Uint8Array,
  width: number,
  height: number
): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const index = row + x;
      const value =
        gray[index - width] + gray[index + width] + gray[index - 1] + gray[index + 1] -
        4 * gray[index];
      sum += value;
      sumSquares += value * value;
      count += 1;
    }
  }
  if (count === 0) return 0;
  const mean = sum / count;
  return Math.max(0, sumSquares / count - mean * mean);
}

export function sharpnessFromRgb(
  rgb: Uint8Array,
  width: number,
  height: number
): number {
  return laplacianVariance(toGrayscale(rgb, width, height), width, height);
}

export function analyzeFrame(
  rgb: Uint8Array,
  width: number,
  height: number
): FrameMetrics {
  const gray = toGrayscale(rgb, width, height);
  return {
    dhash: dHashFromGray(gray, width, height),
    meanRgb: meanRgbFromRgb(rgb, width, height),
    sharpness: laplacianVariance(gray, width, height)
  };
}

// ---------------------------------------------------------------------------
// Showinfo parsing
// ---------------------------------------------------------------------------

const INDEX_PATTERN = /\bn:\s*(\d+)\b/;
const SIZE_PATTERN = /\bs:\s*(\d+)x(\d+)\b/;
const PTS_TIME_PATTERN =
  /\bpts_time:\s*(-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?)/;

/**
 * Parses one showinfo frame line. Returns null for filter-config lines, side
 * data lines, and anything without both a frame number and a size.
 */
export function parseShowinfoLine(line: string): ShowinfoRecord | null {
  if (!line.includes('showinfo')) return null;
  const index = INDEX_PATTERN.exec(line);
  const size = SIZE_PATTERN.exec(line);
  if (!index || !size) return null;
  // pts_time can be absent (or NOPTS) when the frame has no timestamp.
  const pts = PTS_TIME_PATTERN.exec(line);
  const ptsTime = pts ? Number.parseFloat(pts[1]) : null;
  return {
    index: Number.parseInt(index[1], 10),
    ptsTime: Number.isFinite(ptsTime as number) ? ptsTime : null,
    width: Number.parseInt(size[1], 10),
    height: Number.parseInt(size[2], 10)
  };
}

export function parseShowinfoLog(text: string): ShowinfoRecord[] {
  const records: ShowinfoRecord[] = [];
  for (const line of text.split(/\r?\n/)) {
    const record = parseShowinfoLine(line);
    if (record) records.push(record);
  }
  return records;
}

/**
 * Recovers a timestamp for every record. Missing `pts_time` values are
 * interpolated between known neighbors, or extrapolated using a step inferred
 * from the known records (defaulting to the sampling interval).
 */
export function assignFrameTimes(
  records: ShowinfoRecord[],
  fallbackStepSeconds = DEFAULT_SAMPLE_INTERVAL_SECONDS
): number[] {
  const count = records.length;
  const times = new Array<number>(count);

  const prevKnown: Array<{ position: number; t: number } | null> = new Array(count).fill(null);
  const nextKnown: Array<{ position: number; t: number } | null> = new Array(count).fill(null);
  const known: Array<{ position: number; t: number }> = [];
  let previous: { position: number; t: number } | null = null;
  for (let i = 0; i < count; i += 1) {
    prevKnown[i] = previous;
    const value = records[i].ptsTime;
    if (value !== null && Number.isFinite(value)) {
      previous = { position: i, t: value };
      known.push(previous);
    }
  }
  previous = null;
  for (let i = count - 1; i >= 0; i -= 1) {
    nextKnown[i] = previous;
    const value = records[i].ptsTime;
    if (value !== null && Number.isFinite(value)) {
      previous = { position: i, t: value };
    }
  }

  let step = fallbackStepSeconds > 0 ? fallbackStepSeconds : 1;
  if (known.length >= 2) {
    const deltas: number[] = [];
    for (let i = 1; i < known.length; i += 1) {
      const frames = known[i].position - known[i - 1].position;
      if (frames > 0) {
        const delta = (known[i].t - known[i - 1].t) / frames;
        if (Number.isFinite(delta) && delta > 0) deltas.push(delta);
      }
    }
    if (deltas.length > 0) {
      deltas.sort((a, b) => a - b);
      step = deltas[Math.floor(deltas.length / 2)];
    }
  }

  for (let i = 0; i < count; i += 1) {
    const knownValue = records[i].ptsTime;
    if (knownValue !== null && Number.isFinite(knownValue)) {
      times[i] = knownValue;
      continue;
    }
    const prev = prevKnown[i];
    const next = nextKnown[i];
    if (prev && next && next.position > prev.position) {
      const ratio = (i - prev.position) / (next.position - prev.position);
      times[i] = prev.t + (next.t - prev.t) * ratio;
    } else if (prev) {
      times[i] = prev.t + (i - prev.position) * step;
    } else if (next) {
      times[i] = next.t - (next.position - i) * step;
    } else {
      times[i] = i * step;
    }
  }
  return times;
}

/**
 * Replays ffmpeg's periodic branch over the candidate list. Every candidate is
 * selected by ffmpeg; one that does not satisfy `t - prev_selected_t >= 12`
 * (and is not the first) can only have come from the scene detector.
 */
export function markSceneFlags(
  times: number[],
  intervalSeconds = DEFAULT_SAMPLE_INTERVAL_SECONDS
): boolean[] {
  const epsilon = 1e-6;
  let previous: number | null = null;
  return times.map((t) => {
    const periodic = previous === null || t - previous >= intervalSeconds - epsilon;
    previous = t;
    return !periodic;
  });
}

export function buildCandidateArgs(options: {
  videoPath: string;
  sampleIntervalSeconds?: number;
  sceneThreshold?: number;
  candidateWidth?: number;
}): string[] {
  const interval = options.sampleIntervalSeconds ?? DEFAULT_SAMPLE_INTERVAL_SECONDS;
  const scene = options.sceneThreshold ?? DEFAULT_SCENE_THRESHOLD;
  const width = options.candidateWidth ?? DEFAULT_CANDIDATE_WIDTH;
  const expression = [
    'isnan(prev_selected_t)',
    `gte(t-prev_selected_t,${interval})`,
    `gt(scene,${scene})`
  ].join('+');
  return [
    '-hide_banner',
    '-loglevel',
    'info',
    '-nostats',
    '-i',
    options.videoPath,
    '-vf',
    `select='${expression}',scale=${width}:-1,showinfo`,
    '-fps_mode',
    'passthrough',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1'
  ];
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

/**
 * Decodes the video once and streams candidate frames from ffmpeg's stdout.
 * Frame bytes are analyzed as they arrive; nothing is written to disk.
 */
export async function sampleCandidates(
  options: SampleCandidatesOptions
): Promise<KeyframeCandidate[]> {
  const {
    videoPath,
    signal,
    sampleIntervalSeconds = DEFAULT_SAMPLE_INTERVAL_SECONDS,
    sceneThreshold = DEFAULT_SCENE_THRESHOLD,
    candidateWidth = DEFAULT_CANDIDATE_WIDTH,
    ffmpegPath,
    spawnFn,
    killTreeFn,
    onStderrLine
  } = options;

  throwIfAborted(signal);

  const args = buildCandidateArgs({
    videoPath,
    sampleIntervalSeconds,
    sceneThreshold,
    candidateWidth
  });

  const records: ShowinfoRecord[] = [];
  const metrics: FrameMetrics[] = [];
  const pending: Buffer[] = [];
  let pendingBytes = 0;
  let nextRecord = 0;

  const takeBytes = (size: number): Buffer => {
    const parts: Buffer[] = [];
    let need = size;
    while (need > 0 && pending.length > 0) {
      const head = pending[0];
      if (head.length <= need) {
        parts.push(head);
        pending.shift();
        pendingBytes -= head.length;
        need -= head.length;
      } else {
        parts.push(head.subarray(0, need));
        pending[0] = head.subarray(need);
        pendingBytes -= need;
        need = 0;
      }
    }
    return parts.length === 1 ? parts[0] : Buffer.concat(parts, size);
  };

  const consume = () => {
    while (nextRecord < records.length) {
      const record = records[nextRecord];
      const size = record.width * record.height * 3;
      if (size <= 0) {
        nextRecord += 1;
        continue;
      }
      if (pendingBytes < size) return;
      const frame = takeBytes(size);
      nextRecord += 1;
      metrics.push(analyzeFrame(frame, record.width, record.height));
    }
  };

  const handleLine = (line: string) => {
    onStderrLine?.(line);
    const record = parseShowinfoLine(line);
    if (!record) return;
    records.push(record);
    consume();
  };

  await spawnFfmpeg(args, {
    signal,
    ffmpegPath,
    spawnFn,
    killTreeFn,
    captureStdout: false,
    onStderrLine: handleLine,
    onStdout: (chunk) => {
      pending.push(chunk);
      pendingBytes += chunk.length;
      consume();
    }
  });

  throwIfAborted(signal);

  // stderr lines can trail the last stdout chunk; keep whatever paired up.
  const usable = Math.min(records.length, metrics.length);
  const times = assignFrameTimes(records.slice(0, usable), sampleIntervalSeconds);
  const scenes = markSceneFlags(times, sampleIntervalSeconds);
  return metrics.slice(0, usable).map((metric, index) => ({
    t: times[index],
    scene: scenes[index],
    ...metric
  }));
}

// ---------------------------------------------------------------------------
// Clustering and selection
// ---------------------------------------------------------------------------

export function isDuplicateFrame(
  a: Pick<KeyframeCandidate, 'dhash' | 'meanRgb'>,
  b: Pick<KeyframeCandidate, 'dhash' | 'meanRgb'>,
  options: {
    duplicateHammingDistance?: number;
    duplicateMeanDiff?: number;
  } = {}
): boolean {
  const maxHamming = options.duplicateHammingDistance ?? DEFAULT_DUPLICATE_HAMMING_DISTANCE;
  const maxMeanDiff = options.duplicateMeanDiff ?? DEFAULT_DUPLICATE_MEAN_DIFF;
  if (hammingDistance(a.dhash, b.dhash) > maxHamming) return false;
  const diffs = meanChannelDifferences(a.meanRgb, b.meanRgb);
  return Math.max(diffs[0], diffs[1], diffs[2]) <= maxMeanDiff;
}

/** Groups consecutive candidates that look like the same slide. */
export function clusterFrames(
  candidates: KeyframeCandidate[],
  options: {
    duplicateHammingDistance?: number;
    duplicateMeanDiff?: number;
  } = {}
): FrameCluster[] {
  const ordered = [...candidates].sort((a, b) => a.t - b.t);
  const clusters: Array<{
    frames: KeyframeCandidate[];
    representative: KeyframeCandidate;
  }> = [];

  for (const candidate of ordered) {
    const current = clusters[clusters.length - 1];
    if (current && isDuplicateFrame(candidate, current.representative, options)) {
      current.frames.push(candidate);
      if (candidate.sharpness > current.representative.sharpness) {
        current.representative = candidate;
      }
    } else {
      clusters.push({ frames: [candidate], representative: candidate });
    }
  }

  return clusters.map((cluster) => ({
    start: cluster.frames[0].t,
    end: cluster.frames[cluster.frames.length - 1].t,
    scene: cluster.frames.some((frame) => frame.scene),
    representative: cluster.representative,
    frames: cluster.frames
  }));
}

/**
 * Drops page-flip transitions: a very short cluster squeezed between two other
 * clusters that are both less than `maxDurationSeconds` away.
 */
export function dropTransitionClusters(
  clusters: FrameCluster[],
  maxDurationSeconds = DEFAULT_TRANSITION_MAX_SECONDS
): FrameCluster[] {
  return clusters.filter((cluster, index) => {
    const duration = cluster.end - cluster.start;
    if (duration >= maxDurationSeconds) return true;
    const previous = clusters[index - 1];
    const next = clusters[index + 1];
    const gaps: number[] = [];
    if (previous) gaps.push(cluster.start - previous.end);
    if (next) gaps.push(next.start - cluster.end);
    // Keep when there is no transition to be part of, or when any neighbor is
    // far enough away for this to be a real page.
    return gaps.length === 0 || gaps.some((gap) => gap >= maxDurationSeconds);
  });
}

/** Enforces the minimum spacing between ordinary frames. */
export function applyMinSpacing(
  clusters: FrameCluster[],
  minSpacingSeconds = DEFAULT_MIN_SPACING_SECONDS
): FrameCluster[] {
  const kept: FrameCluster[] = [];
  let lastKept: number | null = null;
  for (const cluster of clusters) {
    const t = cluster.representative.t;
    if (lastKept === null || cluster.scene || t - lastKept >= minSpacingSeconds) {
      kept.push(cluster);
      lastKept = t;
    }
  }
  return kept;
}

/**
 * Budget: at most `framesPerTenMinutes` per ten minutes, never more than
 * `maxFrames` in total (itself capped at the doc's hard limit of 80).
 */
export function frameBudget(
  durationSeconds: number,
  framesPerTenMinutes = DEFAULT_FRAMES_PER_TEN_MINUTES,
  maxFrames = DEFAULT_MAX_FRAMES
): number {
  const hardCap = Math.max(0, Math.min(maxFrames, DEFAULT_MAX_FRAMES));
  if (hardCap === 0) return 0;
  if (!(durationSeconds > 0)) return hardCap;
  const byDuration = Math.floor((durationSeconds / 600) * framesPerTenMinutes);
  return Math.min(hardCap, Math.max(1, byDuration));
}

/** Evenly spaced indices, always including the first and last item. */
export function uniformIndices(count: number, keep: number): number[] {
  if (keep <= 0 || count <= 0) return [];
  if (keep >= count) return Array.from({ length: count }, (_, index) => index);
  if (keep === 1) return [0];
  const indices: number[] = [];
  for (let i = 0; i < keep; i += 1) {
    const index = Math.round((i * (count - 1)) / (keep - 1));
    if (indices[indices.length - 1] !== index) indices.push(index);
  }
  return indices;
}

/** Thins to the budget, keeping scene-change frames before ordinary ones. */
export function thinToBudget<T>(
  items: T[],
  budget: number,
  isScene: (item: T) => boolean
): T[] {
  if (budget >= items.length) return items.slice();
  if (budget <= 0) return [];
  const sceneIndices: number[] = [];
  const ordinaryIndices: number[] = [];
  items.forEach((item, index) => {
    if (isScene(item)) sceneIndices.push(index);
    else ordinaryIndices.push(index);
  });

  let chosen: number[];
  if (sceneIndices.length >= budget) {
    chosen = uniformIndices(sceneIndices.length, budget).map((i) => sceneIndices[i]);
  } else {
    const room = budget - sceneIndices.length;
    chosen = [
      ...sceneIndices,
      ...uniformIndices(ordinaryIndices.length, room).map((i) => ordinaryIndices[i])
    ];
  }
  chosen.sort((a, b) => a - b);
  return chosen.map((index) => items[index]);
}

export function selectKeyframeClusters(
  candidates: KeyframeCandidate[],
  options: SelectKeyframeOptions
): FrameCluster[] {
  const {
    durationSeconds,
    duplicateHammingDistance = DEFAULT_DUPLICATE_HAMMING_DISTANCE,
    duplicateMeanDiff = DEFAULT_DUPLICATE_MEAN_DIFF,
    transitionMaxSeconds = DEFAULT_TRANSITION_MAX_SECONDS,
    minSpacingSeconds = DEFAULT_MIN_SPACING_SECONDS,
    framesPerTenMinutes = DEFAULT_FRAMES_PER_TEN_MINUTES,
    maxFrames = DEFAULT_MAX_FRAMES
  } = options;

  const clusters = clusterFrames(candidates, {
    duplicateHammingDistance,
    duplicateMeanDiff
  });
  const withoutTransitions = dropTransitionClusters(clusters, transitionMaxSeconds);
  const spaced = applyMinSpacing(withoutTransitions, minSpacingSeconds);
  const budget = frameBudget(durationSeconds, framesPerTenMinutes, maxFrames);
  return thinToBudget(spaced, budget, (cluster) => cluster.scene).sort(
    (a, b) => a.representative.t - b.representative.t
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export function buildExportArgs(options: {
  videoPath: string;
  t: number;
  destination: string;
  exportWidth?: number;
  jpegQuality?: number;
}): string[] {
  const width = options.exportWidth ?? DEFAULT_EXPORT_WIDTH;
  const quality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY;
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    options.t.toFixed(3),
    '-i',
    options.videoPath,
    '-frames:v',
    '1',
    '-vf',
    `scale=${width}:-1`,
    '-q:v',
    String(quality),
    '-an',
    '-sn',
    options.destination
  ];
}

/**
 * Samples, dedupes, selects, and writes one 1280px JPEG per selected frame.
 */
export async function extractKeyframes(
  options: ExtractKeyframesOptions
): Promise<Keyframe[]> {
  const {
    videoPath,
    durationSeconds,
    outDir,
    signal,
    sampleIntervalSeconds = DEFAULT_SAMPLE_INTERVAL_SECONDS,
    sceneThreshold = DEFAULT_SCENE_THRESHOLD,
    candidateWidth = DEFAULT_CANDIDATE_WIDTH,
    exportWidth = DEFAULT_EXPORT_WIDTH,
    jpegQuality = DEFAULT_JPEG_QUALITY,
    ffmpegPath,
    spawnFn,
    killTreeFn
  } = options;

  if (!videoPath) throw new Error('缺少视频路径。');
  if (!outDir) throw new Error('缺少关键帧输出目录。');
  throwIfAborted(signal);

  const candidates = await sampleCandidates({
    videoPath,
    signal,
    sampleIntervalSeconds,
    sceneThreshold,
    candidateWidth,
    ffmpegPath,
    spawnFn,
    killTreeFn
  });
  throwIfAborted(signal);

  const clusters = selectKeyframeClusters(candidates, options);
  if (clusters.length === 0) return [];

  await mkdir(outDir, { recursive: true });

  const frames: Keyframe[] = [];
  for (const cluster of clusters) {
    throwIfAborted(signal);
    const t = Math.round(cluster.representative.t * 1000) / 1000;
    const fileName = `${Math.round(t * 1000)}.jpg`;
    const destination = path.resolve(outDir, fileName);
    try {
      await spawnFfmpeg(
        buildExportArgs({ videoPath, t, destination, exportWidth, jpegQuality }),
        { signal, ffmpegPath, spawnFn, killTreeFn, captureStdout: true }
      );
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`导出关键帧 ${t.toFixed(3)}s 失败：${message}`);
    }
    frames.push({
      t,
      path: destination,
      sharpness: cluster.representative.sharpness,
      scene: cluster.scene
    });
  }

  return frames.sort((a, b) => a.t - b.t);
}
