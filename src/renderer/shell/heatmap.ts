import { formatLocalDate } from '../../shared/date';
import type { WorkspaceTask } from '../../shared/workspace';

/** Days the heatmap covers: the last 12 weeks (84 days) ending today. */
export const HEATMAP_WINDOW_DAYS = 84;

/** Minutes where a day's colour steps up: a day is 0 / 1-14 / 15-44 / 45+. */
export const HEATMAP_LEVEL_1_MINUTES = 1;
export const HEATMAP_LEVEL_2_MINUTES = 15;
export const HEATMAP_LEVEL_3_MINUTES = 45;

/** One day of the grid: a colour bucket plus the tooltip/aria text. */
export interface HeatmapCell {
  /** Local date `YYYY-MM-DD`. */
  date: string;
  /** Recorded study minutes that day. */
  minutes: number;
  /** Colour bucket 0 (empty) … 3 (45+ minutes). */
  level: 0 | 1 | 2 | 3;
  /** Tooltip and aria-label text, e.g. `11月21日 · 45 分钟`. */
  label: string;
}

export interface StudyHeatmapData {
  /**
   * Monday-aligned columns of the grid, 7 rows each. `null` pads the first
   * column before the window starts so weekday rows stay aligned.
   */
  columns: (HeatmapCell | null)[][];
  /** Total minutes recorded across the window. */
  totalMinutes: number;
  /** Days with at least one recorded minute. */
  activeDays: number;
  /** Longest run of consecutive active days inside the window. */
  longestStreak: number;
  /** Text alternative for the grid: `最近 12 周共学习 N 分钟 · 最长连续 M 天`. */
  summary: string;
  /** False when no task recorded any minutes in the window. */
  hasData: boolean;
}

/** Maps a day's minutes onto the colour buckets defined by the thresholds. */
export function heatmapLevel(minutes: number): HeatmapCell['level'] {
  if (minutes >= HEATMAP_LEVEL_3_MINUTES) return 3;
  if (minutes >= HEATMAP_LEVEL_2_MINUTES) return 2;
  if (minutes >= HEATMAP_LEVEL_1_MINUTES) return 1;
  return 0;
}

function cellLabel(date: string, minutes: number): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}月${day}日 · ${minutes} 分钟`;
}

/**
 * Aggregates study minutes per day over the last 12 weeks, from the same
 * source as 本周概览: completed tasks' recorded `actualMin`, counted on the
 * task's due date — undated completed work belongs to the current week, so it
 * lands on today. Summing this week's cells therefore reproduces the
 * overview's 专注时长 exactly; no second source of truth.
 */
export function studyHeatmap(
  tasks: readonly WorkspaceTask[],
  today: Date
): StudyHeatmapData {
  const todayKey = formatLocalDate(today);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - (HEATMAP_WINDOW_DAYS - 1));
  const startKey = formatLocalDate(start);
  // Columns start on Monday so the 7 weekday rows align; pad the head.
  const pad = (start.getDay() + 6) % 7;

  const minutesByDate = new Map<string, number>();
  for (const task of tasks) {
    if (task.status !== 'done') continue;
    const minutes = task.actualMin;
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) {
      continue;
    }
    const date = task.due === undefined ? todayKey : task.due;
    if (date < startKey || date > todayKey) continue;
    minutesByDate.set(date, (minutesByDate.get(date) ?? 0) + minutes);
  }

  const cells: HeatmapCell[] = [];
  const cursor = new Date(start);
  let totalMinutes = 0;
  let activeDays = 0;
  let longestStreak = 0;
  let run = 0;
  for (let index = 0; index < HEATMAP_WINDOW_DAYS; index += 1) {
    const key = formatLocalDate(cursor);
    const minutes = minutesByDate.get(key) ?? 0;
    cells.push({
      date: key,
      minutes,
      level: heatmapLevel(minutes),
      label: cellLabel(key, minutes)
    });
    cursor.setDate(cursor.getDate() + 1);
    totalMinutes += minutes;
    if (minutes > 0) {
      activeDays += 1;
      run += 1;
      longestStreak = Math.max(longestStreak, run);
    } else {
      run = 0;
    }
  }

  const grid: (HeatmapCell | null)[] = [
    ...Array<HeatmapCell | null>(pad).fill(null),
    ...cells
  ];
  const columns: (HeatmapCell | null)[][] = [];
  for (let index = 0; index < grid.length; index += 7) {
    columns.push(grid.slice(index, index + 7));
  }

  return {
    columns,
    totalMinutes,
    activeDays,
    longestStreak,
    summary: `最近 ${HEATMAP_WINDOW_DAYS / 7} 周共学习 ${totalMinutes} 分钟 · 最长连续 ${longestStreak} 天`,
    hasData: totalMinutes > 0
  };
}
