import {
  CliAgentClient,
  extractCodexAnswer,
  parseCliResponse,
  type CliRunner
} from '../../src/main/agent/cli-agent-client';
import { createModelClient } from '../../src/main/agent/model-client';

test('runs codex in one-shot mode with the prompt on stdin', async () => {
  const calls: Array<{
    command: string;
    args: string[];
    input: string;
  }> = [];
  const runner: CliRunner = async (command, args, input) => {
    calls.push({ command, args, input });
    return { stdout: 'hello from codex', stderr: '', code: 0 };
  };
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'codex', command: 'codex' },
    { runner }
  );

  const result = await client.complete({
    messages: [
      { role: 'system', content: '你是学习教练' },
      { role: 'user', content: '你好' }
    ]
  });

  expect(calls[0]?.command).toBe('codex');
  expect(calls[0]?.args).toEqual(['exec', '--skip-git-repo-check', '-']);
  expect(calls[0]?.input).toContain('SYSTEM:\n你是学习教练');
  expect(calls[0]?.input).toContain('USER:\n你好');
  expect(result.text).toBe('hello from codex');
  expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
});

test('rejects a failing local CLI agent', async () => {
  const runner: CliRunner = async () => ({
    stdout: '',
    stderr: 'not logged in',
    code: 1
  });
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'codex' },
    { runner }
  );
  await expect(
    client.complete({ messages: [{ role: 'user', content: 'hi' }] })
  ).rejects.toThrow(/not logged in/);
});

test('createModelClient selects the local CLI adapter without an API key', () => {
  const client = createModelClient(
    { kind: 'local-cli', agent: 'codex', command: 'codex' },
    null
  );
  expect(client).toBeInstanceOf(CliAgentClient);
});

test('extracts the final answer from a codex exec transcript', () => {
  const transcript = [
    'OpenAI Codex v0.166.0',
    '--------',
    'model: deepseek-v4.1-flash',
    '--------',
    'user',
    '你好',
    'codex',
    '第一版回答',
    'hook: Stop',
    'tokens used',
    '5,181',
    '最终回答',
    '第二行'
  ].join('\n');
  expect(extractCodexAnswer(transcript)).toBe('最终回答\n第二行');
});

function structuredEnvelope(value: unknown): string {
  return `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
}

describe('parseCliResponse', () => {
  test('maps a fenced envelope to text and tool calls', () => {
    const answer = structuredEnvelope({
      text: '我先记一下。',
      toolCalls: [{ name: 'write_note', arguments: { title: '极限', body: '等价无穷小' } }]
    });

    expect(parseCliResponse(answer)).toEqual({
      text: '我先记一下。',
      toolCalls: [
        {
          id: 'cli-call-1',
          name: 'write_note',
          arguments: { title: '极限', body: '等价无穷小' }
        }
      ]
    });
  });

  test('uses the last fenced block when the agent shows an earlier draft', () => {
    const answer = [
      structuredEnvelope({
        text: '旧回答',
        toolCalls: [{ name: 'get_memory', arguments: {} }]
      }),
      '补充说明',
      structuredEnvelope({
        text: '新回答',
        toolCalls: [{ name: 'get_today_plan', arguments: { workspaceId: 'ws-exam' } }]
      })
    ].join('\n');

    expect(parseCliResponse(answer)).toMatchObject({
      text: '新回答',
      toolCalls: [{ name: 'get_today_plan' }]
    });
  });

  test('keeps provided tool call ids and generates missing ones', () => {
    const answer = structuredEnvelope({
      text: '',
      toolCalls: [
        { id: 'call-9', name: 'get_memory', arguments: {} },
        { name: 'get_today_plan', arguments: {} }
      ]
    });

    expect(parseCliResponse(answer).toolCalls).toEqual([
      { id: 'call-9', name: 'get_memory', arguments: {} },
      { id: 'cli-call-2', name: 'get_today_plan', arguments: {} }
    ]);
  });

  test('accepts a fenced block without the json language tag', () => {
    const answer = `回答\n\`\`\`\n${JSON.stringify({ text: '好', toolCalls: [] })}\n\`\`\``;
    expect(parseCliResponse(answer)).toEqual({ text: '好' });
  });

  test('accepts the envelope without a code fence', () => {
    const answer = JSON.stringify({ text: '直接回答' });
    expect(parseCliResponse(answer)).toEqual({ text: '直接回答' });
  });

  test('falls back to plain text when the last block is malformed JSON', () => {
    const answer = '我先查一下。\n```json\n{"text": "没有闭合"\n```';
    expect(parseCliResponse(answer)).toEqual({ text: answer });
  });

  test('falls back when the last block is JSON but not a response envelope', () => {
    const answer = '```json\n{"foo":1}\n```';
    expect(parseCliResponse(answer)).toEqual({ text: answer });
  });

  test('falls back when the envelope has neither text nor tool calls', () => {
    const answer = structuredEnvelope({ text: '', toolCalls: [] });
    expect(parseCliResponse(answer)).toEqual({ text: answer });
  });

  test('drops malformed tool call entries but keeps valid ones', () => {
    const answer = structuredEnvelope({
      text: '试试',
      toolCalls: [{ arguments: {} }, { name: 'get_memory', arguments: {} }, 'oops']
    });

    expect(parseCliResponse(answer)).toEqual({
      text: '试试',
      toolCalls: [{ id: 'cli-call-2', name: 'get_memory', arguments: {} }]
    });
  });

  test('leaves plain text untouched', () => {
    expect(parseCliResponse('  今天先做极限刷题。\n然后背单词。 ')).toEqual({
      text: '今天先做极限刷题。\n然后背单词。'
    });
  });
});

describe('CliAgentClient structured tool protocol', () => {
  test('puts the available tool schemas and protocol into the prompt', async () => {
    let prompt = '';
    const runner: CliRunner = async (_command, _args, input) => {
      prompt = input;
      return { stdout: '好的', stderr: '', code: 0 };
    };
    const client = new CliAgentClient(
      { kind: 'local-cli', agent: 'claude' },
      { runner }
    );

    await client.complete({
      messages: [
        { role: 'system', content: '你是管家' },
        { role: 'user', content: '记一条笔记' }
      ],
      tools: [
        {
          name: 'write_note',
          description: '把内容写入本地笔记',
          parameters: {
            type: 'object',
            properties: { title: { type: 'string' } },
            required: ['title']
          }
        }
      ]
    });

    expect(prompt).toContain('## 工具调用协议');
    expect(prompt).toContain('"toolCalls"');
    expect(prompt).toContain('write_note：把内容写入本地笔记');
    expect(prompt).toContain('"required":["title"]');
    expect(prompt.indexOf('SYSTEM:')).toBeLessThan(prompt.indexOf('## 工具调用协议'));
    expect(prompt.indexOf('## 工具调用协议')).toBeLessThan(prompt.indexOf('USER:'));
  });

  test('omits the tool protocol when no tools are available', async () => {
    let prompt = '';
    const runner: CliRunner = async (_command, _args, input) => {
      prompt = input;
      return { stdout: '好的', stderr: '', code: 0 };
    };

    await new CliAgentClient({ kind: 'local-cli', agent: 'claude' }, { runner }).complete({
      messages: [{ role: 'user', content: '你好' }]
    });

    expect(prompt).not.toContain('工具调用协议');
    expect(prompt).toBe('USER:\n你好');
  });

  test('serializes assistant tool calls and tool results for the next round', async () => {
    let prompt = '';
    const runner: CliRunner = async (_command, _args, input) => {
      prompt = input;
      return { stdout: '已经记下来了。', stderr: '', code: 0 };
    };

    await new CliAgentClient({ kind: 'local-cli', agent: 'claude' }, { runner }).complete({
      messages: [
        { role: 'user', content: '记一下' },
        {
          role: 'assistant',
          content: '我来写。',
          toolCalls: [
            { id: 'cli-call-1', name: 'write_note', arguments: { title: '极限' } }
          ]
        },
        {
          role: 'tool',
          content: '{"ok":true,"result":{"noteId":"n1"}}',
          toolCallId: 'cli-call-1',
          toolName: 'write_note'
        }
      ]
    });

    expect(prompt).toContain('ASSISTANT TOOL CALLS:');
    expect(prompt).toContain('"name":"write_note"');
    expect(prompt).toContain('TOOL RESULT (write_note):');
    expect(prompt).toContain('{"ok":true,"result":{"noteId":"n1"}}');
  });

  test('returns tool calls parsed from a plain CLI answer', async () => {
    const runner: CliRunner = async () => ({
      stdout: [
        '我先帮你记下来。',
        structuredEnvelope({
          text: '我先帮你记下来。',
          toolCalls: [
            { name: 'write_note', arguments: { title: '极限', body: '等价无穷小' } }
          ]
        })
      ].join('\n'),
      stderr: '',
      code: 0
    });
    const client = new CliAgentClient({ kind: 'local-cli', agent: 'claude' }, { runner });

    const result = await client.complete({
      messages: [{ role: 'user', content: '记一下' }]
    });

    expect(result.text).toBe('我先帮你记下来。');
    expect(result.toolCalls).toEqual([
      {
        id: 'cli-call-1',
        name: 'write_note',
        arguments: { title: '极限', body: '等价无穷小' }
      }
    ]);
  });

  test('extracts a structured block from a codex banner/token transcript', async () => {
    const runner: CliRunner = async () => ({
      stdout: [
        'OpenAI Codex v0.166.0',
        '--------',
        'user',
        '今天做什么？',
        'codex',
        '草稿回答',
        'hook: Stop',
        'tokens used',
        '5,181',
        structuredEnvelope({
          text: '先做极限刷题。',
          toolCalls: [
            { name: 'get_today_plan', arguments: { workspaceId: 'ws-exam' } }
          ]
        })
      ].join('\n'),
      stderr: '',
      code: 0
    });
    const client = new CliAgentClient({ kind: 'local-cli', agent: 'codex' }, { runner });

    const result = await client.complete({
      messages: [{ role: 'user', content: '今天做什么？' }]
    });

    expect(result.text).toBe('先做极限刷题。');
    expect(result.toolCalls).toEqual([
      {
        id: 'cli-call-1',
        name: 'get_today_plan',
        arguments: { workspaceId: 'ws-exam' }
      }
    ]);
  });

  test('degrades malformed structured output to the plain CLI text', async () => {
    const stdout = '我先查一下。\n```json\n{"text": "坏掉"\n```';
    const runner: CliRunner = async () => ({ stdout, stderr: '', code: 0 });
    const client = new CliAgentClient({ kind: 'local-cli', agent: 'claude' }, { runner });

    const result = await client.complete({
      messages: [{ role: 'user', content: '查一下' }]
    });

    expect(result).toEqual({
      text: stdout,
      usage: { inputTokens: 0, outputTokens: 0 }
    });
    expect(result.toolCalls).toBeUndefined();
  });

  test('returns plain text unchanged when the agent calls no tools', async () => {
    const runner: CliRunner = async () => ({
      stdout: '今天先做极限刷题，再背 50 个单词。',
      stderr: '',
      code: 0
    });
    const client = new CliAgentClient({ kind: 'local-cli', agent: 'claude' }, { runner });

    await expect(
      client.complete({ messages: [{ role: 'user', content: '今天做什么？' }] })
    ).resolves.toEqual({
      text: '今天先做极限刷题，再背 50 个单词。',
      usage: { inputTokens: 0, outputTokens: 0 }
    });
  });
});

test('adds --bare when claude isolation is enabled', async () => {
  const calls: string[][] = [];
  const client = new CliAgentClient(
    {
      kind: 'local-cli',
      agent: 'claude',
      command: 'claude',
      isolate: true
    },
    {
      runner: async (_command, args) => {
        calls.push(args);
        return { stdout: 'ok', stderr: '', code: 0 };
      }
    }
  );

  await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
  expect(calls[0]).toContain('--bare');
});

test('passes the abort signal to the runner and rejects after abort', async () => {
  const controller = new AbortController();
  const calls: Array<{ signal?: AbortSignal }> = [];
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'codex' },
    {
      runner: async (_command, _args, _input, options) => {
        calls.push({ signal: options.signal });
        return { stdout: 'ok', stderr: '', code: 0 };
      }
    }
  );

  const result = await client.complete({
    messages: [{ role: 'user', content: 'hi' }],
    signal: controller.signal
  });
  expect(calls[0]?.signal).toBe(controller.signal);
  expect(result.text).toBe('ok');

  controller.abort();
  await expect(
    client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal
    })
  ).rejects.toThrow(/Aborted/);
});
