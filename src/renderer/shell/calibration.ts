import type { PracticeAttempt } from '../../shared/practice';

/** The window the calibration line covers: this week plus the seven before. */
export const CALIBRATION_WEEKS = 8;

/**
 * Confidence calibration over recent attempts.
 *
 * Illusions of competence are the norm in self-regulated study (Kornell &
 * Bjork 2009; Koriat & Bjork 2005): a learner who answers 1 有把握 and gets it
 * wrong has met exactly the item worth drilling. This helper counts that
 * mismatch honestly instead of rewarding fluency, and reports nothing at all
 * while no attempt carries a confidence mark — a fake 0% would be a lie.
 */
export interface CalibrationData {
  /** Attempts marked `有把握` inside the window. */
  sureTotal: number;
  /** Wrong attempts among them. */
  sureWrong: number;
  /** Attempts marked `不确定` inside the window. */
  unsureTotal: number;
  /** Wrong attempts among them. */
  unsureWrong: number;
  /**
   * The one honest line, e.g. `近 8 周：有把握的 12 题错 3 道（25%）· 不确定的
   * 5 题错 2 道`. Null when neither mark occurs, so the card renders nothing.
   */
  line: string | null;
  /** True when at least one attempt inside the window carries confidence. */
  hasData: boolean;
}

function startOfWeek(today: Date): Date {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // getDay(): 0 = Sunday; shift so Monday starts the week.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

/** A segment only appears when its group has attempts; percentages need a base. */
function sureSegment(total: number, wrong: number): string | null {
  if (total === 0) return null;
  return `有把握的 ${total} 题错 ${wrong} 道（${Math.round((wrong / total) * 100)}%）`;
}

function unsureSegment(total: number, wrong: number): string | null {
  if (total === 0) return null;
  return `不确定的 ${total} 题错 ${wrong} 道`;
}

/**
 * Counts confidently-wrong and unsure-wrong answers over the last 8
 * Monday-based weeks, the same window and local-date conversion as
 * 正确率趋势. Attempts without confidence, attempts outside the window and
 * attempts with an unparseable timestamp are ignored.
 */
export function calibration(
  attempts: readonly PracticeAttempt[],
  today: Date
): CalibrationData {
  const currentMonday = startOfWeek(today);
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  let sureTotal = 0;
  let sureWrong = 0;
  let unsureTotal = 0;
  let unsureWrong = 0;

  for (const attempt of attempts) {
    if (attempt.confidence !== 'sure' && attempt.confidence !== 'unsure') continue;
    const date = new Date(attempt.answeredAt);
    if (Number.isNaN(date.getTime())) continue;
    // `Math.round` absorbs daylight-saving drift between two local midnights.
    const offset = Math.round((currentMonday.getTime() - startOfWeek(date).getTime()) / weekMs);
    if (offset < 0 || offset >= CALIBRATION_WEEKS) continue;
    if (attempt.confidence === 'sure') {
      sureTotal += 1;
      if (!attempt.correct) sureWrong += 1;
    } else {
      unsureTotal += 1;
      if (!attempt.correct) unsureWrong += 1;
    }
  }

  const segments = [
    sureSegment(sureTotal, sureWrong),
    unsureSegment(unsureTotal, unsureWrong)
  ].filter((segment): segment is string => segment !== null);
  const hasData = segments.length > 0;

  return {
    sureTotal,
    sureWrong,
    unsureTotal,
    unsureWrong,
    line: hasData ? `近 ${CALIBRATION_WEEKS} 周：${segments.join('· ')}` : null,
    hasData
  };
}
