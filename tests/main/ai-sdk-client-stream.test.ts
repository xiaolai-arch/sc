import {
  AiSdkModelClient,
  type AiSdkStreamPart,
  type AiSdkUsageLike
} from '../../src/main/agent/ai-sdk-client';
import type { ModelStreamEvent } from '../../src/main/agent/model-client';

function streamOf(
  parts: AiSdkStreamPart[],
  usage: AiSdkUsageLike = { inputTokens: 10, outputTokens: 2 }
) {
  return {
    fullStream: (async function* () {
      for (const part of parts) yield part;
    })(),
    totalUsage: Promise.resolve(usage)
  };
}

test('maps AI SDK reasoning, text and tool calls', async () => {
  const events: ModelStreamEvent[] = [];
  const client = new AiSdkModelClient({
    generate: async () => {
      throw new Error('generate not expected');
    },
    streamGenerate: () =>
      streamOf([
        { type: 'reasoning-delta', text: '先想' },
        { type: 'text-delta', text: '你好' },
        {
          type: 'tool-call',
          toolCallId: 'c1',
          toolName: 'write_note',
          input: { title: '极限', body: '等价无穷小' }
        }
      ]),
    model: {} as never
  });

  const result = await client.stream(
    { messages: [{ role: 'user', content: '你好' }] },
    (event) => events.push(event)
  );

  expect(events).toEqual([
    { type: 'reasoning', text: '先想' },
    { type: 'text', text: '你好' }
  ]);
  expect(result.text).toBe('你好');
  expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
  expect(result.toolCalls).toEqual([
    {
      id: 'c1',
      name: 'write_note',
      arguments: { title: '极限', body: '等价无穷小' }
    }
  ]);
});

test('supports legacy usage fields and rejects stream error parts', async () => {
  const client = new AiSdkModelClient({
    generate: async () => {
      throw new Error('generate not expected');
    },
    streamGenerate: () =>
      streamOf([{ type: 'text-delta', text: 'ok' }], {
        promptTokens: 7,
        completionTokens: 3
      }),
    model: {} as never
  });
  const result = await client.stream(
    { messages: [{ role: 'user', content: 'hi' }] },
    () => undefined
  );
  expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });

  const failing = new AiSdkModelClient({
    generate: async () => {
      throw new Error('generate not expected');
    },
    streamGenerate: () =>
      streamOf([{ type: 'error', error: new Error('boom') }]),
    model: {} as never
  });
  await expect(
    failing.stream({ messages: [{ role: 'user', content: 'hi' }] }, () => undefined)
  ).rejects.toThrow(/boom/);
});

test('passes the abort signal into the AI SDK stream options', async () => {
  const controller = new AbortController();
  let captured: unknown;
  const client = new AiSdkModelClient({
    generate: async () => {
      throw new Error('generate not expected');
    },
    streamGenerate: (options) => {
      captured = options;
      return streamOf([{ type: 'text-delta', text: 'ok' }]);
    },
    model: {} as never
  });

  await client.stream(
    { messages: [{ role: 'user', content: 'hi' }], signal: controller.signal },
    () => undefined
  );
  expect((captured as Record<string, unknown>)['abortSignal']).toBe(controller.signal);
});
