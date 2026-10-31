import { AiSdkModelClient, type AiSdkGenerate } from '../../src/main/agent/ai-sdk-client';
import {
  createModelClient,
  FakeModelClient,
  NoApiKeyError
} from '../../src/main/agent/model-client';

describe('FakeModelClient', () => {
  test('returns scripted responses in order and records calls', async () => {
    const client = new FakeModelClient(['first', 'second']);

    expect(await client.complete({ messages: [] })).toEqual({
      text: 'first',
      usage: { inputTokens: 0, outputTokens: 0 }
    });
    expect(await client.complete({ messages: [] })).toEqual({
      text: 'second',
      usage: { inputTokens: 0, outputTokens: 0 }
    });
    expect(client.calls).toHaveLength(2);
  });

  test('returns scripted responses with usage and tool calls unchanged', async () => {
    const response = {
      text: '',
      usage: { inputTokens: 11, outputTokens: 3 },
      toolCalls: [{ id: 'call-1', name: 'get_today_plan', arguments: { workspaceId: 'ws-1' } }]
    };
    const client = new FakeModelClient([response]);

    await expect(client.complete({ messages: [] })).resolves.toEqual(response);
  });

  test('replays scripted errors', async () => {
    const client = new FakeModelClient([new Error('boom')]);

    await expect(client.complete({ messages: [] })).rejects.toThrow('boom');
  });

  test('fails loudly when the script runs out', async () => {
    const client = new FakeModelClient(['only one']);

    await client.complete({ messages: [] });
    await expect(client.complete({ messages: [] })).rejects.toThrow(/no scripted response left/i);
  });
});

describe('createModelClient', () => {
  test('anthropic requires an api key', () => {
    expect(() => createModelClient({ kind: 'anthropic', model: 'claude-sonnet-5-5' }, null)).toThrow(
      NoApiKeyError
    );
  });

  test('anthropic builds a client when a key is present', () => {
    const client = createModelClient(
      { kind: 'anthropic', model: 'claude-sonnet-5-5' },
      'test-key'
    );
    expect(typeof client.complete).toBe('function');
  });

  test('openai-compatible and ollama build without throwing', () => {
    expect(() =>
      createModelClient(
        { kind: 'openai-compatible', baseURL: 'http://127.0.0.1:8080/v1', model: 'local' },
        'test-key'
      )
    ).not.toThrow();
    expect(() =>
      createModelClient({ kind: 'ollama', baseURL: '', model: 'llama3' }, null)
    ).not.toThrow();
  });

  test('the error names the provider but never echoes the key', () => {
    try {
      createModelClient({ kind: 'anthropic', model: 'claude-sonnet-5-5' }, null);
      throw new Error('expected NoApiKeyError');
    } catch (error) {
      expect(error).toBeInstanceOf(NoApiKeyError);
      expect((error as Error).message).toContain('anthropic');
      expect((error as Error).message).not.toContain('sk-');
    }
  });
});

describe('AiSdkModelClient', () => {
  test('maps text and usage', async () => {
    const generate = vi.fn(async (_options: Parameters<AiSdkGenerate>[0]) => ({
      text: 'hello',
      usage: { inputTokens: 3, outputTokens: 2 }
    }));
    const client = new AiSdkModelClient({ generate, model: 'test-model' });

    const result = await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 128,
      temperature: 0.2
    });

    expect(result).toEqual({ text: 'hello', usage: { inputTokens: 3, outputTokens: 2 } });
    const options = generate.mock.calls[0]?.[0] as Parameters<AiSdkGenerate>[0];
    expect(options.model).toBe('test-model');
    expect(options.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(options.maxOutputTokens).toBe(128);
    expect(options.temperature).toBe(0.2);
  });

  test('falls back to legacy usage field names', async () => {
    const generate = vi.fn(async (_options: Parameters<AiSdkGenerate>[0]) => ({
      text: 'legacy',
      usage: { promptTokens: 7, completionTokens: 5 }
    }));
    const client = new AiSdkModelClient({ generate, model: 'test-model' });

    await expect(client.complete({ messages: [] })).resolves.toEqual({
      text: 'legacy',
      usage: { inputTokens: 7, outputTokens: 5 }
    });
  });

  test('maps tool calls and sends tool definitions to the provider', async () => {
    const generate = vi.fn(async (_options: Parameters<AiSdkGenerate>[0]) => ({
      text: '',
      usage: { inputTokens: 1, outputTokens: 2 },
      toolCalls: [
        { toolCallId: 'call-1', toolName: 'get_today_plan', input: { workspaceId: 'ws-1' } }
      ]
    }));
    const client = new AiSdkModelClient({ generate, model: 'test-model' });

    const result = await client.complete({
      messages: [{ role: 'user', content: '今天做什么？' }],
      tools: [
        {
          name: 'get_today_plan',
          description: '读取今天的计划',
          parameters: { type: 'object', properties: { workspaceId: { type: 'string' } } }
        }
      ]
    });

    expect(result.toolCalls).toEqual([
      { id: 'call-1', name: 'get_today_plan', arguments: { workspaceId: 'ws-1' } }
    ]);
    const options = generate.mock.calls[0]?.[0] as Parameters<AiSdkGenerate>[0];
    expect(options.tools?.['get_today_plan']?.description).toBe('读取今天的计划');
    expect(options.tools?.['get_today_plan']?.inputSchema).toBeDefined();
  });

  test('maps assistant tool calls and tool results into AI SDK messages', async () => {
    const generate = vi.fn(async (_options: Parameters<AiSdkGenerate>[0]) => ({
      text: 'done',
      usage: { inputTokens: 1, outputTokens: 1 }
    }));
    const client = new AiSdkModelClient({ generate, model: 'test-model' });

    await client.complete({
      messages: [
        {
          role: 'assistant',
          content: '我先查一下',
          toolCalls: [{ id: 'call-1', name: 'get_today_plan', arguments: { workspaceId: 'ws-1' } }]
        },
        { role: 'tool', content: '{"ok":true}', toolCallId: 'call-1', toolName: 'get_today_plan' }
      ]
    });

    const options = generate.mock.calls[0]?.[0] as Parameters<AiSdkGenerate>[0];
    expect(options.messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: '我先查一下' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'get_today_plan',
            input: { workspaceId: 'ws-1' }
          }
        ]
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'get_today_plan',
            output: { type: 'text', value: '{"ok":true}' }
          }
        ]
      }
    ]);
  });

  test('rejects a tool message without a call id', async () => {
    const generate = vi.fn(async (_options: Parameters<AiSdkGenerate>[0]) => ({
      text: 'x',
      usage: { inputTokens: 0, outputTokens: 0 }
    }));
    const client = new AiSdkModelClient({ generate, model: 'test-model' });

    await expect(
      client.complete({ messages: [{ role: 'tool', content: 'orphan' }] })
    ).rejects.toThrow(/toolCallId/);
  });
});
