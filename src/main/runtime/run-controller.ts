import type { ButlerToolContext } from '../butler/tools';
import type {
  EngineEvent,
  EnginePort,
  RunEvent,
  RunEventListener,
  RunEventPayload,
  RunOrigin,
  RunRequest,
  RunState,
  TerminalRunState
} from './contracts';
import { isTerminalRunState } from './contracts';
import type { ToolGateway } from './tool-gateway';
import type { RunJournal } from './run-journal';

/**
 * RunController (spec P0): drives one engine's event stream through the
 * gateway and the journal, stamps the strictly-increasing event sequence,
 * owns the six-state lifecycle and the cancel semantics. Its public surface
 * is exactly the spec's client verbs: start / subscribe / approve / cancel /
 * getRun.
 */

export interface RunControllerOptions {
  engines: Iterable<EnginePort>;
  gateway: ToolGateway;
  journal: RunJournal;
}

export interface RunStartOptions {
  /** Legacy tool context the gateway executes butler tools against. */
  butler?: ButlerToolContext;
}

export interface RunHandle {
  runId: string;
  done: Promise<TerminalRunState>;
}

export interface RunSnapshot {
  runId: string;
  state: RunState;
  seq: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

const RUN_ORIGINS: readonly RunOrigin[] = ['chat', 'morning-check', 'user-action'];

interface RunRecord {
  request: RunRequest;
  engine: EnginePort;
  controller: AbortController;
  /** Combined cancel: `cancel()` and the external `RunRequest.signal` both land here. */
  session: ReturnType<ToolGateway['createSession']>;
  state: RunState;
  seq: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  finished: boolean;
  /** seq of the last committed confirm-level tool call (completion-driver rule). */
  lastConfirmCommitSeq: number;
  /** seq of the last service receipt. */
  lastReceiptSeq: number;
  listeners: Set<RunEventListener>;
  chain: Promise<void>;
  done: Promise<TerminalRunState>;
  resolveDone: (state: TerminalRunState) => void;
  externalSignal: AbortSignal | null;
  onExternalAbort: (() => void) | null;
}

export class RunController {
  private readonly engines = new Map<string, EnginePort>();
  private readonly gateway: ToolGateway;
  private readonly journal: RunJournal;
  private readonly runs = new Map<string, RunRecord>();
  /** Subscribers that arrived before their run started; start() wires them in. */
  private readonly earlyListeners = new Map<string, Set<RunEventListener>>();

  constructor(options: RunControllerOptions) {
    for (const engine of options.engines) {
      this.engines.set(engine.id, engine);
    }
    this.gateway = options.gateway;
    this.journal = options.journal;
  }

  /** Client verb: start. Throws on contract violations (programmer errors). */
  start(request: RunRequest, options: RunStartOptions = {}): RunHandle {
    this.assertValidRequest(request);
    if (!this.engines.has(request.engineId)) {
      throw new Error(`未知引擎：${request.engineId}`);
    }
    if (this.runs.has(request.runId)) {
      throw new Error(`runId 已存在：${request.runId}`);
    }
    const engine = this.engines.get(request.engineId) as EnginePort;
    const controller = new AbortController();
    let resolveDone!: (state: TerminalRunState) => void;
    const done = new Promise<TerminalRunState>((resolve) => {
      resolveDone = resolve;
    });
    const session = this.gateway.createSession({
      runId: request.runId,
      butler: options.butler,
      budget: request.budget,
      emit: (event: EngineEvent) => this.emit(record, event)
    });
    const record: RunRecord = {
      request,
      engine,
      controller,
      session,
      state: 'running',
      seq: 0,
      startedAt: request.now().toISOString(),
      finished: false,
      lastConfirmCommitSeq: 0,
      lastReceiptSeq: 0,
      listeners: new Set<RunEventListener>(),
      chain: Promise.resolve(),
      done,
      resolveDone,
      externalSignal: request.signal ?? null,
      onExternalAbort: null
    };
    this.runs.set(request.runId, record);

    // Wire in subscribers that arrived before start; they see run.started.
    const early = this.earlyListeners.get(request.runId);
    if (early) {
      for (const listener of early) record.listeners.add(listener);
      this.earlyListeners.delete(request.runId);
    }

    if (request.signal) {
      if (request.signal.aborted) {
        void this.cancel(request.runId);
      } else {
        const onExternalAbort = (): void => {
          void this.cancel(request.runId);
        };
        record.onExternalAbort = onExternalAbort;
        request.signal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    this.emit(record, {
      type: 'run.started',
      origin: request.origin,
      engineId: request.engineId,
      workspaceIds: [...request.workspaceIds]
    });

    void engine
      .run({
        request,
        signal: controller.signal,
        butler: options.butler,
        emit: (event: EngineEvent) => this.emit(record, event),
        tools: session
      })
      .then(() => {
        // 完成必须由服务回执驱动（spec）：有已提交的写入而其后没有回执
        // → 结果待核实，而不是完成。
        const pendingVerification =
          record.lastConfirmCommitSeq > 0 && record.lastReceiptSeq < record.lastConfirmCommitSeq;
        this.finalize(record, pendingVerification ? 'pending-verification' : 'completed');
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.finalize(record, 'failed', message);
      });

    return { runId: request.runId, done };
  }

  /**
   * Client verb: subscribe. Replays journal events with `seq >= fromSeq`
   * (断线后按序号补读) exactly once each, then attaches the live listener.
   */
  subscribe(
    runId: string,
    listener: RunEventListener,
    options: { fromSeq?: number } = {}
  ): () => void {
    const fromSeq = options.fromSeq ?? 1;
    const record = this.runs.get(runId);
    const unsubscribe = (): void => {
      record?.listeners.delete(listener);
      this.earlyListeners.get(runId)?.delete(listener);
    };
    const attach = (): void => {
      // Re-check at resolution time: start() may have run while the replay
      // was reading the journal.
      const target = this.runs.get(runId);
      if (target) {
        target.listeners.add(listener);
      } else {
        let early = this.earlyListeners.get(runId);
        if (!early) {
          early = new Set<RunEventListener>();
          this.earlyListeners.set(runId, early);
        }
        early.add(listener);
      }
    };
    const replay = this.journal.readRun(runId).then((events) => {
      for (const event of events) {
        if (event.seq >= fromSeq) listener(event);
      }
      attach();
    });
    if (record) {
      // Serialize behind the emit chain: events already stamped before this
      // call arrive via replay; later ones via the live listener. No gaps, no
      // duplicates.
      record.chain = record.chain.then(() => replay).catch(() => undefined);
    }
    return unsubscribe;
  }

  /** Client verb: approve — resolves the run's oldest pending approval. */
  async approve(runId: string, decision: 'approved' | 'rejected'): Promise<boolean> {
    const record = this.runs.get(runId);
    if (!record || record.finished) return false;
    const resolved = record.session.decide(decision);
    if (resolved && decision === 'approved') record.state = 'running';
    return resolved;
  }

  /** Client verb: cancel — terminal, no further tool may execute (验收 3). */
  async cancel(runId: string): Promise<boolean> {
    const record = this.runs.get(runId);
    if (!record || record.finished) return false;
    record.controller.abort();
    record.session.abortPending();
    this.finalize(record, 'cancelled');
    return true;
  }

  /** Client verb: getRun — in-memory snapshot (journal keeps the durable trace). */
  getRun(runId: string): RunSnapshot | null {
    const record = this.runs.get(runId);
    if (!record) return null;
    return {
      runId: record.request.runId,
      state: record.state,
      seq: record.seq,
      startedAt: record.startedAt,
      ...(record.finishedAt !== undefined ? { finishedAt: record.finishedAt } : {}),
      ...(record.error !== undefined ? { error: record.error } : {})
    };
  }

  private assertValidRequest(request: RunRequest): void {
    const requireNonEmpty = (value: unknown, field: string): void => {
      if (typeof value !== 'string' || value === '') {
        throw new Error(`RunRequest.${field} 必须是非空字符串。`);
      }
    };
    requireNonEmpty(request.runId, 'runId');
    requireNonEmpty(request.sessionId, 'sessionId');
    requireNonEmpty(request.engineId, 'engineId');
    if (!RUN_ORIGINS.includes(request.origin)) {
      throw new Error(`RunRequest.origin 必须是 ${RUN_ORIGINS.join('/')} 之一。`);
    }
    if (!Array.isArray(request.workspaceIds) || request.workspaceIds.some((id) => typeof id !== 'string')) {
      throw new Error('RunRequest.workspaceIds 必须是字符串数组。');
    }
    if (typeof request.userInput !== 'string') {
      throw new Error('RunRequest.userInput 必须是字符串。');
    }
    if (typeof request.now !== 'function') {
      throw new Error('RunRequest.now 必须是统一时钟函数。');
    }
  }

  /** Stamps, journals and fans out one controller/gateway/engine event. Terminal runs drop further events. */
  private emit(record: RunRecord, payload: Exclude<RunEventPayload, { type: 'run.finished' }>): void {
    if (record.finished) return;
    record.seq += 1;
    const event: RunEvent = {
      ...payload,
      runId: record.request.runId,
      seq: record.seq,
      at: record.request.now().toISOString()
    };
    switch (payload.type) {
      case 'approval.requested':
        if (!isTerminalRunState(record.state)) record.state = 'waiting-approval';
        break;
      case 'tool.committed':
      case 'tool.failed':
        if (record.state === 'waiting-approval') record.state = 'running';
        if (
          payload.type === 'tool.committed' &&
          this.gateway.entry(payload.tool)?.level === 'confirm'
        ) {
          record.lastConfirmCommitSeq = event.seq;
        }
        break;
      case 'service.receipt':
        record.lastReceiptSeq = event.seq;
        break;
      default:
        break;
    }
    record.chain = record.chain
      .then(async () => {
        await this.journal.append(record.request.runId, event);
        for (const listener of record.listeners) listener(event);
      })
      .catch(() => undefined);
  }

  private finalize(record: RunRecord, state: TerminalRunState, error?: string): void {
    if (record.finished) return;
    record.finished = true;
    record.state = state;
    record.finishedAt = record.request.now().toISOString();
    if (error !== undefined) record.error = error;
    if (record.onExternalAbort && record.externalSignal) {
      record.externalSignal.removeEventListener('abort', record.onExternalAbort);
    }
    const event: RunEvent = {
      runId: record.request.runId,
      seq: (record.seq += 1),
      at: record.finishedAt,
      type: 'run.finished',
      state,
      ...(error !== undefined ? { error } : {})
    };
    const runId = record.request.runId;
    record.chain = record.chain
      .then(async () => {
        await this.journal.append(runId, event);
        for (const listener of record.listeners) listener(event);
      })
      .then(() => {
        this.gateway.purgeRun(runId);
        record.resolveDone(state);
      })
      .catch(() => {
        record.resolveDone(state);
      });
  }
}
