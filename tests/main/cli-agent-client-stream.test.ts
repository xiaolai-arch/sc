import { CliAgentClient, type CliStreamRunner } from '../../src/main/agent/cli-agent-client';
import type { ModelStreamEvent } from '../../src/main/agent/model-client';

function scriptedStream(lines: string[], code = 0): CliStreamRunner {
  return async (_command, _args, _input, _options, onLine) => {
    for (const line of lines) onLine(line);
    return { stdout: '', stderr: '', code };
  };
}

function line(value: unknown): string {
  return JSON.stringify(value);
}

function claudeThinking(text: string) {
  return line({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: text }
    }
  });
}

function claudeText(text: string) {
  return line({
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text }
    }
  });
}

function claudeResult(text: string, inputTokens = 0, outputTokens = 0, isError = false) {
  return line({
    type: 'result',
    result: text,
    is_error: isError,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens }
  });
}

function codexReasoning(text: string) {
  return line({
    type: 'item.completed',
    item: { id: 'item_0', type: 'reasoning', text }
  });
}

function codexMessage(text: string) {
  return line({
    type: 'item.completed',
    item: { id: 'item_1', type: 'agent_message', text }
  });
}

function codexCompleted(inputTokens = 0, outputTokens = 0) {
  return line({
    type: 'turn.completed',
    usage: { input_tokens: inputTokens, output_tokens: outputTokens }
  });
}

function envelope(text: string, toolCalls: Array<{ name: string; arguments: unknown }>) {
  return `\`\`\`json\n${JSON.stringify({ text, toolCalls })}\n\`\`\``;
}

test('claude streams reasoning and text deltas', async () => {
  const events: ModelStreamEvent[] = [];
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'claude', command: 'claude' },
    {
      streamRunner: scriptedStream([
        line({ type: 'system', subtype: 'hook_started' }),
        claudeThinking('先看计划'),
        claudeText('你好'),
        claudeResult('你好', 10, 2)
      ])
    }
  );

  const result = await client.stream(
    { messages: [{ role: 'user', content: '你好' }] },
    (event) => events.push(event)
  );

  expect(events).toEqual([
    { type: 'reasoning', text: '先看计划' },
    { type: 'text', text: '你好' }
  ]);
  expect(result.text).toBe('你好');
  expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
});

test('claude buffers a tool envelope and returns tool calls', async () => {
  const events: ModelStreamEvent[] = [];
  const answer = envelope('我先记一下', [
    { name: 'write_note', arguments: { title: '极限', body: '等价无穷小' } }
  ]);
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'claude', command: 'claude' },
    { streamRunner: scriptedStream([claudeText(answer), claudeResult(answer)]) }
  );

  const result = await client.stream(
    { messages: [{ role: 'user', content: '记一下' }] },
    (event) => events.push(event)
  );

  expect(events).toEqual([]);
  expect(result.text).toBe('我先记一下');
  expect(result.toolCalls).toEqual([
    {
      id: 'cli-call-1',
      name: 'write_note',
      arguments: { title: '极限', body: '等价无穷小' }
    }
  ]);
});

test('codex streams reasoning and parses agent_message envelope', async () => {
  const events: ModelStreamEvent[] = [];
  const answer = envelope('说明', [{ name: 'write_note', arguments: { title: 't', body: 'b' } }]);
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'codex', command: 'codex' },
    {
      streamRunner: scriptedStream([
        line({ type: 'thread.started', thread_id: 't' }),
        codexReasoning('先想'),
        codexMessage(answer),
        codexCompleted(7, 3)
      ])
    }
  );

  const result = await client.stream(
    { messages: [{ role: 'user', content: '记一下' }] },
    (event) => events.push(event)
  );

  expect(events).toEqual([{ type: 'reasoning', text: '先想' }]);
  expect(result.text).toBe('说明');
  expect(result.toolCalls?.[0]).toMatchObject({ name: 'write_note' });
  expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
});

test('codex plain agent_message emits one text event', async () => {
  const events: ModelStreamEvent[] = [];
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'codex', command: 'codex' },
    { streamRunner: scriptedStream([codexMessage('你好'), codexCompleted()]) }
  );

  const result = await client.stream(
    { messages: [{ role: 'user', content: '你好' }] },
    (event) => events.push(event)
  );

  expect(events).toEqual([{ type: 'text', text: '你好' }]);
  expect(result.text).toBe('你好');
});

test('zcode falls back to one text event from complete()', async () => {
  const events: ModelStreamEvent[] = [];
  const streamRunner = vi.fn(async () => {
    throw new Error('streamRunner should not be called');
  });
  const runner = vi.fn(async () => ({ stdout: 'fallback text', stderr: '', code: 0 }));
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'zcode' },
    { runner, streamRunner }
  );

  const result = await client.stream(
    { messages: [{ role: 'user', content: 'hi' }] },
    (event) => events.push(event)
  );

  expect(streamRunner).not.toHaveBeenCalled();
  expect(events).toEqual([{ type: 'text', text: 'fallback text' }]);
  expect(result.text).toBe('fallback text');
});

test('explicit codex failure is terminal and does not call complete()', async () => {
  const runner = vi.fn();
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'codex', command: 'codex' },
    {
      runner,
      streamRunner: scriptedStream(
        [line({ type: 'turn.failed', error: { message: 'boom' } })],
        1
      )
    }
  );

  await expect(
    client.stream({ messages: [{ role: 'user', content: 'hi' }] }, () => undefined)
  ).rejects.toThrow(/boom/);
  expect(runner).not.toHaveBeenCalled();
});

test('exit 0 with no events falls back to complete()', async () => {
  const events: ModelStreamEvent[] = [];
  const runner = vi.fn(async () => ({ stdout: 'fallback', stderr: '', code: 0 }));
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'codex', command: 'codex' },
    { runner, streamRunner: scriptedStream([], 0) }
  );

  const result = await client.stream(
    { messages: [{ role: 'user', content: 'hi' }] },
    (event) => events.push(event)
  );

  expect(runner).toHaveBeenCalledTimes(1);
  expect(events).toEqual([{ type: 'text', text: 'fallback' }]);
  expect(result.text).toBe('fallback');
});

test('nonzero exit after deltas rejects without calling complete()', async () => {
  const runner = vi.fn();
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'codex', command: 'codex' },
    {
      runner,
      streamRunner: scriptedStream([codexReasoning('想了')], 1)
    }
  );

  await expect(
    client.stream({ messages: [{ role: 'user', content: 'hi' }] }, () => undefined)
  ).rejects.toThrow(/退出码/);
  expect(runner).not.toHaveBeenCalled();
});

test('malformed fenced block is returned as plain text', async () => {
  const events: ModelStreamEvent[] = [];
  const answer = '```json not-json ```';
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'claude', command: 'claude' },
    { streamRunner: scriptedStream([claudeText(answer), claudeResult(answer)]) }
  );

  const result = await client.stream(
    { messages: [{ role: 'user', content: 'hi' }] },
    (event) => events.push(event)
  );

  expect(events).toEqual([]);
  expect(result.text).toBe(answer);
});

test('codex stream passes model and effort before the stdin placeholder', async () => {
  const calls: string[][] = [];
  const client = new CliAgentClient(
    {
      kind: 'local-cli',
      agent: 'codex',
      command: 'codex',
      model: 'gpt-x',
      effort: 'low'
    },
    {
      streamRunner: async (_command, args, _input, _options, onLine) => {
        calls.push(args);
        onLine(codexMessage('好的'));
        return { stdout: '', stderr: '', code: 0 };
      }
    }
  );

  await client.stream({ messages: [{ role: 'user', content: 'hi' }] }, () => undefined);

  expect(calls[0]).toEqual([
    'exec',
    '--json',
    '--skip-git-repo-check',
    '-m',
    'gpt-x',
    '-c',
    'model_reasoning_effort=low',
    '-'
  ]);
});

test('codex stream keeps the medium effort default', async () => {
  const calls: string[][] = [];
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'codex', command: 'codex' },
    {
      streamRunner: async (_command, args, _input, _options, onLine) => {
        calls.push(args);
        onLine(codexMessage('好的'));
        return { stdout: '', stderr: '', code: 0 };
      }
    }
  );

  await client.stream({ messages: [{ role: 'user', content: 'hi' }] }, () => undefined);

  expect(calls[0]).toContain('model_reasoning_effort=medium');
});

test('claude stream passes model, effort and isolate flags', async () => {
  const calls: string[][] = [];
  const client = new CliAgentClient(
    {
      kind: 'local-cli',
      agent: 'claude',
      command: 'claude',
      model: 'claude-x',
      effort: 'high',
      isolate: true
    },
    {
      streamRunner: async (_command, args, _input, _options, onLine) => {
        calls.push(args);
        onLine(claudeResult('好的'));
        return { stdout: '', stderr: '', code: 0 };
      }
    }
  );

  await client.stream({ messages: [{ role: 'user', content: 'hi' }] }, () => undefined);

  expect(calls[0]).toEqual([
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model',
    'claude-x',
    '--effort',
    'high',
    '--bare'
  ]);
});

test('claude holds a prose preamble before a fenced tool envelope', async () => {
  const events: ModelStreamEvent[] = [];
  const prose = '晚上好，我先看一下。\n';
  const answer = `${prose}${envelope('我先读计划', [
    { name: 'get_today_plan', arguments: {} }
  ])}`;
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'claude', command: 'claude' },
    {
      streamRunner: scriptedStream([
        claudeText(prose),
        claudeText(envelope('我先读计划', [{ name: 'get_today_plan', arguments: {} }])),
        claudeResult(answer)
      ])
    }
  );

  const result = await client.stream(
    { messages: [{ role: 'user', content: '我现在需要干什么' }] },
    (event) => events.push(event)
  );

  expect(events).toEqual([]);
  expect(result.text).toBe('我先读计划');
  expect(result.toolCalls?.[0]?.name).toBe('get_today_plan');
});
