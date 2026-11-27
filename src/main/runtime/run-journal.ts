import { mkdir, appendFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { RUN_INTERRUPTED_MESSAGE } from '../butler/conversation-runs';
import type { RunEvent } from './contracts';

/**
 * RunJournal (spec P0 / 默认决定 2): append-only JSONL, one file per run under
 * `data/runtime-runs/`. It is not a second plan/commitment database and does
 * not go through `JsonStateStore` (run logs are append-shaped, not small
 * settings objects). It records run status, what was approved, whether tools
 * committed, and how to recover — never the full prompt (`userInput` never
 * enters a RunEvent) and never secrets.
 *
 * Crash recovery follows the `ConversationRunStore` precedent: on startup, a
 * run whose file has no terminal `run.finished` line gets an explicit
 * `run.interrupted` marker appended («应用已退出，本次生成中断。»).
 */

export interface RunJournalOptions {
  /** Absolute directory, e.g. `<userData>/data/runtime-runs` (wiring lands with assembly in P1). */
  dirPath: string;
  /** Injectable clock for recovery markers; event `at` stamps come from the run's unified `now`. */
  now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** runIds become filenames; anything unsafe is replaced and disambiguated by a short digest. */
function safeFileStem(runId: string): string {
  const safe = runId.replace(/[^A-Za-z0-9._-]+/g, '_');
  if (safe === runId && safe.length > 0 && safe.length <= 120) return safe;
  const digest = createHash('sha256').update(runId).digest('hex').slice(0, 12);
  return `${safe || 'run'}-${digest}`;
}

export class RunJournal {
  private readonly dirPath: string;
  private readonly now: () => Date;
  /** Guards the per-run sequence so a torn order is a loud error, not silent data loss. */
  private readonly lastSeqByRun = new Map<string, number>();

  constructor(options: RunJournalOptions) {
    this.dirPath = options.dirPath;
    this.now = options.now ?? (() => new Date());
  }

  path(runId: string): string {
    return join(this.dirPath, `${safeFileStem(runId)}.jsonl`);
  }

  /** Appends one event line. Sequence must be strictly increasing per run. */
  async append(runId: string, event: RunEvent): Promise<void> {
    const lastSeq = this.lastSeqByRun.get(runId);
    if (lastSeq !== undefined && event.seq <= lastSeq) {
      throw new Error(`RunJournal 序号倒退：run ${runId} 期望 > ${lastSeq}，收到 ${event.seq}`);
    }
    await mkdir(this.dirPath, { recursive: true });
    await appendFile(this.path(runId), `${JSON.stringify(event)}\n`, 'utf8');
    this.lastSeqByRun.set(runId, event.seq);
  }

  /**
   * Parses one run's file. A torn tail (crash mid-append) is skipped: JSONL
   * tolerates a partial last line by dropping it.
   */
  async readRun(runId: string): Promise<RunEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.path(runId), 'utf8');
    } catch {
      return [];
    }
    const events: RunEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (isRecord(parsed) && typeof parsed['seq'] === 'number' && typeof parsed['type'] === 'string') {
          events.push(parsed as unknown as RunEvent);
        }
      } catch {
        break; // torn tail — everything after it is untrusted
      }
    }
    events.sort((a, b) => a.seq - b.seq);
    return events;
  }

  /**
   * Startup sweep: every run whose last line is not a terminal `run.finished`
   * gets an explicit `run.interrupted` marker (ConversationRunStore precedent).
   * Returns the recovered runIds.
   */
  async recover(): Promise<string[]> {
    let fileNames: string[];
    try {
      fileNames = await readdir(this.dirPath);
    } catch {
      return [];
    }
    const recovered: string[] = [];
    for (const fileName of fileNames) {
      if (!fileName.endsWith('.jsonl')) continue;
      const runId = fileName.replace(/\.jsonl$/, '');
      const events = await this.readRun(runId);
      const last = events[events.length - 1];
      if (last?.type === 'run.finished') continue;
      const marker: RunEvent = {
        runId,
        seq: (last?.seq ?? 0) + 1,
        at: this.now().toISOString(),
        type: 'run.interrupted',
        message: RUN_INTERRUPTED_MESSAGE
      };
      await this.append(runId, marker);
      recovered.push(runId);
    }
    return recovered;
  }
}
