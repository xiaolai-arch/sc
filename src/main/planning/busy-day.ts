import { BUSY_DAY_MINUTES } from '../../shared/planning';
import type { AvailabilityService } from '../availability/service';

/**
 * One shared answer for both planning entry points (the `plan_workspace`
 * butler tool and `api.planWorkspace`): is `date` one of the days the user
 * marked as especially full in their week availability, and if so how many
 * minutes should the plan get — always `BUSY_DAY_MINUTES`? Returns
 * `undefined` when the day is not busy.
 *
 * Whether to apply the answer stays with the caller: a call that pins
 * `availableMinutes` itself must not even ask (each entry point keeps that
 * check). The read itself is best-effort by contract — an unreadable or
 * broken availability record returns `undefined` instead of throwing, so
 * planning never blocks on it.
 */
export async function busyDayMinutes(
  availability: Pick<AvailabilityService, 'busyDatesBetween'>,
  date: string
): Promise<number | undefined> {
  try {
    const busy = await availability.busyDatesBetween(date, date);
    return busy.includes(date) ? BUSY_DAY_MINUTES : undefined;
  } catch {
    // Stay without the week override.
    return undefined;
  }
}
