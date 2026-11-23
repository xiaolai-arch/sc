import { busyDayMinutes, BUSY_DAY_MINUTES } from '../../src/main/planning';
import type { AvailabilityService } from '../../src/main/availability/service';
/** 2026-11-24 is the Tuesday of the week starting Monday 2026-11-23. */
const TUESDAY = '2026-11-24';

function availabilityStub(
  busyDatesBetween: AvailabilityService['busyDatesBetween']
): AvailabilityService {
  return {
    list: async () => [],
    busyDatesBetween,
    set: async () => {
      throw new Error('not used');
    },
    clear: async () => undefined
  };
}

test('busyDayMinutes returns BUSY_DAY_MINUTES when the date is marked busy', async () => {
  const queries: Array<[string, string]> = [];
  const availability = availabilityStub(async (from, to) => {
    queries.push([from, to]);
    return ['2026-11-23', TUESDAY];
  });

  await expect(busyDayMinutes(availability, TUESDAY)).resolves.toBe(BUSY_DAY_MINUTES);
  // The shared read looks at exactly the target day, never the whole week.
  expect(queries).toEqual([[TUESDAY, TUESDAY]]);
});

test('busyDayMinutes returns undefined when the date is not busy', async () => {
  const availability = availabilityStub(async () => ['2026-11-23']);

  await expect(busyDayMinutes(availability, TUESDAY)).resolves.toBeUndefined();
});

test('busyDayMinutes returns undefined for an empty availability record', async () => {
  const availability = availabilityStub(async () => []);

  await expect(busyDayMinutes(availability, TUESDAY)).resolves.toBeUndefined();
});

test('busyDayMinutes stays best-effort when the availability read throws', async () => {
  const availability = availabilityStub(async () => {
    throw new Error('week-availability.md 损坏');
  });

  // A broken record must never block planning: the caller plans without the
  // override instead.
  await expect(busyDayMinutes(availability, TUESDAY)).resolves.toBeUndefined();
});
