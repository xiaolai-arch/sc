import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ModelUsage } from '../agent/model-client';
import { readFileOrNull, writeFileAtomic } from '../workspace/fs-utils';

/** Directory (inside a lesson folder) holding one JSON file per finished step. */
export const WORK_DIR = 'work';
export const CHECKPOINT_VERSION = 1;

export interface StepRecord<T = unknown> {
  version: number;
  step: string;
  fingerprint: string;
  output: T;
  usage: ModelUsage;
  finishedAt: string;
}

export interface RunStepOptions<T> {
  lessonDir: string;
  step: string;
  /** sha1 over the upstream outputs, prompt version, model and options. */
  fingerprint: string;
  /** Re-run even when a matching record exists (retry from a failed step). */
  force?: boolean;
  /** Called only when the step actually runs. */
  run: () => Promise<{ output: T; usage?: ModelUsage }>;
  now?: () => Date;
}

export interface RunStepResult<T> {
  output: T;
  usage: ModelUsage;
  skipped: boolean;
}

const ZERO_USAGE: ModelUsage = { inputTokens: 0, outputTokens: 0 };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeUsage(value: unknown): ModelUsage {
  if (!isRecord(value)) return { ...ZERO_USAGE };
  const number = (input: unknown): number =>
    typeof input === 'number' && Number.isFinite(input) && input > 0 ? Math.round(input) : 0;
  return {
    inputTokens: number(value['inputTokens']),
    outputTokens: number(value['outputTokens'])
  };
}

/** Recursively sorts object keys so equal inputs always hash the same. */
function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalizeForHash(entry));
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      if (entry !== undefined) out[key] = normalizeForHash(entry);
    }
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForHash(value));
}

/** sha1 of the stable JSON form; used as the step fingerprint. */
export function fingerprintOf(parts: unknown): string {
  return createHash('sha1').update(stableStringify(parts)).digest('hex');
}

export function checkpointPath(lessonDir: string, step: string): string {
  return join(lessonDir, WORK_DIR, `${step}.json`);
}

/**
 * Reads one step record. A missing file, invalid JSON, a different version or
 * any malformed field counts as "not run" so a torn write can never be treated
 * as a completed step.
 */
export async function readCheckpoint<T = unknown>(
  lessonDir: string,
  step: string
): Promise<StepRecord<T> | null> {
  const raw = await readFileOrNull(checkpointPath(lessonDir, step));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed['version'] !== CHECKPOINT_VERSION) return null;
  if (parsed['step'] !== step) return null;
  if (typeof parsed['fingerprint'] !== 'string') return null;
  if (!('output' in parsed)) return null;
  if (typeof parsed['finishedAt'] !== 'string') return null;
  return {
    version: CHECKPOINT_VERSION,
    step,
    fingerprint: parsed['fingerprint'],
    output: parsed['output'] as T,
    usage: normalizeUsage(parsed['usage']),
    finishedAt: parsed['finishedAt']
  };
}

/** Atomic write: a crash mid-write leaves the previous record (or none). */
export async function writeCheckpoint<T>(
  lessonDir: string,
  step: string,
  record: StepRecord<T>
): Promise<void> {
  await writeFileAtomic(
    checkpointPath(lessonDir, step),
    `${JSON.stringify(record, null, 2)}\n`
  );
}

/**
 * Runs a pipeline step unless its previous record has the same fingerprint.
 * The record is written after the step finishes, so an interrupted step is
 * simply run again on resume.
 */
export async function runStep<T>(options: RunStepOptions<T>): Promise<RunStepResult<T>> {
  if (!options.force) {
    const existing = await readCheckpoint<T>(options.lessonDir, options.step);
    if (existing !== null && existing.fingerprint === options.fingerprint) {
      return { output: existing.output, usage: existing.usage, skipped: true };
    }
  }
  const result = await options.run();
  const usage = result.usage ?? { ...ZERO_USAGE };
  const now = options.now ?? (() => new Date());
  await writeCheckpoint(options.lessonDir, options.step, {
    version: CHECKPOINT_VERSION,
    step: options.step,
    fingerprint: options.fingerprint,
    output: result.output,
    usage,
    finishedAt: now().toISOString()
  });
  return { output: result.output, usage, skipped: false };
}
