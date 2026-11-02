// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import {
  KNOWLEDGE_NOTE_CONFLICT_MESSAGE,
  type KnowledgeBacklink,
  type KnowledgeNote
} from '../../src/shared/knowledge';
import {
  clearKnowledgeNoteDrafts,
  useKnowledgeNote
} from '../../src/renderer/shell/useKnowledgeNote';

function note(topicId: string, body: string): KnowledgeNote {
  return { topicId, body, updatedAt: '' };
}

function revisionedNote(topicId: string, body: string, revision: string): KnowledgeNote {
  return { topicId, body, updatedAt: '', revision };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
  });
}

function setup(overrides: {
  getNote?: (topicId: string) => Promise<KnowledgeNote>;
  saveNote?: (input: { topicId: string; body: string }) => Promise<KnowledgeNote>;
  getBacklinks?: (topicId: string) => Promise<KnowledgeBacklink[]>;
  topicId?: string;
} = {}) {
  const getNote = vi.fn(overrides.getNote ?? (async (topicId: string) => note(topicId, 'disk')));
  const saveNote = vi.fn(
    overrides.saveNote ?? (async (input: { topicId: string; body: string }) => note(input.topicId, input.body))
  );
  const getBacklinks = vi.fn(overrides.getBacklinks ?? (async () => []));
  const hook = renderHook(
    ({ topicId }: { topicId: string }) =>
      useKnowledgeNote({
        topicId,
        getNote,
        saveNote,
        getBacklinks,
        debounceMs: 600
      }),
    { initialProps: { topicId: overrides.topicId ?? 'kt-1' } }
  );
  return { ...hook, getNote, saveNote, getBacklinks };
}

beforeEach(() => {
  clearKnowledgeNoteDrafts();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('loads the note and backlinks for the selected topic', async () => {
  const { result } = setup({
    getBacklinks: async () => [{ topicId: 'kt-2', name: 'B' }]
  });

  await settle();

  expect(result.current.body).toBe('disk');
  expect(result.current.status).toBe('saved');
  expect(result.current.backlinks).toEqual([{ topicId: 'kt-2', name: 'B' }]);
});

test('debounces typing and saves once with the latest body', async () => {
  const { result, saveNote } = setup();
  await settle();

  act(() => {
    result.current.setBody('a');
    result.current.setBody('ab');
  });
  expect(result.current.status).toBe('dirty');

  await act(async () => {
    await vi.advanceTimersByTimeAsync(599);
  });
  expect(saveNote).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(saveNote).toHaveBeenCalledTimes(1);
  expect(saveNote).toHaveBeenCalledWith({ topicId: 'kt-1', body: 'ab' });

  await settle();
  expect(result.current.status).toBe('saved');
});

test('switching topics awaits the previous save before loading the new note', async () => {
  const pending = deferred<KnowledgeNote>();
  const getNote = vi.fn(async (topicId: string) => note(topicId, topicId === 'kt-1' ? 'A' : 'B'));
  const saveNote = vi.fn(() => pending.promise);
  const { result, rerender } = renderHook(
    ({ topicId }: { topicId: string }) =>
      useKnowledgeNote({ topicId, getNote, saveNote, getBacklinks: async () => [] }),
    { initialProps: { topicId: 'kt-1' } }
  );
  await settle();

  act(() => result.current.setBody('draft A'));
  rerender({ topicId: 'kt-2' });
  await settle();

  expect(saveNote).toHaveBeenCalledWith({ topicId: 'kt-1', body: 'draft A' });
  expect(getNote).not.toHaveBeenCalledWith('kt-2');

  await act(async () => {
    pending.resolve(note('kt-1', 'draft A'));
    await Promise.resolve();
  });
  await settle();

  expect(getNote).toHaveBeenCalledWith('kt-2');
  expect(result.current.body).toBe('B');
});

test('keeps an unsaved draft when saving fails and restores it on return', async () => {
  const getNote = vi.fn(async (topicId: string) => note(topicId, `disk ${topicId}`));
  const saveNote = vi.fn(async () => {
    throw new Error('disk full');
  });
  const { result, rerender } = renderHook(
    ({ topicId }: { topicId: string }) =>
      useKnowledgeNote({ topicId, getNote, saveNote, getBacklinks: async () => [] }),
    { initialProps: { topicId: 'kt-1' } }
  );
  await settle();

  act(() => result.current.setBody('draft'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  await settle();
  expect(result.current.status).toBe('error');
  expect(result.current.error).toBeTruthy();

  rerender({ topicId: 'kt-2' });
  await settle();
  expect(result.current.body).toBe('disk kt-2');

  rerender({ topicId: 'kt-1' });
  await settle();
  expect(result.current.body).toBe('draft');
  expect(result.current.status).toBe('error');

  await act(async () => {
    await result.current.retrySave();
  });
  await settle();
  expect(saveNote).toHaveBeenLastCalledWith({ topicId: 'kt-1', body: 'draft' });
});

test('shows and retries a note load failure', async () => {
  const getNote = vi
    .fn()
    .mockRejectedValueOnce(new Error('missing'))
    .mockResolvedValue(note('kt-1', 'recovered'));
  const { result } = setup({ getNote });

  await settle();
  expect(result.current.loadError).toBeTruthy();
  expect(result.current.body).toBe('');

  await act(async () => {
    await result.current.reloadNote();
  });
  await settle();
  expect(result.current.loadError).toBeNull();
  expect(result.current.body).toBe('recovered');
});

test('ignores a stale load that resolves after switching topics', async () => {
  const slowA = deferred<KnowledgeNote>();
  const fastB = deferred<KnowledgeNote>();
  const getNote = vi.fn((topicId: string) => (topicId === 'kt-1' ? slowA.promise : fastB.promise));
  const { result, rerender } = renderHook(
    ({ topicId }: { topicId: string }) =>
      useKnowledgeNote({ topicId, getNote, saveNote: async () => note(topicId, ''), getBacklinks: async () => [] }),
    { initialProps: { topicId: 'kt-1' } }
  );

  rerender({ topicId: 'kt-2' });
  await act(async () => {
    fastB.resolve(note('kt-2', 'B'));
    await Promise.resolve();
  });
  await settle();
  expect(result.current.body).toBe('B');

  await act(async () => {
    slowA.resolve(note('kt-1', 'late A'));
    await Promise.resolve();
  });
  await settle();
  expect(result.current.body).toBe('B');
});

test('does not save when the body is unchanged', async () => {
  const { result, saveNote } = setup();
  await settle();

  act(() => result.current.setBody('disk'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  await settle();

  expect(saveNote).not.toHaveBeenCalled();
  expect(result.current.status).toBe('saved');
});

test('flush saves immediately and clears the debounce timer', async () => {
  const { result, saveNote } = setup();
  await settle();

  act(() => result.current.setBody('quick'));
  await act(async () => {
    await result.current.flush();
  });
  await settle();
  expect(saveNote).toHaveBeenCalledTimes(1);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  expect(saveNote).toHaveBeenCalledTimes(1);
});

test('unmounting flushes the pending draft', async () => {
  const { result, unmount, saveNote } = setup();
  await settle();

  act(() => result.current.setBody('bye'));
  unmount();
  await settle();

  expect(saveNote).toHaveBeenCalledWith({ topicId: 'kt-1', body: 'bye' });
});

test('a second switch never saves one topic draft under another', async () => {
  const pending = deferred<KnowledgeNote>();
  const getNote = vi.fn(async (topicId: string) => note(topicId, `disk ${topicId}`));
  const saveNote = vi.fn(() => pending.promise);
  const { result, rerender } = renderHook(
    ({ topicId }: { topicId: string }) =>
      useKnowledgeNote({ topicId, getNote, saveNote, getBacklinks: async () => [] }),
    { initialProps: { topicId: 'kt-1' } }
  );
  await settle();

  act(() => result.current.setBody('A draft'));
  rerender({ topicId: 'kt-2' });
  await settle();
  // The new topic is not readable or writable until its own body arrives.
  expect(result.current.status).toBe('loading');

  rerender({ topicId: 'kt-1' });
  await settle();

  expect(saveNote).toHaveBeenCalledTimes(1);
  expect(saveNote).toHaveBeenCalledWith({ topicId: 'kt-1', body: 'A draft' });

  await act(async () => {
    pending.resolve(note('kt-1', 'A draft'));
    await Promise.resolve();
  });
  await settle();
  expect(result.current.body).toBe('A draft');
});

test('typing during the outgoing save is not attributed to the new topic', async () => {
  const pending = deferred<KnowledgeNote>();
  const getNote = vi.fn(async (topicId: string) => note(topicId, topicId === 'kt-1' ? 'A' : 'B'));
  const saveNote = vi.fn(() => pending.promise);
  const { result, rerender } = renderHook(
    ({ topicId }: { topicId: string }) =>
      useKnowledgeNote({ topicId, getNote, saveNote, getBacklinks: async () => [] }),
    { initialProps: { topicId: 'kt-1' } }
  );
  await settle();

  act(() => result.current.setBody('A draft'));
  rerender({ topicId: 'kt-2' });
  await settle();

  act(() => result.current.setBody('typed over the loading pane'));
  expect(result.current.body).toBe('');

  await act(async () => {
    pending.resolve(note('kt-1', 'A draft'));
    await Promise.resolve();
  });
  await settle();

  expect(result.current.body).toBe('B');
  expect(saveNote).toHaveBeenCalledTimes(1);
  expect(saveNote).toHaveBeenCalledWith({ topicId: 'kt-1', body: 'A draft' });
});

test('unmounting during a switch does not save the old draft under the new topic', async () => {
  const pending = deferred<KnowledgeNote>();
  const getNote = vi.fn(async (topicId: string) => note(topicId, `disk ${topicId}`));
  const saveNote = vi.fn(() => pending.promise);
  const { result, rerender, unmount } = renderHook(
    ({ topicId }: { topicId: string }) =>
      useKnowledgeNote({ topicId, getNote, saveNote, getBacklinks: async () => [] }),
    { initialProps: { topicId: 'kt-1' } }
  );
  await settle();

  act(() => result.current.setBody('A draft'));
  rerender({ topicId: 'kt-2' });
  unmount();
  await settle();

  expect(saveNote).toHaveBeenCalledTimes(1);
  expect(saveNote).toHaveBeenCalledWith({ topicId: 'kt-1', body: 'A draft' });
});

test('keeps a failed draft across an unmount and remount', async () => {
  const getNote = vi.fn(async (topicId: string) => note(topicId, 'disk'));
  const saveNote = vi.fn(async () => {
    throw new Error('disk full');
  });
  const first = renderHook(() =>
    useKnowledgeNote({ topicId: 'kt-1', getNote, saveNote, getBacklinks: async () => [] })
  );
  await settle();

  act(() => first.result.current.setBody('survives'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  await settle();
  expect(first.result.current.status).toBe('error');
  first.unmount();
  await settle();

  const second = renderHook(() =>
    useKnowledgeNote({ topicId: 'kt-1', getNote, saveNote, getBacklinks: async () => [] })
  );
  await settle();

  expect(second.result.current.body).toBe('survives');
  expect(second.result.current.status).toBe('error');
});

test('sends the loaded revision with each save', async () => {
  const { result, saveNote } = setup({
    getNote: async (topicId: string) => revisionedNote(topicId, 'disk', 'rev-1')
  });
  await settle();

  act(() => result.current.setBody('typed'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  await settle();

  expect(saveNote).toHaveBeenCalledWith({
    topicId: 'kt-1',
    body: 'typed',
    expectedRevision: 'rev-1'
  });
});

test('a conflict stops autosave and keeps the draft', async () => {
  const getNote = async (topicId: string) => revisionedNote(topicId, 'disk', 'rev-1');
  const saveNote = vi.fn(async () => {
    throw new Error(KNOWLEDGE_NOTE_CONFLICT_MESSAGE);
  });
  const { result } = setup({ getNote, saveNote });
  await settle();

  act(() => result.current.setBody('mine'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  await settle();

  expect(saveNote).toHaveBeenCalledWith({
    topicId: 'kt-1',
    body: 'mine',
    expectedRevision: 'rev-1'
  });
  expect(result.current.status).toBe('conflict');
  expect(result.current.conflict).toBe(true);
  expect(result.current.body).toBe('mine');

  act(() => result.current.setBody('mine again'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  await settle();

  expect(saveNote).toHaveBeenCalledTimes(1);
  expect(result.current.status).toBe('conflict');
  expect(result.current.body).toBe('mine again');
});

test('overwriteConflict force-saves and adopts the new revision', async () => {
  const getNote = async (topicId: string) => revisionedNote(topicId, 'disk', 'rev-1');
  const saveNote = vi
    .fn()
    .mockRejectedValueOnce(new Error(KNOWLEDGE_NOTE_CONFLICT_MESSAGE))
    .mockImplementation(async (input: { topicId: string; body: string }) =>
      revisionedNote(input.topicId, input.body, 'rev-2')
    );
  const { result } = setup({ getNote, saveNote });
  await settle();

  act(() => result.current.setBody('mine'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  await settle();
  expect(result.current.status).toBe('conflict');

  await act(async () => {
    await result.current.overwriteConflict();
  });
  await settle();

  expect(saveNote).toHaveBeenLastCalledWith({
    topicId: 'kt-1',
    body: 'mine',
    expectedRevision: 'rev-1',
    force: true
  });
  expect(result.current.status).toBe('saved');
  expect(result.current.conflict).toBe(false);

  act(() => result.current.setBody('next'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  await settle();

  expect(saveNote).toHaveBeenLastCalledWith({
    topicId: 'kt-1',
    body: 'next',
    expectedRevision: 'rev-2'
  });
});

test('a conflicted draft survives a topic switch without being auto-saved', async () => {
  const getNote = vi.fn(async (topicId: string) =>
    revisionedNote(topicId, `disk ${topicId}`, `rev-${topicId}`)
  );
  const saveNote = vi.fn(async () => {
    throw new Error(KNOWLEDGE_NOTE_CONFLICT_MESSAGE);
  });
  const { result, rerender } = renderHook(
    ({ topicId }: { topicId: string }) =>
      useKnowledgeNote({ topicId, getNote, saveNote, getBacklinks: async () => [] }),
    { initialProps: { topicId: 'kt-1' } }
  );
  await settle();

  act(() => result.current.setBody('A draft'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  await settle();
  expect(result.current.status).toBe('conflict');

  rerender({ topicId: 'kt-2' });
  await settle();
  expect(result.current.body).toBe('disk kt-2');
  expect(saveNote).toHaveBeenCalledTimes(1);

  rerender({ topicId: 'kt-1' });
  await settle();
  expect(result.current.body).toBe('A draft');
  expect(result.current.status).toBe('conflict');
  expect(result.current.conflict).toBe(true);
  expect(saveNote).toHaveBeenCalledTimes(1);
});

test('reloading after a conflict shows the disk body and clears the draft', async () => {
  const getNote = vi
    .fn()
    .mockResolvedValueOnce(revisionedNote('kt-1', 'disk', 'rev-1'))
    .mockResolvedValue(revisionedNote('kt-1', 'from obsidian', 'rev-2'));
  const saveNote = vi.fn(async () => {
    throw new Error(KNOWLEDGE_NOTE_CONFLICT_MESSAGE);
  });
  const { result, rerender } = renderHook(
    ({ topicId }: { topicId: string }) =>
      useKnowledgeNote({ topicId, getNote, saveNote, getBacklinks: async () => [] }),
    { initialProps: { topicId: 'kt-1' } }
  );
  await settle();

  act(() => result.current.setBody('draft'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
  await settle();
  expect(result.current.status).toBe('conflict');

  await act(async () => {
    await result.current.reloadNote();
  });
  await settle();

  expect(result.current.body).toBe('from obsidian');
  expect(result.current.status).toBe('saved');
  expect(result.current.conflict).toBe(false);

  rerender({ topicId: 'kt-2' });
  await settle();
  rerender({ topicId: 'kt-1' });
  await settle();
  expect(result.current.body).toBe('from obsidian');
});
