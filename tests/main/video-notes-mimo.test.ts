import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
  ASR_REPEAT_LIMIT,
  chatCompletionsUrl,
  createMimoAsrClient,
  qualityOk,
  repeatRatio,
  transcribeMedia
} from '../../src/main/video-notes/mimo';

function variedText(length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(0x4e00 + ((index * 97 + 13) % 2000));
  }
  return text;
}

describe('chatCompletionsUrl', () => {
  test('strips the anthropic suffix and appends the OpenAI path', () => {
    expect(chatCompletionsUrl('https://token-plan-cn.xiaomimimo.com/anthropic')).toBe(
      'https://token-plan-cn.xiaomimimo.com/v1/chat/completions'
    );
  });

  test('accepts a /v1 base URL or a full endpoint', () => {
    expect(chatCompletionsUrl('https://host/v1/')).toBe('https://host/v1/chat/completions');
    expect(chatCompletionsUrl('https://host/v1/chat/completions')).toBe(
      'https://host/v1/chat/completions'
    );
    expect(chatCompletionsUrl('https://host')).toBe('https://host/v1/chat/completions');
  });
});

describe('ASR quality heuristics', () => {
  test('flags a looping transcript', () => {
    const looped = '今天我们来学习集合的基本概念'.repeat(80);
    expect(repeatRatio(looped)).toBeGreaterThan(ASR_REPEAT_LIMIT);
    expect(qualityOk(looped, 180)).toBe(false);
  });

  test('accepts normal speech density', () => {
    const text = variedText(1200);
    expect(repeatRatio(text)).toBeLessThan(ASR_REPEAT_LIMIT);
    expect(qualityOk(text, 180)).toBe(true);
  });

  test('flags a truncated result', () => {
    expect(qualityOk('太短了', 180)).toBe(false);
  });
});

describe('createMimoAsrClient', () => {
  test('posts OpenAI-compatible audio content', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: [{ type: 'text', text: '识别结果' }] } }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch;
    const asr = createMimoAsrClient(
      {
        baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
        model: 'mimo-v2.5-asr',
        apiKey: 'secret-key'
      },
      fetchImpl
    );

    await expect(asr(Buffer.from('audio'), 'zh')).resolves.toBe('识别结果');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://token-plan-cn.xiaomimimo.com/v1/chat/completions'
    );
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-key');
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      model: string;
      messages: Array<{ content: Array<{ input_audio: { data: string } }> }>;
      asr_options: { language: string };
    };
    expect(body.model).toBe('mimo-v2.5-asr');
    expect(body.asr_options.language).toBe('zh');
    expect(body.messages[0]!.content[0]!.input_audio.data).toBe(
      `data:audio/mpeg;base64,${Buffer.from('audio').toString('base64')}`
    );
  });

  test('surfaces HTTP failures without the key', async () => {
    const fetchImpl = (async () =>
      new Response('bad key', { status: 401 })) as typeof fetch;
    const asr = createMimoAsrClient(
      { baseURL: 'https://host/v1', model: 'm', apiKey: 'secret-key' },
      fetchImpl
    );

    await expect(asr(Buffer.from('a'), 'auto')).rejects.toThrow(/HTTP 401/);
    await asr(Buffer.from('a'), 'auto').catch((error: unknown) => {
      expect(String(error)).not.toContain('secret-key');
    });
  });
});

describe('transcribeMedia', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'asaki-mimo-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function encodeTo(rootDir: string, calls: string[] = []) {
    return async (destination: string, _start: number, _duration: number) => {
      calls.push(basename(destination));
      await writeFile(destination, basename(destination), 'utf8');
    };
  }

  test('transcribes windows and caches their text on disk', async () => {
    const cacheDir = join(root, 'cache');
    let calls = 0;
    const options = {
      durationSeconds: 250,
      cacheDir,
      chunkSeconds: 100,
      encode: encodeTo(root),
      asr: async () => {
        calls += 1;
        return variedText(600);
      },
      language: 'zh' as const,
      model: 'mimo-v2.5-asr'
    };

    const first = await transcribeMedia('lesson.mp4', options);
    expect(first.chunks.map((chunk) => chunk.start)).toEqual([0, 100, 200]);
    expect(first.chars).toBeGreaterThan(0);
    expect(calls).toBe(3);
    expect((await readdir(cacheDir)).sort()).toEqual([
      'w0000.txt',
      'w0001.txt',
      'w0002.txt'
    ]);

    const second = await transcribeMedia('lesson.mp4', options);
    expect(second.text).toBe(first.text);
    expect(calls).toBe(3);
  });

  test('splits a looping window and keeps the better children', async () => {
    const cacheDir = join(root, 'cache-split');
    const encoded: string[] = [];
    const asr = vi.fn(async (audio: Buffer) => {
      if (String(audio).startsWith('w0000.mp3')) {
        return '重复的内容。'.repeat(200);
      }
      return variedText(400);
    });

    const transcript = await transcribeMedia('lesson.mp4', {
      durationSeconds: 100,
      cacheDir,
      chunkSeconds: 100,
      encode: encodeTo(root, encoded),
      asr,
      language: 'zh',
      model: 'mimo-v2.5-asr'
    });

    expect(encoded).toEqual(['w0000.mp3', 'w0000a.mp3', 'w0000b.mp3']);
    expect(transcript.chunks.map((chunk) => chunk.start)).toEqual([0, 50]);
    expect(transcript.chars).toBeGreaterThan(0);
  });

  test('keeps a suspect window when splitting adds nothing', async () => {
    const cacheDir = join(root, 'cache-keep');
    const asr = async (audio: Buffer) =>
      String(audio).startsWith('w0000.mp3') ? '简短内容' : '';

    const transcript = await transcribeMedia('lesson.mp4', {
      durationSeconds: 100,
      cacheDir,
      chunkSeconds: 100,
      encode: encodeTo(root),
      asr,
      language: 'zh',
      model: 'mimo-v2.5-asr'
    });

    expect(transcript.chunks.map((chunk) => chunk.start)).toEqual([0]);
  });
});
