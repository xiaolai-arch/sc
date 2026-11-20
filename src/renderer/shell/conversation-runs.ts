import { useSyncExternalStore } from 'react';
import type { ButlerReference, ButlerStreamEvent } from '../../shared/butler-stream';
import type { ConversationRunSnapshot } from '../../shared/butler-run';
import type { StudyCoachApi } from '../../shared/ipc';
import type { ChatMessage, ChatTraceItem } from './types';

/**
 * Renderer-side mirror of a conversation run.
 *
 * The main process owns the lifecycle (see `main/butler/conversation-runs.ts`);
 * this store only keeps what the UI needs to draw the answer while it streams.
 * It lives at module scope on purpose: navigating between pages or
 * conversations must not drop the partial answer, because the run itself keeps
 * going in the main process.
 */
export type ConversationRunPhase =
  | 'running'
  | 'stopping'
  | 'settling'
  | 'completed'
  | 'failed'
  | 'interrupted';

export type ConversationRun = {
  runId: string;
  conversationId: string;
  assistantMessageId: string;
  phase: ConversationRunPhase;
  text: string;
  trace: ChatTraceItem[];
  /** Records this answer drew on, mirrored from the `references` event. */
  references: ButlerReference[];
  statusMessage: string | null;
  errorReason: string | null;
  canceled: boolean;
  /** The prompt that produced this answer; kept for the retry banner. */
  userText: string;
  startedAt: number;
  updatedAt: number;
};

export type ConversationRunsState = {
  version: number;
  runs: ConversationRun[];
};

export type ConversationRunStatus = 'running' | 'interrupted' | 'failed' | 'completed';

/**
 * Phases whose answer is not persisted yet, so the UI draws it directly.
 * `failed` is included on purpose: whatever the turn produced before it broke
 * is still the only copy, and dropping it would leave just an error banner.
 */
const LIVE_PHASES: ReadonlySet<ConversationRunPhase> = new Set([
  'running',
  'stopping',
  'settling',
  'interrupted',
  'failed'
]);

const ACTIVE_PHASES: ReadonlySet<ConversationRunPhase> = new Set([
  'running',
  'stopping',
  'settling'
]);

export function isLiveRun(run: ConversationRun): boolean {
  return LIVE_PHASES.has(run.phase);
}

export function isActiveRun(run: ConversationRun): boolean {
  return ACTIVE_PHASES.has(run.phase);
}

export function runStatus(run: ConversationRun): ConversationRunStatus {
  if (run.phase === 'completed') return 'completed';
  if (run.phase === 'failed') return 'failed';
  if (run.phase === 'interrupted') return 'interrupted';
  return 'running';
}

function settleReasoning(trace: ChatTraceItem[], now: number): ChatTraceItem[] {
  let changed = false;
  const next = trace.map((item) => {
    if (item.kind === 'reasoning' && item.streaming) {
      changed = true;
      return { ...item, streaming: false, endedAt: item.endedAt ?? now };
    }
    return item;
  });
  return changed ? next : trace;
}

function settleTrace(trace: ChatTraceItem[], now: number): ChatTraceItem[] {
  return trace.map((item) => {
    if (item.kind === 'reasoning') {
      return item.streaming
        ? { ...item, streaming: false, endedAt: item.endedAt ?? now }
        : item;
    }
    return item.status === 'running' ? { ...item, status: 'failed' as const } : item;
  });
}

function appendReasoning(
  trace: ChatTraceItem[],
  runId: string,
  chunk: string,
  now: number
): ChatTraceItem[] {
  const last = trace[trace.length - 1];
  // A reasoning block that ended before the answer started is closed: a later
  // thinking phase is a new block, not a reopening of the old one.
  if (last && last.kind === 'reasoning' && last.endedAt === undefined) {
    return [
      ...trace.slice(0, -1),
      { ...last, text: `${last.text}${chunk}`, streaming: true }
    ];
  }
  const count = trace.filter((item) => item.kind === 'reasoning').length;
  return [
    ...trace,
    {
      kind: 'reasoning',
      id: `trace-${runId}-${count + 1}`,
      text: chunk,
      streaming: true,
      startedAt: now
    }
  ];
}

function appendNarration(
  trace: ChatTraceItem[],
  runId: string,
  text: string,
  now: number
): ChatTraceItem[] {
  const last = trace[trace.length - 1];
  if (!last || last.kind !== 'reasoning' || last.endedAt !== undefined) {
    return appendReasoning(trace, runId, text, now);
  }
  const separator = last.text ? '\n\n' : '';
  return [
    ...trace.slice(0, -1),
    { ...last, text: `${last.text}${separator}${text}`, streaming: true }
  ];
}

/**
 * Applies one stream event to a run. Pure so the ordering rules are easy to
 * test: reasoning rows only appear when the model actually sends them, and
 * narration stays inside the trace instead of leaking into the answer.
 */
export function applyRunEvent(
  run: ConversationRun,
  event: ButlerStreamEvent
): ConversationRun {
  const updatedAt = Date.now();
  switch (event.type) {
    case 'references':
      return { ...run, references: event.items, updatedAt };
    case 'retry':
      return { ...run, statusMessage: event.message, updatedAt };
    case 'reasoning':
      return {
        ...run,
        trace: appendReasoning(run.trace, run.runId, event.text, updatedAt),
        statusMessage: null,
        updatedAt
      };
    case 'narration':
      return {
        ...run,
        trace: appendNarration(run.trace, run.runId, event.text, updatedAt),
        statusMessage: null,
        updatedAt
      };
    case 'text':
      return {
        ...run,
        trace: settleReasoning(run.trace, updatedAt),
        text: `${run.text}${event.text}`,
        statusMessage: null,
        updatedAt
      };
    case 'tool-start':
      return {
        ...run,
        trace: [
          ...settleReasoning(run.trace, updatedAt),
          {
            kind: 'tool',
            id: event.id,
            name: event.name,
            label: event.label,
            status: 'running'
          }
        ],
        updatedAt
      };
    case 'tool-result':
      return {
        ...run,
        trace: run.trace.map((item) =>
          item.kind === 'tool' && item.id === event.id
            ? {
                ...item,
                status: event.ok ? 'done' : 'failed',
                ...(event.detail !== undefined ? { detail: event.detail } : {})
              }
            : item
        ),
        updatedAt
      };
    case 'error':
      return {
        ...run,
        trace: settleTrace(run.trace, updatedAt),
        statusMessage: null,
        errorReason: event.message,
        updatedAt
      };
    case 'done': {
      const text = event.text || run.text;
      return {
        ...run,
        phase: 'settling',
        trace: settleTrace(run.trace, updatedAt),
        text,
        statusMessage: null,
        canceled: Boolean(event.canceled),
        updatedAt
      };
    }
    default:
      return run;
  }
}

function runFromSnapshot(snapshot: ConversationRunSnapshot): ConversationRun | null {
  if (snapshot.status === 'completed') return null;
  const startedAt = Date.parse(snapshot.startedAt);
  const updatedAt = Date.parse(snapshot.lastActivityAt);
  const trace: ChatTraceItem[] = [];
  if (snapshot.reasoningText.trim()) {
    trace.push({
      kind: 'reasoning',
      id: `trace-${snapshot.runId}-1`,
      text: snapshot.reasoningText,
      streaming: false,
      ...(Number.isFinite(startedAt) ? { startedAt } : {}),
      ...(Number.isFinite(updatedAt) ? { endedAt: updatedAt } : {})
    });
  }
  for (const step of snapshot.steps) {
    trace.push({
      kind: 'tool',
      id: step.id,
      name: step.name,
      label: step.label,
      status: step.status,
      ...(step.detail ? { detail: step.detail } : {})
    });
  }
  return {
    runId: snapshot.runId,
    conversationId: snapshot.conversationId,
    assistantMessageId: snapshot.assistantMessageId,
    // A run restored from disk is never live: the process that streamed it is
    // gone, so showing it as "running" would be a lie and would leave a Stop
    // button pointing at nothing.
    phase: snapshot.status === 'failed' ? 'failed' : 'interrupted',
    text: snapshot.partialText,
    trace,
    references: [],
    statusMessage: null,
    errorReason: snapshot.errorReason ?? '应用已退出，本次生成中断。',
    canceled: snapshot.status === 'cancelled',
    userText: '',
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  };
}

export type RunEventListener = (event: ButlerStreamEvent, run: ConversationRun) => void;

type RunApi = Pick<StudyCoachApi, 'cancelStream'> &
  Partial<Pick<StudyCoachApi, 'cancelRun' | 'listConversationRuns'>>;

function bridgeApi(): RunApi | null {
  return (window.studyCoach as RunApi | undefined) ?? null;
}

export type StartRunInput = {
  runId: string;
  conversationId: string;
  assistantMessageId?: string;
  userText?: string;
};

/**
 * Module-level registry of the turns this renderer is watching. Navigation
 * never removes a run; only the main process finishing it does.
 */
export class ConversationRunStore {
  private runs = new Map<string, ConversationRun>();
  private state: ConversationRunsState = { version: 0, runs: [] };
  private listeners = new Set<() => void>();
  private eventListeners = new Set<RunEventListener>();
  private notifyTimer: ReturnType<typeof setTimeout> | number | null = null;

  getSnapshot = (): ConversationRunsState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Side effects (knowledge refresh, error banner) listen here, not to state. */
  subscribeEvents(listener: RunEventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  list(): ConversationRun[] {
    return this.state.runs;
  }

  get(runId: string): ConversationRun | null {
    return this.runs.get(runId) ?? null;
  }

  getForConversation(conversationId: string): ConversationRun | null {
    let found: ConversationRun | null = null;
    for (const run of this.runs.values()) {
      if (run.conversationId !== conversationId) continue;
      if (!found || run.startedAt >= found.startedAt) found = run;
    }
    return found;
  }

  /** True while a turn in this conversation still owns the composer. */
  hasActive(conversationId: string): boolean {
    const run = this.getForConversation(conversationId);
    return run !== null && isActiveRun(run);
  }

  start(input: StartRunInput): ConversationRun {
    // One turn per conversation: the previous answer (or an interrupted
    // leftover) is already persisted, so the new run replaces it in the UI.
    for (const [id, run] of this.runs) {
      if (run.conversationId === input.conversationId && !isActiveRun(run)) {
        this.runs.delete(id);
      }
    }
    const now = Date.now();
    const run: ConversationRun = {
      runId: input.runId,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId ?? input.runId,
      phase: 'running',
      text: '',
      trace: [
        {
          kind: 'reasoning',
          id: `trace-${input.runId}-pending`,
          text: '',
          streaming: true,
          startedAt: now
        }
      ],
      references: [],
      statusMessage: null,
      errorReason: null,
      canceled: false,
      userText: input.userText ?? '',
      startedAt: now,
      updatedAt: now
    };
    this.runs.set(run.runId, run);
    this.publish();
    return run;
  }

  applyEvent(runId: string, event: ButlerStreamEvent): void {
    const run = this.runs.get(runId);
    if (!run) return;
    const next = applyRunEvent(run, event);
    this.runs.set(runId, next);
    for (const listener of this.eventListeners) listener(event, next);
    this.scheduleNotify();
  }

  /** Marks the run as done but keeps its text until the reload lands. */
  complete(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    const now = Date.now();
    this.runs.set(runId, {
      ...run,
      phase: 'completed',
      trace: settleTrace(run.trace, now),
      statusMessage: null,
      updatedAt: now
    });
    this.publish();
  }

  fail(runId: string, reason: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.runs.set(runId, {
      ...run,
      phase: 'failed',
      trace: settleTrace(run.trace, Date.now()),
      errorReason: reason,
      statusMessage: null,
      updatedAt: Date.now()
    });
    this.publish();
  }

  remove(runId: string): void {
    if (!this.runs.delete(runId)) return;
    this.publish();
  }

  /** Drops settled markers, e.g. once the user has read the conversation. */
  clearSettled(conversationId: string): void {
    let changed = false;
    for (const [id, run] of this.runs) {
      if (
        run.conversationId === conversationId &&
        (run.phase === 'completed' || run.phase === 'failed')
      ) {
        this.runs.delete(id);
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  clearConversation(conversationId: string): void {
    let changed = false;
    for (const [id, run] of this.runs) {
      if (run.conversationId === conversationId) {
        this.runs.delete(id);
        changed = true;
      }
    }
    if (changed) this.publish();
  }

  reset(): void {
    this.runs.clear();
    this.publish();
  }

  /**
   * Stops one run. The main process aborts it and persists whatever text it
   * already produced; other conversations keep generating.
   */
  async cancel(runId: string): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run || run.phase !== 'running') return false;
    this.runs.set(runId, { ...run, phase: 'stopping', updatedAt: Date.now() });
    this.publish();
    const api = bridgeApi();
    try {
      if (api && typeof api.cancelRun === 'function') {
        await api.cancelRun(runId);
      } else if (api) {
        // Browser prototype: cancellation is still keyed by message id.
        await api.cancelStream(run.assistantMessageId);
      }
    } catch {
      // The stream itself will report a real failure; stopping is best-effort.
    }
    return true;
  }

  /** Restores runs the main process saved, so a restart never looks live. */
  async hydrate(api: RunApi | null = bridgeApi()): Promise<void> {
    if (!api || typeof api.listConversationRuns !== 'function') return;
    let snapshots: ConversationRunSnapshot[];
    try {
      snapshots = await api.listConversationRuns();
    } catch {
      return;
    }
    let changed = false;
    for (const snapshot of snapshots) {
      if (this.runs.has(snapshot.runId)) continue;
      const existing = this.getForConversation(snapshot.conversationId);
      if (existing && isActiveRun(existing)) continue;
      const run = runFromSnapshot(snapshot);
      if (!run) continue;
      if (existing) this.runs.delete(existing.runId);
      this.runs.set(run.runId, run);
      changed = true;
    }
    if (changed) this.publish();
  }

  private scheduleNotify(): void {
    if (this.notifyTimer !== null) return;
    const flush = () => {
      this.notifyTimer = null;
      this.publish();
    };
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      this.notifyTimer = window.requestAnimationFrame(flush);
    } else {
      this.notifyTimer = setTimeout(flush, 16);
    }
  }

  /** Publishes pending changes immediately (tests and teardown paths). */
  flush(): void {
    if (this.notifyTimer === null) return;
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(this.notifyTimer as number);
    } else {
      clearTimeout(this.notifyTimer as ReturnType<typeof setTimeout>);
    }
    this.notifyTimer = null;
    this.publish();
  }

  private publish(): void {
    const runs = [...this.runs.values()].sort((a, b) => a.startedAt - b.startedAt);
    this.state = { version: this.state.version + 1, runs };
    for (const listener of this.listeners) listener();
  }
}

/** The app-wide instance; navigation keeps it alive. */
export const conversationRuns = new ConversationRunStore();

export function useConversationRuns(): ConversationRunsState {
  return useSyncExternalStore(conversationRuns.subscribe, conversationRuns.getSnapshot);
}

/** Turns a live run into the chat bubble the pane renders. */
export function runToChatMessage(run: ConversationRun): ChatMessage {
  const notice =
    run.phase === 'interrupted'
      ? (run.errorReason ?? '应用已退出，本次生成中断。')
      : run.phase === 'failed'
        ? (run.errorReason ?? '生成失败。')
        : null;
  return {
    id: run.assistantMessageId,
    role: 'assistant',
    text: run.text,
    trace: run.trace.map((item) => ({ ...item })),
    ...(run.references.length > 0 ? { references: run.references } : {}),
    startedAt: run.startedAt,
    streaming: isActiveRun(run),
    ...(notice !== null ? { notice } : {})
  };
}
