import { formatLocalDate, parseLocalDate } from './date';

/** Usage source. Missing means a conversation turn (older records). */
export type UsageFeature = 'video-notes';

/** One aggregated usage row for a local day, provider, model and feature. */
export interface UsageEntry {
  /** Local calendar date (`YYYY-MM-DD`). */
  date: string;
  provider: string;
  model: string;
  /** `video-notes` is excluded from the proactive-check-in budget. */
  feature?: UsageFeature;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface UsageDay {
  date: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  /** Split totals; older callers may omit them (all conversation). */
  conversation?: UsageTotals;
  videoNotes?: UsageTotals;
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
  /** Split totals; video-notes usage never counts toward the proactive budget. */
  conversation?: UsageTotals;
  videoNotes?: UsageTotals;
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
  const conversation = emptyTotals();
  const videoNotes = emptyTotals();
  if (!Number.isFinite(days) || days <= 0) {
    return {
      days: [],
      totals,
      conversation,
      videoNotes,
      estimatedCost: null
    };
  }

  const start = parseLocalDate(today);
  start.setDate(start.getDate() - (Math.trunc(days) - 1));
  const cutoff = formatLocalDate(start);
  const byDate = new Map<string, UsageDay>();

  for (const entry of entries) {
    if (entry.date < cutoff || entry.date > today) continue;
    const day =
      byDate.get(entry.date) ?? {
        date: entry.date,
        inputTokens: 0,
        outputTokens: 0,
        calls: 0,
        conversation: emptyTotals(),
        videoNotes: emptyTotals()
      };
    const bucket = entry.feature === 'video-notes' ? videoNotes : conversation;
    day.inputTokens += entry.inputTokens;
    day.outputTokens += entry.outputTokens;
    day.calls += entry.calls;
    const dayBucket =
      entry.feature === 'video-notes' ? day.videoNotes! : day.conversation!;
    dayBucket.inputTokens += entry.inputTokens;
    dayBucket.outputTokens += entry.outputTokens;
    dayBucket.calls += entry.calls;
    byDate.set(entry.date, day);
    totals.inputTokens += entry.inputTokens;
    totals.outputTokens += entry.outputTokens;
    totals.calls += entry.calls;
    bucket.inputTokens += entry.inputTokens;
    bucket.outputTokens += entry.outputTokens;
    bucket.calls += entry.calls;
  }

  return {
    days: [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date)),
    totals,
    conversation,
    videoNotes,
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
