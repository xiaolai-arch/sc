import {
  FakeModelClient,
  supportsStreaming,
  type ModelRequest,
  type ModelResponse,
  type StreamingModelClient
} from '../../src/main/agent/model-client';
import { createRecordingModelClient } from '../../src/main/usage/recording-model-client';

const usage = { inputTokens: 7, outputTokens: 3 };
const response: ModelResponse = { text: 'ok', usage };
const request: ModelRequest = { messages: [{ role: 'user', content: 'hi' }] };
const meta = { provider: 'anthropic', model: 'claude-sonnet' };

test('records complete usage with provider and model metadata', async () => {
  const recorded: unknown[] = [];
  const client = createRecordingModelClient(
    new FakeModelClient([{ text: 'ok', usage }]),
    (entry) => {
      recorded.push(entry);
    },
    meta
  );

  const result = await client.complete(request);

  expect(result).toMatchObject({ text: 'ok', usage });
  expect(recorded).toEqual([{ ...meta, ...usage }]);
});

test('records stream usage only when the inner client can stream', async () => {
  const recorded: unknown[] = [];
  const inner: StreamingModelClient = {
    complete: async () => response,
    async stream(_request, onEvent) {
      onEvent({ type: 'text', text: 'ok' });
      return response;
    }
  };
  const client = createRecordingModelClient(
    inner,
    (entry) => {
      recorded.push(entry);
    },
    meta
  );

  expect(supportsStreaming(client)).toBe(true);
  const events: string[] = [];
  const result = await (client as StreamingModelClient).stream(request, (event) => {
    events.push(event.type);
  });

  expect(result).toMatchObject({ text: 'ok' });
  expect(events).toEqual(['text']);
  expect(recorded).toEqual([{ ...meta, ...usage }]);
});

test('does not expose streaming for a non-streaming client', () => {
  const client = createRecordingModelClient(
    new FakeModelClient(['ok']),
    () => undefined,
    meta
  );

  expect(supportsStreaming(client)).toBe(false);
  expect('stream' in client).toBe(false);
});

test('swallows recorder failures so model results survive', async () => {
  const throwing = createRecordingModelClient(
    new FakeModelClient([{ text: 'ok', usage }]),
    () => {
      throw new Error('disk full');
    },
    meta
  );
  const rejecting = createRecordingModelClient(
    new FakeModelClient([{ text: 'ok', usage }]),
    async () => {
      throw new Error('disk full');
    },
    meta
  );

  await expect(throwing.complete(request)).resolves.toMatchObject({ text: 'ok' });
  await expect(rejecting.complete(request)).resolves.toMatchObject({ text: 'ok' });
});
