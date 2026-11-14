import {
  estimateUsageCost,
  summarizeUsage,
  type UsageEntry,
  type UsageTotals
} from '../../src/shared/usage';

function entry(
  date: string,
  inputTokens: number,
  outputTokens: number,
  calls = 1,
  provider = 'anthropic',
  model = 'claude'
): UsageEntry {
  return { date, provider, model, inputTokens, outputTokens, calls };
}

test('aggregates the last N days, newest first', () => {
  const entries = [
    entry('2026-11-01', 10, 5, 2),
    entry('2026-11-01', 1, 1, 1, 'openai-compatible', 'x'),
    entry('2026-10-31', 100, 50, 3),
    entry('2026-10-26', 999, 999, 9), // 6 days back: inside a 7-day window
    entry('2026-10-25', 1, 1, 1) // 7 days back: outside
  ];

  const summary = summarizeUsage(entries, 7, '2026-11-01');

  expect(summary.days.map((day) => day.date)).toEqual([
    '2026-11-01',
    '2026-10-31',
    '2026-10-26'
  ]);
  expect(summary.days[0]).toEqual({
    date: '2026-11-01',
    inputTokens: 11,
    outputTokens: 6,
    calls: 3,
    conversation: { inputTokens: 11, outputTokens: 6, calls: 3 },
    videoNotes: { inputTokens: 0, outputTokens: 0, calls: 0 }
  });
  expect(summary.totals).toEqual({
    inputTokens: 1110,
    outputTokens: 1055,
    calls: 15
  });
  expect(summary.conversation).toEqual(summary.totals);
  expect(summary.videoNotes).toEqual({ inputTokens: 0, outputTokens: 0, calls: 0 });
  expect(summary.estimatedCost).toBeNull();
});

test('splits video-note usage from conversation usage', () => {
  const entries: UsageEntry[] = [
    entry('2026-11-01', 10, 5, 1),
    { ...entry('2026-11-01', 100, 50, 2), feature: 'video-notes' }
  ];

  const summary = summarizeUsage(entries, 7, '2026-11-01');

  expect(summary.totals).toEqual({ inputTokens: 110, outputTokens: 55, calls: 3 });
  expect(summary.conversation).toEqual({ inputTokens: 10, outputTokens: 5, calls: 1 });
  expect(summary.videoNotes).toEqual({ inputTokens: 100, outputTokens: 50, calls: 2 });
  expect(summary.days[0]?.conversation).toEqual({
    inputTokens: 10,
    outputTokens: 5,
    calls: 1
  });
});

test('returns an empty summary when there is nothing in the window', () => {
  expect(summarizeUsage([], 7, '2026-11-01')).toEqual({
    days: [],
    totals: { inputTokens: 0, outputTokens: 0, calls: 0 },
    conversation: { inputTokens: 0, outputTokens: 0, calls: 0 },
    videoNotes: { inputTokens: 0, outputTokens: 0, calls: 0 },
    estimatedCost: null
  });
  expect(summarizeUsage([entry('2026-01-01', 5, 5)], 7, '2026-11-01').days).toEqual([]);
});

test('estimates cost only when a price is configured', () => {
  const totals: UsageTotals = {
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    calls: 2
  };

  expect(estimateUsageCost(totals, undefined, undefined)).toBeNull();
  expect(estimateUsageCost(totals, 0, 0)).toBeNull();
  expect(estimateUsageCost(totals, 2, 4)).toBe(4);
  expect(estimateUsageCost(totals, 2, undefined)).toBe(2);
});
