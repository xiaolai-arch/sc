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

test('clears the previous conversation while the next one loads', async () => {
  const pending = deferred<Conversation>();
  window.studyCoach = {
    listConversations: async () => [],
    getConversation: (id: string) =>
      id === 'a' ? Promise.resolve(conversation('a')) : pending.promise
  } as never;

  const { result } = renderHook(() => useConversations());
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(async () => {
    await result.current.select('a');
  });
  expect(result.current.active?.id).toBe('a');
  expect(result.current.selecting).toBe(false);

  act(() => {
    void result.current.select('b');
  });
  // The old thread must not stay visible or sendable while 'b' loads.
  expect(result.current.active).toBeNull();
  expect(result.current.selecting).toBe(true);

  await act(async () => {
    pending.resolve(conversation('b'));
    await pending.promise;
  });
  expect(result.current.active?.id).toBe('b');
  expect(result.current.selecting).toBe(false);

  // Re-selecting the open conversation (e.g. reload after a turn) does not
  // blank the view.
  await act(async () => {
    await result.current.select('b');
  });
  expect(result.current.active?.id).toBe('b');
});

test('a failed switch restores the conversation that was open', async () => {
  window.studyCoach = {
    listConversations: async () => [],
    getConversation: async (id: string) => {
      if (id === 'gone') throw new Error('missing');
      return conversation(id);
    }
  } as never;

  const { result } = renderHook(() => useConversations());
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    await result.current.select('a');
  });
  expect(result.current.active?.id).toBe('a');

  await act(async () => {
    await result.current.select('gone');
  });
  // The composer must not be left on an empty draft that a send would fill
  // into the wrong conversation.
  expect(result.current.active?.id).toBe('a');
  expect(result.current.selecting).toBe(false);
  expect(result.current.error).toBeTruthy();
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
  await waitFor(() =>
    expect(result.current.externalOpen).toEqual({ id: 'check-in-1', seq: 1 })
  );
  // The hook only announces the request; the renderer selects it after its
  // unsaved-settings guard, so cancelling that prompt also cancels the jump.
  expect(result.current.active).toBeNull();

  await act(async () => {
    await result.current.select('check-in-1');
  });
  expect(result.current.active?.id).toBe('check-in-1');
});

test('a main-process conversation change refreshes the sidebar summaries', async () => {
  // item 66 P2-6: a proactive check-in the main process created must reach
  // the sidebar. The hook re-reads the summaries on the `changed` event and
  // never touches the open conversation.
  let changedListener: ((id: string) => void) | undefined;
  let unsubscribed = false;
  const summaries = [
    {
      id: 'check-in-1',
      title: '今天的检查',
      kind: 'check-in' as const,
      updatedAt: '2026-11-01T08:05:00.000Z',
      preview: '早上好'
    }
  ];
  const listConversations = vi
    .fn<() => Promise<unknown>>()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(summaries);
  window.studyCoach = {
    listConversations,
    getConversation: async (id: string) => conversation(id),
    onConversationOpened: () => () => undefined,
    onConversationChanged: (listener: (id: string) => void) => {
      changedListener = listener;
      return () => {
        unsubscribed = true;
      };
    }
  } as never;

  const { result } = renderHook(() => useConversations());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.summaries).toEqual([]);

  act(() => changedListener?.('check-in-1'));

  await waitFor(() => expect(result.current.summaries).toHaveLength(1));
  expect(result.current.summaries[0]?.id).toBe('check-in-1');
  expect(listConversations).toHaveBeenCalledTimes(2);
  // The open conversation is left alone — a refresh never steals focus.
  expect(result.current.active).toBeNull();
  // The subscription follows the component lifecycle.
  expect(unsubscribed).toBe(false);
});
