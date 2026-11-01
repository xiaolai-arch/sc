import { formatLocalDate, parseLocalDate } from './date';

/** One aggregated usage row for a local day, provider and model. */
export interface UsageEntry {
  /** Local calendar date (`YYYY-MM-DD`). */
  date: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface UsageDay {
  date: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface UsageSummary {
  /** Newest first; only dates with recorded usage. */
  days: UsageDay[];
  totals: UsageTotals;
  /** Filled by the caller from configured prices; null when none are set. */
  estimatedCost: number | null;
}

function emptyTotals(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, calls: 0 };
}

/** Aggregates entries inside the last `days` local days, ending at `today`. */
export function summarizeUsage(
  entries: readonly UsageEntry[],
  days: number,
  today: string
): UsageSummary {
  const totals = emptyTotals();
  if (!Number.isFinite(days) || days <= 0) {
    return { days: [], totals, estimatedCost: null };
  }

  const start = parseLocalDate(today);
  start.setDate(start.getDate() - (Math.trunc(days) - 1));
  const cutoff = formatLocalDate(start);
  const byDate = new Map<string, UsageDay>();

  for (const entry of entries) {
    if (entry.date < cutoff || entry.date > today) continue;
    const day =
      byDate.get(entry.date) ??
      { date: entry.date, inputTokens: 0, outputTokens: 0, calls: 0 };
    day.inputTokens += entry.inputTokens;
    day.outputTokens += entry.outputTokens;
    day.calls += entry.calls;
    byDate.set(entry.date, day);
    totals.inputTokens += entry.inputTokens;
    totals.outputTokens += entry.outputTokens;
    totals.calls += entry.calls;
  }

  return {
    days: [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)),
    totals,
    estimatedCost: null
  };
}

/**
 * Local estimate only; it is not a bill. Prices are yuan per million tokens.
 * Returns null when neither price is configured.
 */
export function estimateUsageCost(
  totals: UsageTotals,
  inputPricePerMillion?: number,
  outputPricePerMillion?: number
): number | null {
  const inputPrice =
    typeof inputPricePerMillion === 'number' &&
    Number.isFinite(inputPricePerMillion) &&
    inputPricePerMillion > 0
      ? inputPricePerMillion
      : 0;
  const outputPrice =
    typeof outputPricePerMillion === 'number' &&
    Number.isFinite(outputPricePerMillion) &&
    outputPricePerMillion > 0
      ? outputPricePerMillion
      : 0;
  if (inputPrice === 0 && outputPrice === 0) return null;
  return (
    (totals.inputTokens / 1_000_000) * inputPrice +
    (totals.outputTokens / 1_000_000) * outputPrice
  );
}
