import { formatLocalDate } from '../../shared/date';
import {
  AUTO_RECALL_MS,
  normalizePracticeDurationMs,
  type PracticeAttempt
} from '../../shared/practice';
import { ACCURACY_TREND_WEEKS, startOfWeek } from './accuracy-trend';

/**
 * 用时流畅度 stats (iter33 P1). The pipeline is deliberately order-bound:
 *
 * 1. 去重 — Anki「Only one review per day - the first one - counts」: per
 *    (question, local day) only the first answer counts for fluent stats.
 *    Raw attempts stay untouched on disk; this filter is stats-side only.
 * 2. 有效 — a record carries a usable `durationMs` (same normalization as the
 *    submit path, so a hand-edited file cannot poison the numbers). Records
 *    without it — legacy rows, mistake reviews — are absent, never errors.
 * 3. 分级 — `correct && durationMs < AUTO_RECALL_MS` is 自动召回,
 *    `correct && durationMs >= AUTO_RECALL_MS` is 对了但慢, a wrong answer
 *    counts in neither tier (but its time still feeds the median).
 *
 * 呈现门槛 (spec default 6): the per-set trend shows only when the set has at
 * least `FLUENCY_MIN_RECORDS` valid records inside the 8-week window. 用趋势
 * 不用及格线 — nothing here renders a pass/fail threshold.
 */

/** A set needs this many valid records before its trend is drawn (spec 默认 6). */
export const FLUENCY_MIN_RECORDS = 3;

/** One deduped, duration-valid answer with its fluency verdict. */
export interface FluencyRecord {
  attempt: PracticeAttempt;
  durationMs: number;
  /** true = 自动召回 (correct and fast); false = 对了但慢. */
  autoRecall: boolean;
}

/** One practice set's fluent stats across the window. */
export interface FluencySetTrend {
  setId: string;
  /**
   * Median answer time per week in ms, oldest week first, `null` when the
   * week has no valid record. Same 8 Monday-based weeks as the accuracy trend.
   */
  weekMedians: (number | null)[];
  /** The records feeding these numbers (deduped, valid, inside the window). */
  records: FluencyRecord[];
  /** Median across all the set's records; null before the first valid one. */
  medianMs: number | null;
  /** Correct-and-fast count. */
  autoRecall: number;
  /** Correct-but-slow count. */
  slowCorrect: number;
  /**
   * `autoRecall / (autoRecall + slowCorrect)` — the share among *graded*
   * answers; wrong answers are in neither tier so they enter no denominator.
   * Null when the set has no correct record.
   */
  autoRecallShare: number | null;
}

export interface FluencyTrendData {
  /** Sets meeting the `FLUENCY_MIN_RECORDS` gate, sorted by setId. */
  sets: FluencySetTrend[];
  /** True when at least one set passed the gate. */
  hasData: boolean;
}

/** Middle value (even counts average the two middles, rounded to whole ms). */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/**
 * Reduces attempts to per-set fluent stats. Pure: the input array is never
 * mutated, so callers can keep handing the full raw history.
 */
export function fluencyTrend(
  attempts: readonly PracticeAttempt[],
  today: Date
): FluencyTrendData {
  const currentMonday = startOfWeek(today);
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  // Deterministic 「第一次」: oldest answer wins a tie on the same timestamp.
  const ordered = [...attempts].sort(
    (a, b) => a.answeredAt.localeCompare(b.answeredAt) || a.id.localeCompare(b.id)
  );

  // 去重 keyed on question + local calendar day: the FIRST answer claims the
  // slot whether or not it carries a usable duration (Anki counts reviews, not
  // measurements) — a duration-less first answer then contributes no record.
  const seen = new Set<string>();
  const deduped: Array<{ record: FluencyRecord; weekOffset: number }> = [];
  for (const attempt of ordered) {
    const date = new Date(attempt.answeredAt);
    if (Number.isNaN(date.getTime())) continue;
    const day = formatLocalDate(date);
    const key = `${attempt.questionId}#${day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const durationMs = normalizePracticeDurationMs(attempt.durationMs);
    if (durationMs === undefined) continue;
    const weekOffset = Math.round((currentMonday.getTime() - startOfWeek(date).getTime()) / weekMs);
    // Out-of-window answers still claim their 每日第一次 slot, but only
    // in-window records are displayed and counted toward the gate.
    if (weekOffset < 0 || weekOffset >= ACCURACY_TREND_WEEKS) continue;
    deduped.push({
      record: {
        attempt,
        durationMs,
        autoRecall: attempt.correct && durationMs < AUTO_RECALL_MS
      },
      weekOffset
    });
  }

  interface SetBucket {
    /** Indexed oldest week first, so it maps straight onto the rendered bars. */
    weeks: number[][];
    records: FluencyRecord[];
  }
  const buckets = new Map<string, SetBucket>();
  for (const { record, weekOffset } of deduped) {
    const bucket = buckets.get(record.attempt.setId) ?? {
      weeks: Array.from({ length: ACCURACY_TREND_WEEKS }, () => []),
      records: []
    };
    bucket.weeks[ACCURACY_TREND_WEEKS - 1 - weekOffset]!.push(record.durationMs);
    bucket.records.push(record);
    buckets.set(record.attempt.setId, bucket);
  }

  const sets: FluencySetTrend[] = [];
  for (const [setId, bucket] of buckets) {
    if (bucket.records.length < FLUENCY_MIN_RECORDS) continue;
    // 分级 (acceptance 9): correct && <AUTO_RECALL_MS is 自动召回, correct
    // && >= is 对了但慢, wrong answers count in neither tier.
    const correctRecords = bucket.records.filter((record) => record.attempt.correct);
    const autoRecall = correctRecords.filter((record) => record.autoRecall).length;
    const slowCorrect = correctRecords.length - autoRecall;
    sets.push({
      setId,
      weekMedians: bucket.weeks.map((week) => median(week)),
      records: bucket.records,
      medianMs: median(bucket.records.map((record) => record.durationMs)),
      autoRecall,
      slowCorrect,
      autoRecallShare:
        correctRecords.length === 0 ? null : autoRecall / correctRecords.length
    });
  }
  sets.sort((a, b) => a.setId.localeCompare(b.setId));

  return { sets, hasData: sets.length > 0 };
}
