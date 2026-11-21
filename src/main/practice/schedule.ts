/**
 * FSRS 思路的最小调度器，不做参数训练。
 *
 * The evidence (Dunlosky et al. 2013; Cepeda et al. 2006; Ye, Su & Cao 2022)
 * is unambiguous: spaced practice beats massing, and what makes it spaced is
 * that a *successful* review pushes the next review further out while a failure
 * resets it. This module turns that into a deterministic, dependency-free
 * update over two numbers:
 *
 * - `stabilityDays` — how many days the memory has held so far; it becomes the
 *   length of the next interval after a correct answer.
 * - `difficulty` — 0 (easy) to 1 (hard); it grows on failure, shrinks on
 *   success, and damps the growth factor so hard items advance more slowly.
 *
 * It is a schematic of FSRS/SM-2 rather than an implementation of either: no
 * parameter training, no retrievability model, just the monotone shape the
 * research supports. Legacy records carry no stability/difficulty, so
 * `migrateSchedule` derives them from the old `intervalDays`/`priority`.
 */

import { parseLocalDate, formatLocalDate } from '../../shared/date';
import type { PracticeMistakeStatus } from '../../shared/practice';

export const MIN_DIFFICULTY = 0.1;
export const MAX_DIFFICULTY = 0.9;
export const MAX_INTERVAL_DAYS = 365;

/** A wrong answer always comes back the next day. */
const WRONG_INTERVAL_DAYS = 1;
const WRONG_DIFFICULTY_STEP = 0.1;
const CORRECT_DIFFICULTY_STEP = 0.05;
/**
 * Growth factor is `GROWTH_BASE - difficulty`, i.e. 1.1–1.9 per success, and
 * the product is rounded, so the interval strictly advances every time: a
 * record that keeps succeeding walks 1 → 2 → 4 → 8 → 16 days, then keeps
 * doubling until the one-year cap.
 */
const GROWTH_BASE = 2.0;
/** An interval this long (or longer) counts as "spaced" for mastery. */
const SPACED_THRESHOLD_DAYS = 3;

/** The scheduling fields a record may or may not carry. */
export interface ScheduleSource {
  intervalDays?: number;
  priority?: number;
  stabilityDays?: number;
  difficulty?: number;
}
/** Everything `nextSchedule` needs from the record being answered. */
export interface ScheduleState extends ScheduleSource {
  intervalDays: number;
  due: string;
}

export interface NextScheduleInput {
  correct: boolean;
  /** Local calendar date (`YYYY-MM-DD`) of the answer. */
  today: string;
}

export interface ScheduleResult {
  stabilityDays: number;
  difficulty: number;
  intervalDays: number;
  due: string;
  status: PracticeMistakeStatus;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampDifficulty(value: number): number {
  return round2(clamp(value, MIN_DIFFICULTY, MAX_DIFFICULTY));
}

function addDays(date: string, days: number): string {
  const next = parseLocalDate(date);
  next.setDate(next.getDate() + days);
  return formatLocalDate(next);
}

/**
 * Derives the scheduling pair for a record that predates them.
 *
 * Deterministic by design: the old `intervalDays` (default 1) is the starting
 * stability, and difficulty is a linear function of the old priority
 * (`0.3 + 0.15 * priority`, clamped to 0.1–0.9). Values already on the record
 * win, so this is also the normalisation used before every update.
 */
export function migrateSchedule(mistake: ScheduleSource): {
  stabilityDays: number;
  difficulty: number;
} {
  const stabilityDays = isPositiveFinite(mistake.stabilityDays)
    ? mistake.stabilityDays
    : isPositiveFinite(mistake.intervalDays)
      ? mistake.intervalDays
      : 1;
  const priority =
    typeof mistake.priority === 'number' && Number.isFinite(mistake.priority)
      ? clamp(mistake.priority, 0, 3)
      : 0;
  const difficulty = round2(
    clamp(
      typeof mistake.difficulty === 'number' && Number.isFinite(mistake.difficulty)
        ? mistake.difficulty
        : 0.3 + 0.15 * priority,
      MIN_DIFFICULTY,
      MAX_DIFFICULTY
    )
  );
  return { stabilityDays, difficulty };
}

/**
 * One answer → the record's next review state.
 *
 * - Wrong: stability resets to one day, difficulty rises, due tomorrow.
 * - Correct: difficulty falls; the interval grows monotonically from the
 *   current stability (`round(stability * (2 - difficulty))`, at least
 *   `intervalDays + 1`, capped at 365 days), and due moves forward by it.
 * - Resolved only when the answer is correct, the interval that just elapsed
 *   was at least 3 days, and today is a later day than the last answer.
 *   Two correct answers in one sitting therefore never mark a mistake mastered.
 */
export function nextSchedule(
  current: ScheduleState,
  { correct, today }: NextScheduleInput
): ScheduleResult {
  const base = migrateSchedule(current);
  if (!correct) {
    return {
      stabilityDays: 1,
      difficulty: clampDifficulty(base.difficulty + WRONG_DIFFICULTY_STEP),
      intervalDays: WRONG_INTERVAL_DAYS,
      due: addDays(today, WRONG_INTERVAL_DAYS),
      status: 'active'
    };
  }

  const difficulty = clampDifficulty(base.difficulty - CORRECT_DIFFICULTY_STEP);
  const grown = round2(base.stabilityDays * (GROWTH_BASE - difficulty));
  const intervalDays = Math.min(
    MAX_INTERVAL_DAYS,
    Math.max(current.intervalDays + 1, Math.round(grown))
  );
  // The interval that just elapsed: `due` was set to the previous answer's day
  // plus `intervalDays`, so both are local calendar dates and the comparison is
  // timezone-free. (The UTC `lastAnsweredAt` timestamp would be off by one day
  // for early-morning local answers, so it is deliberately not used here.)
  const lastAnsweredOn = addDays(current.due, -current.intervalDays);
  const spaced = current.intervalDays >= SPACED_THRESHOLD_DAYS;
  const laterDay = today > lastAnsweredOn;
  return {
    stabilityDays: intervalDays,
    difficulty,
    intervalDays,
    due: addDays(today, intervalDays),
    status: spaced && laterDay ? 'resolved' : 'active'
  };
}

/**
 * Compact Chinese schedule line for the UI, e.g. `下次复习 11月24日 · 间隔 3 天`.
 * Reads only the record, so it works for legacy entries too.
 */
export function scheduleLabel(mistake: {
  status: PracticeMistakeStatus;
  due: string;
  intervalDays: number;
}): string {
  if (mistake.status === 'resolved') return '已掌握';
  const [, month, day] = mistake.due.split('-').map(Number);
  return `下次复习 ${month}月${day}日 · 间隔 ${mistake.intervalDays} 天`;
}
