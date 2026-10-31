import {
  CliAgentClient,
  extractCodexAnswer,
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
