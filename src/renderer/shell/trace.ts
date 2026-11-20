import type { ChatStep, ChatTraceItem } from './types';

/** Persisted tool steps survive restarts; reasoning is session-only. */
export function stepsToTrace(steps: ChatStep[] | undefined): ChatTraceItem[] {
  return (steps ?? []).map((step) => ({
    kind: 'tool',
    id: step.id,
    name: step.name,
    label: step.label,
    status: step.status,
    ...(step.detail ? { detail: step.detail } : {})
  }));
}

/** What the work-process header may count; every number comes from real rows. */
export type ChatTraceCounts = {
  references: number;
  done: number;
  failed: number;
};

export function summarizeTrace(
  items: ChatTraceItem[],
  referencesCount = 0
): ChatTraceCounts {
  let done = 0;
  let failed = 0;
  for (const item of items) {
    if (item.kind !== 'tool') continue;
    if (item.status === 'done') done += 1;
    else if (item.status === 'failed') failed += 1;
  }
  return { references: Math.max(0, referencesCount), done, failed };
}

/**
 * Compact one-liner for the header, e.g. `参考 3 项 · 完成 2 项操作`. Empty
 * parts are omitted, so a turn that did nothing renders no invented labels.
 */
export function traceCountLabel(counts: ChatTraceCounts): string {
  const parts: string[] = [];
  if (counts.references > 0) parts.push(`参考 ${counts.references} 项`);
  if (counts.done > 0) parts.push(`完成 ${counts.done} 项操作`);
  if (counts.failed > 0) parts.push(`失败 ${counts.failed} 项`);
  return parts.join(' · ');
}

export type ChatResultKind = 'plan' | 'task' | 'profile';

export type ChatResultLink = {
  kind: ChatResultKind;
  label: string;
};

/** At most one link per kind; the brief caps the row at three. */
export const MAX_RESULT_LINKS = 3;

const RESULT_LINK_TOOLS: Record<string, ChatResultLink> = {
  create_long_plan: { kind: 'plan', label: '查看长期计划' },
  create_task: { kind: 'task', label: '查看今日任务' },
  save_profile: { kind: 'profile', label: '查看新增记忆' }
};

/**
 * Entry points below the answer, derived from this turn's successful tool
 * results — never from the wording of the reply. A failed or missing tool
 * result produces no link.
 */
export function resultLinksFromTrace(items: ChatTraceItem[] | undefined): ChatResultLink[] {
  const links: ChatResultLink[] = [];
  const seen = new Set<ChatResultKind>();
  for (const item of items ?? []) {
    if (item.kind !== 'tool' || item.status !== 'done') continue;
    const link = RESULT_LINK_TOOLS[item.name];
    if (!link || seen.has(link.kind)) continue;
    seen.add(link.kind);
    links.push(link);
    if (links.length >= MAX_RESULT_LINKS) break;
  }
  return links;
}
