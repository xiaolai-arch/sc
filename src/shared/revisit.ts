/**
 * The deterministic revisit ladder for knowledge topics. Each revisit-day
 * self-test the learner catches moves the topic one rung up; a miss drops it
 * back to the first rung the next day. There is no scoring, no tuning and no
 * model — only this table.
 */

/** Days until the next revisit for ladder steps 1–4. */
export const REVISIT_LADDER_DAYS = [3, 7, 14, 30] as const;

/** True only for an on-ladder step (integer 1–4); anything else is off it. */
export function isRevisitStep(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= REVISIT_LADDER_DAYS.length
  );
}

/**
 * The next revisit after a self-test. `recalled` (the learner caught it) →
 * one rung up, capped at the top of the ladder; a miss → tomorrow with the
 * step cleared (step 0 = "not on the ladder"). Values off the ladder
 * (undefined, 0, out-of-range or non-integer) count as never having entered
 * it, so a caught topic starts at step 1 (3 days).
 */
export function nextRevisit(
  step: number | undefined,
  recalled: boolean
): { step: number; days: number } {
  if (!recalled) return { step: 0, days: 1 };
  const current = isRevisitStep(step) ? step : 0;
  const next = Math.min(current + 1, REVISIT_LADDER_DAYS.length);
  return { step: next, days: REVISIT_LADDER_DAYS[next - 1] };
}
