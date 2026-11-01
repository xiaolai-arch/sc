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
