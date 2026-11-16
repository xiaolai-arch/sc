import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ConversationRunSnapshot } from '../../src/shared/butler-run';
import {
  ConversationRunStore,
  applyRunEvent,
  runToChatMessage,
  type ConversationRun
} from '../../src/renderer/shell/conversation-runs';

function startRun(store: ConversationRunStore, runId = 'a1', conversationId = 'c1') {
  return store.start({ runId, conversationId, assistantMessageId: runId, userText: '你好' });
}

function snapshot(overrides: Partial<ConversationRunSnapshot> = {}): ConversationRunSnapshot {
  return {
    runId: 'a1',
    conversationId: 'c1',
    assistantMessageId: 'a1',
    status: 'interrupted',
    sequence: 4,
    partialText: '这是已经收到的半段',
    reasoningText: '先看今天的任务',
    steps: [],
    startedAt: '2026-11-15T09:00:00.000Z',
    lastActivityAt: '2026-11-15T09:00:20.000Z',
    errorReason: '应用已退出，本次生成中断。',
    ...overrides
  };
}

describe('applyRunEvent', () => {
  test('orders reasoning, tools and text, and keeps narration in the trace', () => {
    let run: ConversationRun = startRun(new ConversationRunStore());
    run = applyRunEvent(run, { type: 'reasoning', text: '第一段' });
    run = applyRunEvent(run, {
      type: 'tool-start',
      id: 't1',
      name: 'write_note',
      label: '写入笔记'
    });
    run = applyRunEvent(run, {
      type: 'tool-result',
      id: 't1',
      name: 'write_note',
      ok: true,
      label: '写入笔记',
      detail: '已写入'
    });
    run = applyRunEvent(run, { type: 'narration', text: '我先记一下' });
    run = applyRunEvent(run, { type: 'text', text: '好的' });
    run = applyRunEvent(run, { type: 'done', text: '好的，已安排。' });

    expect(run.text).toBe('好的，已安排。');
    expect(run.phase).toBe('settling');
    expect(
      run.trace.map((item) =>
        item.kind === 'reasoning'
          ? { kind: item.kind, id: item.id, text: item.text, streaming: item.streaming }
          : item
      )
    ).toEqual([
      { kind: 'reasoning', id: 'trace-a1-pending', text: '第一段', streaming: false },
      {
        kind: 'tool',
        id: 't1',
        name: 'write_note',
        label: '写入笔记',
        status: 'done',
        detail: '已写入'
      },
      {
        kind: 'reasoning',
        id: 'trace-a1-2',
        text: '我先记一下',
        streaming: false
      }
    ]);
  });

  test('stamps the thinking clock once and keeps it across later events', () => {
    let run: ConversationRun = startRun(new ConversationRunStore());
    const startedAt = run.trace[0]?.kind === 'reasoning' ? run.trace[0].startedAt : undefined;
    expect(startedAt).toBeTypeOf('number');

    run = applyRunEvent(run, { type: 'reasoning', text: '第一段' });
    run = applyRunEvent(run, { type: 'reasoning', text: '第二段' });
    const reasoning = run.trace[0];
    expect(reasoning).toMatchObject({ kind: 'reasoning', startedAt, streaming: true });
    expect(reasoning?.kind === 'reasoning' ? reasoning.endedAt : 1).toBeUndefined();

    run = applyRunEvent(run, { type: 'text', text: '回答' });
    const settled = run.trace[0];
    expect(settled).toMatchObject({ kind: 'reasoning', streaming: false });
    expect(settled?.kind === 'reasoning' ? settled.endedAt : undefined).toBeTypeOf('number');
    expect(settled?.kind === 'reasoning' ? settled.startedAt : undefined).toBe(startedAt);
  });

  test('keeps retry messages until real content arrives', () => {
    let run: ConversationRun = startRun(new ConversationRunStore());
    run = applyRunEvent(run, { type: 'retry', attempt: 1, message: '网络不稳，重试中…' });
    expect(run.statusMessage).toBe('网络不稳，重试中…');
    run = applyRunEvent(run, { type: 'text', text: '继续' });
    expect(run.statusMessage).toBeNull();
  });

  test('marks un-finished tools as failed when the turn errors', () => {
    let run: ConversationRun = startRun(new ConversationRunStore());
    run = applyRunEvent(run, { type: 'tool-start', id: 't1', name: 'x', label: '执行' });
    run = applyRunEvent(run, { type: 'error', message: '网络断开' });
    expect(run.errorReason).toBe('网络断开');
    expect(
      run.trace.map((item) =>
        item.kind === 'reasoning'
          ? { kind: item.kind, id: item.id, text: item.text, streaming: item.streaming }
          : item
      )
    ).toEqual([
      { kind: 'reasoning', id: 'trace-a1-pending', text: '', streaming: false },
      { kind: 'tool', id: 't1', name: 'x', label: '执行', status: 'failed' }
    ]);
  });

  test('a canceled done keeps the partial text', () => {
    let run: ConversationRun = startRun(new ConversationRunStore());
    run = applyRunEvent(run, { type: 'text', text: '写到一半' });
    run = applyRunEvent(run, { type: 'done', text: '写到一半', canceled: true });
    expect(run.canceled).toBe(true);
    expect(run.text).toBe('写到一半');
  });
});

describe('ConversationRunStore', () => {
  test('publishes a placeholder immediately and one live run per conversation', () => {
    const store = new ConversationRunStore();
    startRun(store);
    expect(store.getSnapshot().runs).toHaveLength(1);
    expect(store.get('a1')?.phase).toBe('running');

    store.applyEvent('a1', { type: 'text', text: '半段' });
    store.flush();
    expect(store.get('a1')?.text).toBe('半段');

    // A new turn in the same conversation replaces the finished one.
    store.complete('a1');
    const next = startRun(store, 'a2', 'c1');
    expect(store.list().map((run) => run.runId)).toEqual(['a2']);
    expect(next.trace[0]).toMatchObject({ kind: 'reasoning', streaming: true });
  });

  test('cancel stops one run and leaves other conversations generating', async () => {
    const store = new ConversationRunStore();
    const api = {
      cancelStream: vi.fn(async () => undefined),
      cancelRun: vi.fn(async () => undefined)
    };
    // Install a fake bridge for this test only.
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { studyCoach: api };
    try {
      startRun(store, 'a1', 'c1');
      startRun(store, 'a2', 'c2');

      await expect(store.cancel('a1')).resolves.toBe(true);
      expect(store.get('a1')?.phase).toBe('stopping');
      expect(store.get('a2')?.phase).toBe('running');
      expect(api.cancelRun).toHaveBeenCalledWith('a1');
      expect(api.cancelStream).not.toHaveBeenCalled();
      expect(store.hasActive('c2')).toBe(true);
    } finally {
      if (previous === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = previous;
      }
    }
  });

  test('falls back to cancelStream when the bridge has no cancelRun', async () => {
    const store = new ConversationRunStore();
    const api = { cancelStream: vi.fn(async () => undefined) };
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { studyCoach: api };
    try {
      startRun(store, 'a1', 'c1');
      await store.cancel('a1');
      expect(api.cancelStream).toHaveBeenCalledWith('a1');
    } finally {
      if (previous === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = previous;
      }
    }
  });

  test('hydrate restores interrupted runs instead of pretending they still run', async () => {
    const store = new ConversationRunStore();
    await store.hydrate({
      cancelStream: async () => undefined,
      listConversationRuns: async () => [
        snapshot(),
        snapshot({ runId: 'a2', conversationId: 'c2', status: 'running' }),
        snapshot({ runId: 'a3', conversationId: 'c3', status: 'completed' })
      ]
    });

    const runs = store.list();
    expect(runs.map((run) => run.runId)).toEqual(['a1', 'a2']);
    expect(runs.every((run) => run.phase === 'interrupted')).toBe(true);
    expect(runs[0]?.text).toBe('这是已经收到的半段');
    expect(runs[0]?.trace[0]).toMatchObject({ kind: 'reasoning', streaming: false });
    expect(store.hasActive('c1')).toBe(false);
  });

  test('hydrate never overwrites a run this tab is already streaming', async () => {
    const store = new ConversationRunStore();
    startRun(store, 'a1', 'c1');
    store.applyEvent('a1', { type: 'text', text: '实时内容' });
    await store.hydrate({
      cancelStream: async () => undefined,
      listConversationRuns: async () => [snapshot({ partialText: '磁盘旧内容' })]
    });
    expect(store.get('a1')?.text).toBe('实时内容');
    expect(store.get('a1')?.phase).toBe('running');
  });

  test('clearSettled drops finished markers but keeps live runs', () => {
    const store = new ConversationRunStore();
    startRun(store, 'a1', 'c1');
    store.complete('a1');
    startRun(store, 'a2', 'c1');
    store.clearSettled('c1');
    expect(store.list().map((run) => run.runId)).toEqual(['a2']);
  });
});

describe('runToChatMessage', () => {
  test('renders the live answer and labels an interrupted run', () => {
    const store = new ConversationRunStore();
    startRun(store);
    store.applyEvent('a1', { type: 'text', text: '半段' });
    const live = runToChatMessage(store.get('a1')!);
    expect(live).toMatchObject({ id: 'a1', role: 'assistant', text: '半段', streaming: true });
    expect(live.notice).toBeUndefined();

    const interrupted: ConversationRun = {
      ...store.get('a1')!,
      phase: 'interrupted',
      errorReason: '应用已退出，本次生成中断。'
    };
    const restored = runToChatMessage(interrupted);
    expect(restored.streaming).toBe(false);
    expect(restored.notice).toBe('应用已退出，本次生成中断。');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
