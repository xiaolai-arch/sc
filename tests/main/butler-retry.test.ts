import {
  FakeModelClient,
  type ModelClient,
  type StreamingModelClient
} from '../../src/main/agent/model-client';
import { ButlerServiceImpl } from '../../src/main/butler/butler-service';
import type { ButlerContext } from '../../src/main/butler/context';
import { buildTemplateReply } from '../../src/main/butler/template';
import type { ButlerStreamEvent } from '../../src/shared/butler-stream';

const NOW = () => new Date(2026, 10, 1, 9, 0, 0);

function serviceWith(client: ModelClient): ButlerServiceImpl {
  return new ButlerServiceImpl({
    modelClient: client,
    now: NOW,
    modelRetry: { delayMs: 0 }
  });
}

function streamingFailure(error: Error, before?: string): StreamingModelClient {
  return {
    complete: async () => ({ text: 'unused', usage: { inputTokens: 0, outputTokens: 0 } }),
    stream: async (_request, onEvent) => {
      if (before) onEvent({ type: 'text', text: before });
      throw error;
    }
  };
}

test('send retries a transient failure once and succeeds', async () => {
  const client = new FakeModelClient([new Error('socket hang up'), '重试成功']);
  const result = await serviceWith(client).send({ message: 'hi' });

  expect(result.text).toBe('重试成功');
  expect(client.calls).toHaveLength(2);
});

test('send does not retry auth or model errors', async () => {
  for (const error of [new Error('401 Unauthorized'), new Error('model not found')]) {
    const client = new FakeModelClient([error]);
    const result = await serviceWith(client).send({ message: 'hi' });

    expect(client.calls).toHaveLength(1);
    expect(result.text).toContain('模型暂时不可用');
    expect(result.text).not.toContain('已自动重试');
  }
});

test('send explains the retry when both attempts fail', async () => {
  const client = new FakeModelClient([new Error('timeout'), new Error('timeout')]);
  const result = await serviceWith(client).send({ message: 'hi' });

  expect(client.calls).toHaveLength(2);
  expect(result.text).toContain('已自动重试 1 次');
});

test('stream retries a transient failure before any output', async () => {
  let attempts = 0;
  const streaming: StreamingModelClient = {
    complete: async () => ({ text: 'unused', usage: { inputTokens: 0, outputTokens: 0 } }),
    stream: async (_request, onEvent) => {
      attempts += 1;
      if (attempts === 1) throw new Error('socket hang up');
      onEvent({ type: 'text', text: '最终回复' });
      return { text: '最终回复', usage: { inputTokens: 1, outputTokens: 1 } };
    }
  };
  const events: ButlerStreamEvent[] = [];

  const result = await serviceWith(streaming).stream({ message: 'hi' }, (event) =>
    events.push(event)
  );

  expect(attempts).toBe(2);
  expect(events).toContainEqual(
    expect.objectContaining({ type: 'retry', attempt: 1 })
  );
  expect(result.text).toBe('最终回复');
});

test('stream never retries after output and keeps the partial text', async () => {
  const events: ButlerStreamEvent[] = [];
  const client = streamingFailure(new Error('socket hang up'), '部分内容');

  const result = await serviceWith(client).stream({ message: 'hi' }, (event) =>
    events.push(event)
  );

  expect(client.complete).toBeDefined();
  expect(result.text).toBe('部分内容\n\n（模型连接中断，以上内容可能不完整。）');
  expect(events.some((event) => event.type === 'retry')).toBe(false);
  const errorEvent = events.find((event) => event.type === 'error');
  expect(errorEvent && 'message' in errorEvent ? errorEvent.message : '').toMatch(
    /模型调用失败/
  );
  const done = events.find((event) => event.type === 'done');
  expect(done && 'text' in done ? done.text : '').toBe(result.text);
});

test('stream classifies auth and model errors without retrying', async () => {
  for (const [error, pattern] of [
    [new Error('401 Unauthorized'), /模型认证失败/],
    [new Error('model not found'), /模型不可用/]
  ] as const) {
    let attempts = 0;
    const streaming: StreamingModelClient = {
      complete: async () => ({ text: 'unused', usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async () => {
        attempts += 1;
        throw error;
      }
    };
    const events: ButlerStreamEvent[] = [];
    const result = await serviceWith(streaming).stream({ message: 'hi' }, (event) =>
      events.push(event)
    );

    expect(attempts).toBe(1);
    const errorEvent = events.find((event) => event.type === 'error');
    expect(errorEvent && 'message' in errorEvent ? errorEvent.message : '').toMatch(
      pattern
    );
    expect(result.text).toContain('模型暂时不可用');
  }
});

test('stream explains the retry when both attempts fail before output', async () => {
  let attempts = 0;
  const streaming: StreamingModelClient = {
    complete: async () => ({ text: 'unused', usage: { inputTokens: 0, outputTokens: 0 } }),
    stream: async () => {
      attempts += 1;
      throw new Error('timeout');
    }
  };
  const events: ButlerStreamEvent[] = [];

  const result = await serviceWith(streaming).stream({ message: 'hi' }, (event) =>
    events.push(event)
  );

  expect(attempts).toBe(2);
  const errorEvent = events.find((event) => event.type === 'error');
  expect(errorEvent && 'message' in errorEvent ? errorEvent.message : '').toContain(
    '已自动重试 1 次'
  );
  expect(result.text).toContain('已自动重试 1 次');
});

test('redacts secrets from classified error messages', async () => {
  const events: ButlerStreamEvent[] = [];
  const client = streamingFailure(
    new Error('401 Unauthorized with sk-supersecret123')
  );

  await serviceWith(client).stream({ message: 'hi' }, (event) => events.push(event));

  const errorEvent = events.find((event) => event.type === 'error');
  const message = errorEvent && 'message' in errorEvent ? errorEvent.message : '';
  expect(message).toMatch(/模型认证失败/);
  expect(message).not.toContain('sk-supersecret123');
});

test('only the model-error template mentions the retry', () => {
  const context: ButlerContext = {
    now: new Date(2026, 10, 1),
    workspaces: [],
    tasks: [],
    memory: [],
    knowledge: [],
    contextError: false
  };
  const input = { message: 'hi' };

  expect(buildTemplateReply(context, input, { reason: 'model-error' })).not.toContain(
    '已自动重试'
  );
  expect(
    buildTemplateReply(context, input, { reason: 'model-error', retried: true })
  ).toContain('已自动重试 1 次');
  expect(
    buildTemplateReply(context, input, {
      reason: 'tool-error',
      toolName: 'write_note',
      retried: true
    })
  ).not.toContain('已自动重试');
});
