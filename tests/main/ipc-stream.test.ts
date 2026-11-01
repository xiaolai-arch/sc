import type { StudyCoachApi } from '../../src/shared/ipc';
import {
  BUTLER_STREAM_CHANNELS,
  createButlerStreamHandler,
  type IpcEventLike
} from '../../src/main/ipc';

type Sent = { channel: string; payload: unknown };

function sender(destroyed = false) {
  const sent: Sent[] = [];
  const event: IpcEventLike = {
    sender: {
      send(channel, payload) {
        sent.push({ channel, payload });
      },
      isDestroyed: () => destroyed
    }
  };
  return { event, sent };
}

test('streams events with the caller requestId and returns the final result', async () => {
  const api = {
    async stream(_input: unknown, onEvent: (event: unknown) => void) {
      onEvent({ type: 'reasoning', text: '想' });
      onEvent({ type: 'done', text: '答' });
      return { text: '答' };
    }
  } as unknown as StudyCoachApi;
  const handler = createButlerStreamHandler(api);
  const { event, sent } = sender();

  const result = await handler(event, {
    requestId: 'req-1',
    input: { message: '你好' }
  });

  expect(result).toEqual({ text: '答' });
  expect(sent).toEqual([
    {
      channel: BUTLER_STREAM_CHANNELS.event,
      payload: { requestId: 'req-1', event: { type: 'reasoning', text: '想' } }
    },
    {
      channel: BUTLER_STREAM_CHANNELS.event,
      payload: { requestId: 'req-1', event: { type: 'done', text: '答' } }
    }
  ]);
});

test('sends a sanitized error event before rejecting', async () => {
  const api = {
    async stream() {
      throw new Error('sk-test-secret exploded');
    }
  } as unknown as StudyCoachApi;
  const handler = createButlerStreamHandler(api);
  const { event, sent } = sender();

  await expect(
    handler(event, { requestId: 'req-2', input: { message: '你好' } })
  ).rejects.toThrow(/\[redacted\]/);

  expect(sent).toHaveLength(1);
  expect(sent[0]?.payload).toMatchObject({
    requestId: 'req-2',
    event: { type: 'error', message: expect.stringContaining('[redacted]') }
  });
});

test('rejects an invalid request payload without starting a stream', async () => {
  const api = {
    async stream() {
      throw new Error('should not be called');
    }
  } as unknown as StudyCoachApi;
  const handler = createButlerStreamHandler(api);
  const { event, sent } = sender();

  await expect(handler(event, { input: { message: '你好' } })).rejects.toThrow(/请求 ID/);
  await expect(handler(event, { requestId: 'req-3', input: {} })).rejects.toThrow(/消息内容/);
  expect(sent).toHaveLength(0);
});

test('skips events when the sender is already destroyed', async () => {
  const api = {
    async stream(_input: unknown, onEvent: (event: unknown) => void) {
      onEvent({ type: 'text', text: '答' });
      return { text: '答' };
    }
  } as unknown as StudyCoachApi;
  const handler = createButlerStreamHandler(api);
  const { event, sent } = sender(true);

  await expect(
    handler(event, { requestId: 'req-4', input: { message: '你好' } })
  ).resolves.toEqual({ text: '答' });
  expect(sent).toHaveLength(0);
});
