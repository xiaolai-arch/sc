export type ModelErrorKind = 'abort' | 'auth' | 'model' | 'transient';

const AUTH_PATTERN =
  /401|403|unauthorized|invalid api key|authentication|permission denied|forbidden/i;
const MODEL_PATTERN =
  /model not found|invalid model|unknown model|does not exist|no such model|not a valid model/i;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

/** Carries how many attempts were made so callers can explain retries. */
export class ModelRetryError extends Error {
  readonly attempts: number;
  readonly kind: ModelErrorKind;
  readonly cause?: unknown;

  constructor(message: string, attempts: number, kind: ModelErrorKind, cause?: unknown) {
    super(message);
    this.name = 'ModelRetryError';
    this.attempts = attempts;
    this.kind = kind;
    this.cause = cause;
  }
}

export function classifyModelError(error: unknown, signal?: AbortSignal): ModelErrorKind {
  if (signal?.aborted) return 'abort';
  if (error instanceof ModelRetryError) return error.kind;
  if (error instanceof Error && error.name === 'AbortError') return 'abort';
  const message = messageOf(error);
  if (AUTH_PATTERN.test(message)) return 'auth';
  if (MODEL_PATTERN.test(message)) return 'model';
  return 'transient';
}

export interface ModelRetryOptions {
  /** Total attempts, including the first call. Defaults to 2. */
  attempts?: number;
  /** Delay before a retry; 0 disables waiting. Defaults to 300ms. */
  delayMs?: number;
  signal?: AbortSignal;
  onRetry?: (info: { attempt: number; error: unknown }) => void;
  /** Return false to stop retrying, e.g. once streamed text was emitted. */
  shouldRetry?: (error: unknown) => boolean;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    (timer as { unref?: () => void }).unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs a model call, retrying only transient failures. Auth, model-name and
 * abort errors fail fast; the thrown error records the attempt count.
 */
export async function runWithModelRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: ModelRetryOptions = {}
): Promise<{ value: T; attempts: number }> {
  const maxAttempts = Math.max(1, Math.trunc(options.attempts ?? 2));
  const delayMs = Math.max(0, options.delayMs ?? 300);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) throw abortError();
    try {
      const value = await operation(attempt);
      return { value, attempts: attempt };
    } catch (error) {
      lastError = error;
      const kind = classifyModelError(error, options.signal);
      if (kind === 'abort') throw abortError();

      const canRetry =
        kind === 'transient' &&
        attempt < maxAttempts &&
        (options.shouldRetry ? options.shouldRetry(error) : true);
      if (!canRetry) {
        throw new ModelRetryError(messageOf(error), attempt, kind, error);
      }

      options.onRetry?.({ attempt, error });
      if (delayMs > 0) {
        await delay(delayMs, options.signal);
      } else if (options.signal?.aborted) {
        throw abortError();
      }
    }
  }

  throw new ModelRetryError(messageOf(lastError), maxAttempts, 'transient', lastError);
}
