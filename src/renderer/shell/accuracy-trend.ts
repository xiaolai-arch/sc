import { formatLocalDate } from '../../shared/date';
import type { PracticeAttempt } from '../../shared/practice';

/** Weeks the trend covers: the current week plus the seven before it. */
export const ACCURACY_TREND_WEEKS = 8;

/** Direction of the current week's accuracy against the previous scored week. */
export type AccuracyDirection = '上升' | '下降' | '持平';

/** One Monday-based week of practice: volume plus accuracy. */
export interface AccuracyWeek {
  /** Monday of the week, local date `YYYY-MM-DD`. */
  weekStart: string;
  /** Sunday of the week, local date `YYYY-MM-DD`. */
  weekEnd: string;
  /** Attempts recorded in the week. */
  answered: number;
  /** Correct attempts among them. */
  correct: number;
  /** `correct / answered`, or null when nothing was answered that week. */
  accuracy: number | null;
  /** Column caption for the week's Monday, e.g. `10/26`. */
  caption: string;
  /** Tooltip and aria-label, e.g. `10月26日–11月1日 · 做 5 题 · 正确率 80%`. */
  label: string;
}

export interface AccuracyTrendTotals {
  /** Attempts inside the window. */
  answered: number;
  /** Correct attempts among them. */
  correct: number;
  /** `correct / answered` across the window, or null before the first answer. */
  accuracy: number | null;
  /** 上升 / 下降 / 持平 against the previous week that has attempts. */
  direction: AccuracyDirection | null;
  /** Signed percentage-point change against that week; null when incomparable. */
  deltaPoints: number | null;
  /** weekStart of the week the direction was measured against. */
  comparedWeekStart: string | null;
}

export interface AccuracyTrendData {
  /** Oldest week first, ending with the current week. */
  weeks: AccuracyWeek[];
  totals: AccuracyTrendTotals;
  /** Summary line, e.g. `最近 8 周做 42 题 · 正确率 76%（比上周 +4 个百分点）`. */
  summary: string;
  /** False when no attempt fell inside the window. */
  hasData: boolean;
}

/**
 * Monday 00:00 of the date's local week. Shared with the 用时流畅度 stats so
 * both trends bucket answers onto identical weeks.
 */
export function startOfWeek(today: Date): Date {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // getDay(): 0 = Sunday; shift so Monday starts the week.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function formatChineseDay(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}月${day}日`;
}

function weekLabel(
  weekStart: string,
  weekEnd: string,
  answered: number,
  accuracy: number | null
): string {
  const range = `${formatChineseDay(weekStart)}–${formatChineseDay(weekEnd)}`;
  if (accuracy === null) return `${range} · 做 0 题 · 无答题`;
  return `${range} · 做 ${answered} 题 · 正确率 ${Math.round(accuracy * 100)}%`;
}

/**
 * Aggregates practice accuracy per Monday-based week over the last 8 weeks,
 * from the same source as 本周概览: `PracticeAttempt.answeredAt`, converted
 * to a local date the same way. Weeks with no attempts keep `accuracy: null`
 * rather than a fake 0%. The direction compares the current week only with
 * the previous week that actually has attempts, skipping empty weeks.
 */
export function accuracyTrend(
  attempts: readonly PracticeAttempt[],
  today: Date
): AccuracyTrendData {
  const currentMonday = startOfWeek(today);
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  // Bucket attempts onto their week's Monday; `Math.round` absorbs any
  // daylight-saving hour drift between two local midnights.
  const buckets = new Map<number, { answered: number; correct: number }>();
  for (const attempt of attempts) {
    const date = new Date(attempt.answeredAt);
    if (Number.isNaN(date.getTime())) continue;
    const monday = startOfWeek(date);
    const offset = Math.round((currentMonday.getTime() - monday.getTime()) / weekMs);
    if (offset < 0 || offset >= ACCURACY_TREND_WEEKS) continue;
    const bucket = buckets.get(offset) ?? { answered: 0, correct: 0 };
    bucket.answered += 1;
    if (attempt.correct) bucket.correct += 1;
    buckets.set(offset, bucket);
  }

  const weeks: AccuracyWeek[] = [];
  let totalAnswered = 0;
  let totalCorrect = 0;
  // Oldest week first so the array renders left to right.
  for (let offset = ACCURACY_TREND_WEEKS - 1; offset >= 0; offset -= 1) {
    const bucket = buckets.get(offset) ?? { answered: 0, correct: 0 };
    const monday = new Date(currentMonday);
    monday.setDate(monday.getDate() - offset * 7);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    const weekStart = formatLocalDate(monday);
    const weekEnd = formatLocalDate(sunday);
    const accuracy = bucket.answered === 0 ? null : bucket.correct / bucket.answered;
    weeks.push({
      weekStart,
      weekEnd,
      answered: bucket.answered,
      correct: bucket.correct,
      accuracy,
      caption: `${monday.getMonth() + 1}/${monday.getDate()}`,
      label: weekLabel(weekStart, weekEnd, bucket.answered, accuracy)
    });
    totalAnswered += bucket.answered;
    totalCorrect += bucket.correct;
  }

  const current = weeks[ACCURACY_TREND_WEEKS - 1];
  const overallAccuracy = totalAnswered === 0 ? null : totalCorrect / totalAnswered;

  let direction: AccuracyDirection | null = null;
  let deltaPoints: number | null = null;
  let comparedWeekStart: string | null = null;
  if (current.accuracy !== null) {
    for (let index = ACCURACY_TREND_WEEKS - 2; index >= 0; index -= 1) {
      const previous = weeks[index];
      if (previous.accuracy === null) continue;
      deltaPoints = Math.round((current.accuracy - previous.accuracy) * 100);
      direction = deltaPoints > 0 ? '上升' : deltaPoints < 0 ? '下降' : '持平';
      comparedWeekStart = previous.weekStart;
      break;
    }
  }

  let comparison = '';
  if (direction !== null && deltaPoints !== null && comparedWeekStart !== null) {
    const compared = weeks.find((week) => week.weekStart === comparedWeekStart)!;
    const isLastWeek = compared === weeks[ACCURACY_TREND_WEEKS - 2];
    // `上周` binds without a space; a named week (`11/2 那周`) needs one.
    const target = isLastWeek ? '上周' : ` ${compared.caption} 那周`;
    comparison =
      direction === '持平'
        ? `（与${target}持平）`
        : `（比${target} ${deltaPoints > 0 ? '+' : ''}${deltaPoints} 个百分点）`;
  }

  const summary =
    totalAnswered === 0
      ? `最近 ${ACCURACY_TREND_WEEKS} 周做 0 题`
      : `最近 ${ACCURACY_TREND_WEEKS} 周做 ${totalAnswered} 题 · 正确率 ${Math.round(
          (totalCorrect / totalAnswered) * 100
        )}%${comparison}`;

  return {
    weeks,
    totals: {
      answered: totalAnswered,
      correct: totalCorrect,
      accuracy: overallAccuracy,
      direction,
      deltaPoints,
      comparedWeekStart
    },
    summary,
    hasData: totalAnswered > 0
  };
}
