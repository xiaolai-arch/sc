import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildClaudeStreamJsonInput,
  CliAgentClient,
  type CliRunner
} from '../../../src/main/agent/cli-agent-client';
import { prepareCliSpawn, quoteWindowsArgument } from '../../../src/main/agent/cli-command';
import { ModelImageUnsupportedError } from '../../../src/main/agent/model-client';

type CapturedCall = {
  command: string;
  args: string[];
  input: string;
  timeoutMs: number;
};

function captureRunner(calls: CapturedCall[], stdout = 'ok'): CliRunner {
  return async (command, args, input, options) => {
    calls.push({ command, args, input, timeoutMs: options.timeoutMs });
    return { stdout, stderr: '', code: 0 };
  };
}

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-images-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('claude images and no-tools arguments', () => {
  test('switches to stream-json stdin and passes an empty tool set', async () => {
    await withTempDir(async (dir) => {
      const frame = join(dir, 'frame.jpg');
      const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02]);
      await writeFile(frame, bytes);

      const calls: CapturedCall[] = [];
      const client = new CliAgentClient(
        { kind: 'local-cli', agent: 'claude', command: 'claude' },
        { runner: captureRunner(calls) }
      );

      const result = await client.complete({
        messages: [
          { role: 'system', content: '你是读屏器' },
          {
            role: 'user',
            content: '读这张图',
            images: [{ path: frame, mediaType: 'image/jpeg' }]
          }
        ],
        noTools: true
      });

      expect(result.text).toBe('ok');
      const call = calls[0]!;
      expect(call.args).toEqual([
        '-p',
        '--output-format',
        'text',
        '--tools',
        '',
        '--input-format',
        'stream-json'
      ]);
      // No positional prompt in image mode: everything travels on stdin.
      expect(call.args.some((argument) => argument.includes('读这张图'))).toBe(false);

      const lines = call.input.trimEnd().split(/\r?\n/);
      expect(lines).toHaveLength(1);
      const payload = JSON.parse(lines[0]!) as {
        type: string;
        message: {
          role: string;
          content: Array<{
            type: string;
            text?: string;
            source?: { type: string; media_type: string; data: string };
          }>;
        };
      };
      expect(payload.type).toBe('user');
      expect(payload.message.role).toBe('user');
      expect(payload.message.content[0]).toMatchObject({ type: 'text' });
      expect(payload.message.content[0]?.text).toContain('SYSTEM:\n你是读屏器');
      expect(payload.message.content[0]?.text).toContain('USER:\n读这张图');
      expect(payload.message.content[1]).toEqual({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: bytes.toString('base64')
        }
      });
    });
  });

  test('keeps a plain stdin prompt when there are no images', async () => {
    const calls: CapturedCall[] = [];
    const client = new CliAgentClient(
      { kind: 'local-cli', agent: 'claude' },
      { runner: captureRunner(calls) }
    );

    await client.complete({
      messages: [{ role: 'user', content: '你好' }],
      noTools: true
    });

    expect(calls[0]?.args).toEqual(['-p', '--output-format', 'text', '--tools', '']);
    expect(calls[0]?.input).toBe('USER:\n你好');
  });

  test('omits the tool protocol when tools are supplied but disabled', async () => {
    const calls: CapturedCall[] = [];
    const client = new CliAgentClient(
      { kind: 'local-cli', agent: 'claude' },
      { runner: captureRunner(calls) }
    );

    await client.complete({
      messages: [{ role: 'user', content: '生成 JSON' }],
      tools: [
        {
          name: 'write_note',
          description: '写笔记',
          parameters: { type: 'object', properties: {} }
        }
      ],
      noTools: true
    });

    expect(calls[0]?.args).toContain('--tools');
    expect(calls[0]?.args).toContain('');
    expect(calls[0]?.input).not.toContain('工具调用协议');
  });

  test('serializes text before images in the stream-json payload', () => {    const payload = JSON.parse(
      buildClaudeStreamJsonInput('说明', [
        { mediaType: 'image/png', data: 'AAAA' },
        { mediaType: 'image/webp', data: 'BBBB' }
      ]).trimEnd()
    ) as {
      message: { content: Array<{ type: string; source?: { media_type: string } }> };
    };

    expect(payload.message.content.map((part) => part.type)).toEqual([
      'text',
      'image',
      'image'
    ]);
    expect(payload.message.content[1]?.source?.media_type).toBe('image/png');
  });
});

describe('image flags for the other CLI agents', () => {
  test('codex repeats -i once per image before the stdin placeholder', async () => {
    const calls: CapturedCall[] = [];
    const client = new CliAgentClient(
      { kind: 'local-cli', agent: 'codex', command: 'codex' },
      { runner: captureRunner(calls) }
    );

    await client.complete({
      messages: [
        {
          role: 'user',
          content: '看图',
          images: [
            { path: '/tmp/a.jpg', mediaType: 'image/jpeg' },
            { path: '/tmp/b.png', mediaType: 'image/png' }
          ]
        }
      ]
    });

    expect(calls[0]?.args).toEqual([
      'exec',
      '--skip-git-repo-check',
      '-c',
      'model_reasoning_effort=medium',
      '-i',
      '/tmp/a.jpg',
      '-i',
      '/tmp/b.png',
      '-'
    ]);
    expect(calls[0]?.input).toContain('USER:\n看图');
  });

  test('opencode repeats --file once per image before the prompt', async () => {
    const calls: CapturedCall[] = [];
    const client = new CliAgentClient(
      { kind: 'local-cli', agent: 'opencode', command: 'opencode' },
      { runner: captureRunner(calls) }
    );

    await client.complete({
      messages: [
        {
          role: 'user',
          content: 'hi',
          images: [{ path: '/tmp/a.jpg', mediaType: 'image/jpeg' }]
        }
      ]
    });

    expect(calls[0]?.args).toEqual(['--prompt', '--file', '/tmp/a.jpg', 'USER:\nhi']);
  });

  test('zcode rejects image requests instead of dropping them', async () => {
    const calls: CapturedCall[] = [];
    const client = new CliAgentClient(
      { kind: 'local-cli', agent: 'zcode', command: 'zcode' },
      { runner: captureRunner(calls) }
    );

    await expect(
      client.complete({
        messages: [
          {
            role: 'user',
            content: 'hi',
            images: [{ path: '/tmp/a.jpg', mediaType: 'image/jpeg' }]
          }
        ]
      })
    ).rejects.toThrow(ModelImageUnsupportedError);
    expect(calls).toHaveLength(0);
    await expect(
      client.complete({
        messages: [
          {
            role: 'user',
            content: 'hi',
            images: [{ path: '/tmp/a.jpg', mediaType: 'image/jpeg' }]
          }
        ]
      })
    ).rejects.toThrow('当前模型不支持读图：zcode');
  });

  test('ignores images on non-user messages', async () => {
    const calls: CapturedCall[] = [];
    const client = new CliAgentClient(
      { kind: 'local-cli', agent: 'zcode', command: 'zcode' },
      { runner: captureRunner(calls) }
    );

    await expect(
      client.complete({
        messages: [
          { role: 'user', content: 'hi' },
          {
            role: 'assistant',
            content: '这里有一张图',
            images: [{ path: '/tmp/a.jpg', mediaType: 'image/jpeg' }]
          }
        ]
      })
    ).resolves.toMatchObject({ text: 'ok' });
    expect(calls).toHaveLength(1);
  });
});

describe('windows quoting of the empty tool set', () => {
  test('quotes an empty argument so cmd.exe passes it through', () => {
    expect(quoteWindowsArgument('')).toBe('""');
  });

  test('keeps --tools "" intact in the cmd.exe command line', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, 'claude.cmd'), '@echo off\r\n');
      const spec = await prepareCliSpawn('claude', ['-p', '--tools', ''], {
        platform: 'win32',
        env: {
          PATH: dir,
          PATHEXT: '.CMD',
          ComSpec: 'C:\\Windows\\System32\\cmd.exe'
        }
      });

      expect(spec.kind).toBe('cmd');
      if (spec.kind !== 'cmd') return;
      expect(spec.args[3]).toContain('claude');
      expect(spec.args[3]).toContain('-p --tools ""');
      expect(spec.args[3]?.endsWith('-p --tools ""')).toBe(true);
    });
  });
});
