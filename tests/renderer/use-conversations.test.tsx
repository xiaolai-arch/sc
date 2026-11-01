// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Conversation } from '../../src/shared/conversations';
import { useConversations } from '../../src/renderer/shell/useConversations';

function conversation(id: string): Conversation {
  return {
    id,
    title: id,
    kind: 'chat',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    messages: []
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test('a slow selection cannot overwrite a newer one', async () => {
  const slow = deferred<Conversation>();
  const fast = deferred<Conversation>();
  window.studyCoach = {
    listConversations: async () => [],
    getConversation: (id: string) =>
      id === 'slow' ? slow.promise : fast.promise
  } as never;

  const { result } = renderHook(() => useConversations());
  await waitFor(() => expect(result.current.loading).toBe(false));

  act(() => {
    void result.current.select('slow');
    void result.current.select('fast');
  });
  await act(async () => {
    fast.resolve(conversation('fast'));
    await fast.promise;
  });
  expect(result.current.active?.id).toBe('fast');

  await act(async () => {
    slow.resolve(conversation('slow'));
    await slow.promise;
  });
  expect(result.current.active?.id).toBe('fast');
});

test('tray/notification opens are surfaced for the renderer to switch pages', async () => {
  let openListener: ((id: string) => void) | undefined;
  window.studyCoach = {
    listConversations: async () => [],
    getConversation: async (id: string) => conversation(id),
    onConversationOpened: (listener: (id: string) => void) => {
      openListener = listener;
      return () => undefined;
    }
  } as never;

  const { result } = renderHook(() => useConversations());
  await waitFor(() => expect(result.current.loading).toBe(false));

  act(() => openListener?.('check-in-1'));
  await waitFor(() => expect(result.current.active?.id).toBe('check-in-1'));
  expect(result.current.externalOpen).toEqual({ id: 'check-in-1', seq: 1 });
});
