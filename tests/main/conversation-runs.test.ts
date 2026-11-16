import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  ConversationRunStore,
  RUN_INTERRUPTED_MESSAGE
} from '../../src/main/butler/conversation-runs';

const dirs: string[] = [];

async function tempStore(): Promise<{
  store: ConversationRunStore;
  filePath: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-runs-'));
  dirs.push(dir);
  const filePath = join(dir, 'conversation-runs.json');
  return {
    store: new ConversationRunStore({ filePath, persistDelayMs: 5 }),
    filePath,
    cleanup: () => rm(dir, { recursive: true, force: true })
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('tracks text, reasoning, tools and removes the run when finished', async () => {
  const store = new ConversationRunStore();
  const controller = await store.begin({
    runId: 'a1',
    conversationId: 'c1',
    assistantMessageId: 'a1'
  });

  store.update('a1', { type: 'reasoning', text: '先看目标' });
  store.update('a1', { type: 'text', text: '好的' });
  store.update('a1', { type: 'tool-start', id: 't1', name: 'create_task', label: '创建任务' });
  store.update('a1', { type: 'tool-result', id: 't1', name: 'create_task', ok: true, label: '创建任务', detail: '已创建' });
  store.update('a1', { type: 'text', text: '，已安排。' });

  const [run] = await store.list();
  expect(run).toMatchObject({
    runId: 'a1',
    conversationId: 'c1',
    status: 'running',
    partialText: '好的，已安排。',
    reasoningText: '先看目标',
    sequence: 5
  });
  expect(run?.steps).toEqual([
    {
      id: 't1',
      name: 'create_task',
      label: '创建任务',
      status: 'done',
      detail: '已创建'
    }
  ]);

  store.update('a1', { type: 'done', text: '好的，已安排。' });
  await store.finish('a1');
  expect(await store.list()).toEqual([]);
  expect(controller.signal.aborted).toBe(false);
});

test('cancel aborts only the targeted run and keeps partial output until done', async () => {
  const store = new ConversationRunStore();
  const first = await store.begin({ runId: 'a1', conversationId: 'c1', assistantMessageId: 'a1' });
  const second = await store.begin({ runId: 'a2', conversationId: 'c2', assistantMessageId: 'a2' });
  store.update('a1', { type: 'text', text: '写到一半' });

  expect(await store.cancel('a1')).toBe(true);
  expect(first.signal.aborted).toBe(true);
  expect(second.signal.aborted).toBe(false);
  const [run] = await store.list();
  expect(run).toMatchObject({ runId: 'a1', partialText: '写到一半', status: 'waiting' });

  store.update('a1', { type: 'done', text: '写到一半', canceled: true });
  await store.finish('a1');
  expect((await store.list()).map((entry) => entry.runId)).toEqual(['a2']);
});

test('recovers an active run as interrupted after a restart', async () => {
  const { store, filePath } = await tempStore();
  await store.begin({ runId: 'a1', conversationId: 'c1', assistantMessageId: 'a1' });
  store.update('a1', { type: 'reasoning', text: '查了资料' });
  store.update('a1', { type: 'text', text: '这是已经收到的半段' });
  store.update('a1', { type: 'tool-start', id: 't1', name: 'write_note', label: '写入笔记' });
  await store.flush();

  const restarted = new ConversationRunStore({ filePath });
  const [run] = await restarted.list();
  expect(run).toMatchObject({
    runId: 'a1',
    conversationId: 'c1',
    status: 'interrupted',
    errorReason: RUN_INTERRUPTED_MESSAGE,
    partialText: '这是已经收到的半段',
    reasoningText: '查了资料'
  });
  expect(run?.steps[0]?.status).toBe('running');
  expect(run?.steps[0]?.label).toBe('写入笔记');
});

test('a new turn in the same conversation clears interrupted leftovers', async () => {
  const { store, filePath } = await tempStore();
  await store.begin({ runId: 'a1', conversationId: 'c1', assistantMessageId: 'a1' });
  store.update('a1', { type: 'text', text: '旧内容' });
  await store.flush();

  const restarted = new ConversationRunStore({ filePath });
  expect((await restarted.list())[0]?.status).toBe('interrupted');

  await restarted.begin({ runId: 'a2', conversationId: 'c1', assistantMessageId: 'a2' });
  const runs = await restarted.list();
  expect(runs.map((run) => run.runId)).toEqual(['a2']);
});

test('failed runs are removed and never reported as active', async () => {
  const store = new ConversationRunStore();
  await store.begin({ runId: 'a1', conversationId: 'c1', assistantMessageId: 'a1' });
  await store.fail('a1', 'provider exploded');
  expect(await store.list()).toEqual([]);
  expect(await store.cancel('a1')).toBe(false);
});

test('dismiss removes an interrupted run', async () => {
  const { store, filePath } = await tempStore();
  await store.begin({ runId: 'a1', conversationId: 'c1', assistantMessageId: 'a1' });
  await store.flush();
  const restarted = new ConversationRunStore({ filePath });
  await restarted.dismiss('a1');
  expect(await restarted.list()).toEqual([]);
});
