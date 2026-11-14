import { getEventListeners } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AiSdkModelClient } from '../../../src/main/agent/ai-sdk-client';
import type { ModelToolDefinition } from '../../../src/main/agent/model-client';

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-ai-sdk-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function capturingClient(captured: Array<Record<string, unknown>>) {
  return new AiSdkModelClient({
    generate: async (options) => {
      captured.push(options as Record<string, unknown>);
      return { text: 'ok' };
    },
    model: {} as never
  });
}

const NOTE_TOOL: ModelToolDefinition = {
  name: 'write_note',
  description: '写笔记',
  parameters: { type: 'object', properties: {} }
};

describe('AI SDK image messages', () => {
  test('converts user images into text and image content blocks', async () => {
    await withTempDir(async (dir) => {
      const frame = join(dir, 'frame.png');
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      await writeFile(frame, bytes);
      const captured: Array<Record<string, unknown>> = [];

      const result = await capturingClient(captured).complete({
        messages: [
          {
            role: 'user',
            content: '读图',
            images: [{ path: frame, mediaType: 'image/png' }]
          }
        ]
      });

      expect(result.text).toBe('ok');
      const messages = captured[0]?.['messages'] as Array<{
        role: string;
        content: Array<{ type: string; text?: string; image?: Buffer; mediaType?: string }>;
      }>;
      expect(messages).toHaveLength(1);
      expect(messages[0]?.role).toBe('user');
      expect(messages[0]?.content[0]).toEqual({ type: 'text', text: '读图' });
      expect(messages[0]?.content[1]?.type).toBe('image');
      expect(messages[0]?.content[1]?.mediaType).toBe('image/png');
      expect(messages[0]?.content[1]?.image?.equals(bytes)).toBe(true);
    });
  });

  test('leaves plain text messages unchanged when there are no images', async () => {
    const captured: Array<Record<string, unknown>> = [];
    await capturingClient(captured).complete({
      messages: [{ role: 'user', content: '你好' }]
    });

    expect(captured[0]?.['messages']).toEqual([{ role: 'user', content: '你好' }]);
  });
});

describe('AI SDK no-tools requests', () => {
  test('declares no tools even when definitions are passed', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const client = capturingClient(captured);

    await client.complete({
      messages: [{ role: 'user', content: '生成 JSON' }],
      tools: [NOTE_TOOL],
      noTools: true
    });
    expect(captured[0]?.['tools']).toBeUndefined();

    await client.complete({
      messages: [{ role: 'user', content: '生成 JSON' }],
      tools: [NOTE_TOOL]
    });
    expect(captured[1]?.['tools']).toEqual({ write_note: expect.any(Object) });
  });
});

describe('AI SDK timeouts', () => {
  function abortingClient(captured: Array<Record<string, unknown>>) {
    return new AiSdkModelClient({
      generate: (options) => {
        captured.push(options as Record<string, unknown>);
        const signal = (options as { abortSignal?: AbortSignal }).abortSignal;
        return new Promise((_resolve, reject) => {
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      model: {} as never
    });
  }

  test('aborts the SDK call with a timeout error', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const client = abortingClient(captured);

    await expect(
      client.complete({
        messages: [{ role: 'user', content: '慢请求' }],
        timeoutMs: 10
      })
    ).rejects.toMatchObject({ name: 'ModelTimeoutError', timeoutMs: 10 });

    const signal = captured[0]?.['abortSignal'] as AbortSignal;
    expect(signal.aborted).toBe(true);
  });

  test('still propagates a caller abort when a timeout is configured', async () => {
    const controller = new AbortController();
    const captured: Array<Record<string, unknown>> = [];
    const client = abortingClient(captured);

    const pending = client.complete({
      messages: [{ role: 'user', content: '慢请求' }],
      signal: controller.signal,
      timeoutMs: 60_000
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect((captured[0]?.['abortSignal'] as AbortSignal).aborted).toBe(true);
    // The timeout listener is removed once the call settles.
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  test('passes the caller signal through unchanged without a timeout', async () => {
    const controller = new AbortController();
    const captured: Array<Record<string, unknown>> = [];
    const client = new AiSdkModelClient({
      generate: async (options) => {
        captured.push(options as Record<string, unknown>);
        return { text: 'ok' };
      },
      model: {} as never
    });

    await client.complete({
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal
    });

    expect(captured[0]?.['abortSignal']).toBe(controller.signal);
  });
});
