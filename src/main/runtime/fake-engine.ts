import type { EngineEvent, EnginePort, RunContext } from './contracts';

/**
 * FakeEngine (spec「引擎适配器」): a scripted engine for tests — stably
 * produces failures, cancellations, duplicate calls, and replayable event
 * sequences without any model. Steps run strictly in order inside
 * `EnginePort.run`.
 */

export type FakeStep =
  | { type: 'emit'; event: EngineEvent }
  | { type: 'tool'; name: string; args?: Record<string, unknown> }
  /** Parks until the test calls `openGate(name)` — builds deterministic races. */
  | { type: 'gate'; name: string }
  | { type: 'wait'; ms: number }
  /** Emits `service.receipt` (the completion driver). */
  | { type: 'receipt'; detail?: string }
  /** Ends `run()` with a thrown error → run fails. */
  | { type: 'fail'; message: string }
  | { type: 'custom'; run: (context: RunContext) => Promise<void> };

export interface FakeInvocationRecord {
  name: string;
  args: Record<string, unknown>;
  outcome: { ok: boolean; result?: unknown; error?: string; reason?: string; invocationId?: string };
}

export class FakeEngine implements EnginePort {
  readonly id: string;
  private readonly steps: FakeStep[];
  private readonly gates = new Map<string, Promise<void>>();
  private readonly gateOpeners = new Map<string, () => void>();
  private readonly openGateNames = new Set<string>();
  /** Every gateway invoke this engine made, in order — assertions read this. */
  readonly invocations: FakeInvocationRecord[] = [];

  constructor(options: { id?: string; steps: FakeStep[] }) {
    this.id = options.id ?? 'fake';
    this.steps = options.steps;
  }

  async run(context: RunContext): Promise<void> {
    for (const step of this.steps) {
      switch (step.type) {
        case 'emit':
          context.emit(step.event);
          break;
        case 'tool': {
          const outcome = await context.tools.invoke(step.name, step.args ?? {});
          this.invocations.push({
            name: step.name,
            args: step.args ?? {},
            outcome: {
              ok: outcome.ok,
              ...(outcome.result !== undefined ? { result: outcome.result } : {}),
              ...(outcome.error !== undefined ? { error: outcome.error } : {}),
              ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
              ...(outcome.invocationId !== undefined
                ? { invocationId: outcome.invocationId }
                : {})
            }
          });
          break;
        }
        case 'gate':
          await this.gatePromise(step.name);
          break;
        case 'wait':
          await new Promise<void>((resolve) => setTimeout(resolve, step.ms));
          break;
        case 'receipt':
          context.emit({ type: 'service.receipt', ...(step.detail ? { detail: step.detail } : {}) });
          break;
        case 'fail':
          throw new Error(step.message);
        case 'custom':
          await step.run(context);
          break;
      }
    }
  }

  /** Idempotently opens a gate parked on by a `gate` step (level-triggered: pre-opened gates pass). */
  openGate(name: string): void {
    this.openGateNames.add(name);
    const opener = this.gateOpeners.get(name);
    if (opener) {
      this.gateOpeners.delete(name);
      opener();
    }
  }

  private gatePromise(name: string): Promise<void> {
    if (this.openGateNames.has(name)) return Promise.resolve();
    const existing = this.gates.get(name);
    if (existing) return existing;
    const promise = new Promise<void>((resolve) => {
      this.gateOpeners.set(name, resolve);
    });
    this.gates.set(name, promise);
    return promise;
  }
}
