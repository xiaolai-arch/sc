import type { ButlerStreamEvent } from '../../shared/butler-stream';
import type {
  ConversationRunSnapshot,
  ConversationRunStatus
} from '../../shared/butler-run';
import type { ConversationStep } from '../../shared/conversations';
import { readFileOrNull, writeFileAtomic } from '../workspace/fs-utils';

const FILE_VERSION = 1;
const MAX_STEPS = 300;
const PERSIST_DELAY_MS = 200;

export const RUN_INTERRUPTED_MESSAGE = '应用已退出，本次生成中断。';

type PersistedFile = {
  version: number;
  runs: ConversationRunSnapshot[];
};

type RunRecord = ConversationRunSnapshot & {
  controller?: AbortController;
};

type StoreOptions = {
  /** Absolute path of `conversation-runs.json`; null keeps the store in memory. */
  filePath?: string | null;
  now?: () => Date;
  /** Injectable for tests; defaults to a 200ms trailing write. */
  persistDelayMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeSteps(value: unknown): ConversationStep[] {
  if (!Array.isArray(value)) return [];
  const steps: ConversationStep[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const id = optionalString(entry['id']);
    const name = optionalString(entry['name']);
    const label = optionalString(entry['label']);
    const rawStatus = entry['status'];
    if (!id || !name || !label) continue;
    if (rawStatus !== 'running' && rawStatus !== 'done' && rawStatus !== 'failed') continue;
    steps.push({
      id,
      name,
      label,
      status: rawStatus,
      ...(optionalString(entry['detail']) !== undefined
        ? { detail: optionalString(entry['detail']) as string }
        : {})
    });
  }
  return steps.slice(-MAX_STEPS);
}

function normalizeRun(value: unknown): ConversationRunSnapshot | null {
  if (!isRecord(value)) return null;
  const runId = optionalString(value['runId']);
  const conversationId = optionalString(value['conversationId']);
  const assistantMessageId = optionalString(value['assistantMessageId']);
  const status = value['status'];
  const startedAt = optionalString(value['startedAt']);
  const lastActivityAt = optionalString(value['lastActivityAt']);
  if (
    !runId ||
    !conversationId ||
    !assistantMessageId ||
    !startedAt ||
    !lastActivityAt ||
    typeof status !== 'string'
  ) {
    return null;
  }
  const allowed: readonly ConversationRunStatus[] = [
    'starting',
    'running',
    'waiting',
    'completed',
    'cancelled',
    'failed',
    'interrupted'
  ];
  if (!allowed.includes(status as ConversationRunStatus)) return null;
  return {
    runId,
    conversationId,
    assistantMessageId,
    status: status as ConversationRunStatus,
    sequence: typeof value['sequence'] === 'number' ? value['sequence'] : 0,
    partialText: typeof value['partialText'] === 'string' ? value['partialText'] : '',
    reasoningText: typeof value['reasoningText'] === 'string' ? value['reasoningText'] : '',
    steps: normalizeSteps(value['steps']),
    startedAt,
    lastActivityAt,
    ...(optionalString(value['statusMessage']) !== undefined
      ? { statusMessage: optionalString(value['statusMessage']) as string }
      : {}),
    ...(optionalString(value['errorReason']) !== undefined
      ? { errorReason: optionalString(value['errorReason']) as string }
      : {})
  };
}

function isActiveStatus(status: ConversationRunStatus): boolean {
  return status === 'starting' || status === 'running' || status === 'waiting';
}

/**
 * Main-process registry of butler turns. A turn is identified by the
 * renderer-supplied assistant message id, so the renderer can name a run
 * before the main process has seen its first event. Active runs are persisted
 * (debounced); on the next launch any run that was still active is reported as
 * `interrupted` with its partial text and public steps intact.
 */
export class ConversationRunStore {
  private readonly runs = new Map<string, RunRecord>();
  private readonly filePath: string | null;
  private readonly now: () => Date;
  private readonly persistDelayMs: number;
  private loaded: Promise<void> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTail: Promise<void> = Promise.resolve();

  constructor(options: StoreOptions = {}) {
    this.filePath = options.filePath ?? null;
    this.now = options.now ?? (() => new Date());
    this.persistDelayMs = options.persistDelayMs ?? PERSIST_DELAY_MS;
  }

  /** Loads persisted runs; active ones become explicitly interrupted. */
  private ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      this.loaded = this.load();
    }
    return this.loaded;
  }

  private async load(): Promise<void> {
    if (!this.filePath) return;
    let raw: string | null = null;
    try {
      raw = await readFileOrNull(this.filePath);
    } catch {
      return;
    }
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    if (!isRecord(parsed) || parsed['version'] !== FILE_VERSION) return;
    const runs = Array.isArray(parsed['runs']) ? parsed['runs'] : [];
    const timestamp = this.now().toISOString();
    let changed = false;
    for (const value of runs) {
      const snapshot = normalizeRun(value);
      if (!snapshot) continue;
      if (isActiveStatus(snapshot.status)) {
        snapshot.status = 'interrupted';
        snapshot.errorReason = RUN_INTERRUPTED_MESSAGE;
        snapshot.lastActivityAt = snapshot.lastActivityAt || timestamp;
        changed = true;
      }
      this.runs.set(snapshot.runId, snapshot);
    }
    if (changed) {
      await this.persistNow();
    }
  }

  /** Starts a run and returns the controller used to cancel it. */
  async begin(input: {
    runId: string;
    conversationId: string;
    assistantMessageId: string;
  }): Promise<AbortController> {
    await this.ensureLoaded();
    const timestamp = this.now().toISOString();
    // A new turn supersedes interrupted leftovers of the same conversation.
    for (const [runId, run] of this.runs) {
      if (run.conversationId === input.conversationId && run.status === 'interrupted') {
        this.runs.delete(runId);
      }
    }
    const controller = new AbortController();
    // The renderer names runs by assistant message id; if that id is reused
    // (retry, regenerate), abort the old controller instead of orphaning it.
    this.runs.get(input.runId)?.controller?.abort();
    this.runs.set(input.runId, {
      runId: input.runId,
      conversationId: input.conversationId,
      assistantMessageId: input.assistantMessageId,
      status: 'starting',
      sequence: 0,
      partialText: '',
      reasoningText: '',
      steps: [],
      startedAt: timestamp,
      lastActivityAt: timestamp,
      controller
    });
    await this.persistNow();
    return controller;
  }

  /** Applies one stream event to the run and bumps its activity clock. */
  update(runId: string, event: ButlerStreamEvent): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.sequence += 1;
    run.lastActivityAt = this.now().toISOString();
    if (run.status === 'starting') run.status = 'running';

    switch (event.type) {
      case 'reasoning':
        run.reasoningText += event.text;
        break;
      case 'narration':
        run.reasoningText =
          run.reasoningText.length > 0 ? `${run.reasoningText}\n\n${event.text}` : event.text;
        break;
      case 'text':
        run.partialText += event.text;
        break;
      case 'tool-start': {
        const existing = run.steps.find((step) => step.id === event.id);
        if (existing) {
          existing.status = 'running';
          existing.label = event.label;
        } else {
          run.steps.push({
            id: event.id,
            name: event.name,
            label: event.label,
            status: 'running'
          });
          if (run.steps.length > MAX_STEPS) run.steps = run.steps.slice(-MAX_STEPS);
        }
        break;
      }
      case 'tool-result': {
        const step = run.steps.find((entry) => entry.id === event.id);
        if (step) {
          step.status = event.ok ? 'done' : 'failed';
          if (event.detail !== undefined) step.detail = event.detail;
        }
        break;
      }
      case 'retry':
        run.statusMessage = event.message;
        break;
      case 'error':
        run.errorReason = event.message;
        break;
      case 'done':
        run.status = event.canceled === true ? 'cancelled' : 'completed';
        if (event.text.trim()) run.partialText = event.text;
        delete run.statusMessage;
        break;
      default:
        break;
    }
    this.schedulePersist();
  }

  /** Marks a run failed and removes it from the store. */
  async fail(runId: string, errorReason: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = 'failed';
    run.errorReason = errorReason;
    this.runs.delete(runId);
    await this.persistNow();
  }

  /** Ends a run; terminal runs are no longer reported. */
  async finish(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) return;
    if (isActiveStatus(run.status)) run.status = 'completed';
    this.runs.delete(runId);
    await this.persistNow();
  }

  /** Aborts the run's controller; the buffered partial text is kept. */
  async cancel(runId: string): Promise<boolean> {
    await this.ensureLoaded();
    const run = this.runs.get(runId);
    if (!run) return false;
    // Only an active run can be "stopping": marking an interrupted leftover as
    // waiting would make it look live again after a restart.
    if (isActiveStatus(run.status)) run.status = 'waiting';
    run.controller?.abort();
    return true;
  }

  /** Currently running and previously interrupted runs. */
  async list(): Promise<ConversationRunSnapshot[]> {
    await this.ensureLoaded();
    return [...this.runs.values()].map((run) => {
      const { controller: _controller, ...snapshot } = run;
      return {
        ...snapshot,
        steps: snapshot.steps.map((step) => ({ ...step }))
      };
    });
  }

  async get(runId: string): Promise<ConversationRunSnapshot | null> {
    const list = await this.list();
    return list.find((run) => run.runId === runId) ?? null;
  }

  /** Removes an interrupted run the user has acknowledged. */
  async dismiss(runId: string): Promise<void> {
    await this.ensureLoaded();
    if (this.runs.delete(runId)) {
      await this.persistNow();
    }
  }

  /** Drops every leftover run of a conversation, e.g. when it is deleted. */
  async dismissConversation(conversationId: string): Promise<void> {
    await this.ensureLoaded();
    let changed = false;
    for (const [runId, run] of this.runs) {
      if (run.conversationId !== conversationId) continue;
      run.controller?.abort();
      this.runs.delete(runId);
      changed = true;
    }
    if (changed) await this.persistNow();
  }

  /** Flushes a scheduled write (also used by tests and app shutdown). */
  async flush(): Promise<void> {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    await this.persistNow();
  }

  private schedulePersist(): void {
    if (!this.filePath || this.persistTimer !== null) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persistNow();
    }, this.persistDelayMs);
    this.persistTimer.unref?.();
  }

  private async persistNow(): Promise<void> {
    if (!this.filePath) return;
    const active = [...this.runs.values()].filter((run) =>
      isActiveStatus(run.status) || run.status === 'interrupted'
    );
    const payload: PersistedFile = {
      version: FILE_VERSION,
      runs: active.map((run) => {
        const { controller: _controller, ...snapshot } = run;
        return { ...snapshot, steps: snapshot.steps.map((step) => ({ ...step })) };
      })
    };
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    const filePath = this.filePath;
    this.persistTail = this.persistTail
      .catch(() => undefined)
      .then(() => writeFileAtomic(filePath, serialized))
      .catch(() => undefined);
    await this.persistTail;
  }
}
