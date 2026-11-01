import {
  ModelRetryError,
  classifyModelError,
  runWithModelRetry
} from '../../src/main/agent/model-retry';

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

test('classifies abort, auth, model and transient errors', () => {
  expect(classifyModelError(abortError())).toBe('abort');
  expect(classifyModelError(new Error('401 Unauthorized'))).toBe('auth');
  expect(classifyModelError(new Error('invalid api key'))).toBe('auth');
  expect(classifyModelError(new Error('permission denied'))).toBe('auth');
  expect(classifyModelError(new Error('model not found'))).toBe('model');
  expect(classifyModelError(new Error('the model does not exist'))).toBe('model');
  expect(classifyModelError(new Error('socket hang up'))).toBe('transient');

  const controller = new AbortController();
  controller.abort();
  expect(classifyModelError(new Error('anything'), controller.signal)).toBe('abort');
});

test('returns the first successful attempt', async () => {
  let calls = 0;
  const result = await runWithModelRetry(async () => {
    calls += 1;
    return 'ok';
  });

  expect(result).toEqual({ value: 'ok', attempts: 1 });
  expect(calls).toBe(1);
});

test('retries a transient failure once', async () => {
  let calls = 0;
  const retries: number[] = [];
  const result = await runWithModelRetry(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error('socket hang up');
      return 'ok';
    },
    { delayMs: 0, onRetry: ({ attempt }) => retries.push(attempt) }
  );

  expect(result).toEqual({ value: 'ok', attempts: 2 });
  expect(calls).toBe(2);
  expect(retries).toEqual([1]);
});

test('does not retry auth, model or abort errors', async () => {
  for (const [error, kind] of [
    [new Error('401 Unauthorized'), 'auth'],
    [new Error('model not found'), 'model']
  ] as const) {
    let calls = 0;
    await expect(
      runWithModelRetry(
        async () => {
          calls += 1;
          throw error;
        },
        { delayMs: 0 }
      )
    ).rejects.toMatchObject({ name: 'ModelRetryError', kind, attempts: 1 });
    expect(calls).toBe(1);
  }

  // Abort stays a plain AbortError so the butler's stop path keeps working.
  let calls = 0;
  await expect(
    runWithModelRetry(
      async () => {
        calls += 1;
        throw abortError();
      },
      { delayMs: 0 }
    )
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls).toBe(1);
});

test('throws after the configured attempts with the attempt count', async () => {
  let calls = 0;
  await expect(
    runWithModelRetry(
      async () => {
        calls += 1;
        throw new Error('timeout');
      },
      { attempts: 3, delayMs: 0 }
    )
  ).rejects.toMatchObject({ name: 'ModelRetryError', kind: 'transient', attempts: 3 });

  expect(calls).toBe(3);
  await expect(
    runWithModelRetry(
      async () => {
        throw new Error('timeout');
      },
      { attempts: 1, delayMs: 0 }
    )
  ).rejects.toMatchObject({ attempts: 1 });
});

test('aborting during the delay rejects without waiting', async () => {
  const controller = new AbortController();
  let calls = 0;
  const promise = runWithModelRetry(
    async () => {
      calls += 1;
      throw new Error('socket hang up');
    },
    { delayMs: 10_000, signal: controller.signal }
  );
  setTimeout(() => controller.abort(), 0);

  await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls).toBe(1);
  expect(ModelRetryError).toBeDefined();
});
