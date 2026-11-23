import { localDaysBetween } from '../../src/shared/date';

/**
 * B (P0 复核备注): the local-days math must stay exact across DST shifts.
 * These tests pin a DST timezone (America/New_York) and restore it afterwards,
 * so the rounding — not the machine's own zone — is what is under test.
 *
 * In New York, 2026 spring-forward is Mar 8 (a 23-hour local day) and
 * fall-back is Nov 1 (a 25-hour local day). A naive `(end - start) / 86400000`
 * would answer 0.958 / 1.042 for the one-day spans; `localDaysBetween` rounds,
 * and these tests lock that in.
 */
test('one-day spans across a spring-forward stay exactly 1 day', () => {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    // The local day Mar 7 → Mar 8 is 23 hours long.
    expect(localDaysBetween('2026-03-07', '2026-03-08')).toBe(1);
    // And the reverse direction is its exact negative.
    expect(localDaysBetween('2026-03-08', '2026-03-07')).toBe(-1);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test('one-day spans across a fall-back stay exactly 1 day', () => {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    // The local day Oct 31 → Nov 1 is 25 hours long.
    expect(localDaysBetween('2026-10-31', '2026-11-01')).toBe(1);
    expect(localDaysBetween('2026-11-01', '2026-10-31')).toBe(-1);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test('week-length spans through both transitions stay exact (the due formula)', () => {
  const previousTZ = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    // A 7-day interval across spring-forward: still 7, not 6.958.
    expect(localDaysBetween('2026-03-02', '2026-03-09')).toBe(7);
    // A 30-day interval across fall-back: still 30, not 30.042.
    expect(localDaysBetween('2026-10-05', '2026-11-04')).toBe(30);
    // 29 days over the fall-back boundary must still read as 29 (the 验收 7
    // "29 days → not due" case cannot drift into "30" near a transition).
    expect(localDaysBetween('2026-10-05', '2026-11-03')).toBe(29);
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});
