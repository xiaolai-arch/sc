import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationStore } from '../../src/main/conversations/conversation-store';
import type { ConversationMessage } from '../../src/shared/conversations';

function message(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  createdAt: string
): ConversationMessage {
  return { id, role, text, createdAt };
}

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'study-coach-conversations-'));
}

test('creates a conversation and filters empty ones from the list', async () => {
  const dir = await tempDir();
  const store = new ConversationStore(dir, {
    now: () => new Date('2026-11-01T09:00:00.000Z')
  });

  const created = await store.create();
  expect(created.title).toBe('新对话');
  expect(created.kind).toBe('chat');
  expect(created.messages).toEqual([]);
  expect(await store.list()).toEqual([]);
  expect((await store.get(created.id))?.id).toBe(created.id);
});

test('uses the first user message as the title and summary preview', async () => {
  const dir = await tempDir();
  const store = new ConversationStore(dir, {
    now: () => new Date('2026-11-01T09:00:00.000Z')
  });
  const created = await store.create();
  const text = '我想考研，计算机 408，每天四小时';
  const updated = await store.appendMessage(
    created.id,
    message('m1', 'user', text, '2026-11-01T09:01:00.000Z')
  );

  const expectedTitle = Array.from(text).slice(0, 24).join('');
  expect(updated.title).toBe(expectedTitle);
  const summaries = await store.list();
  expect(summaries).toHaveLength(1);
  expect(summaries[0]).toMatchObject({
    id: created.id,
    title: expectedTitle,
    kind: 'chat',
    preview: text
  });
});

test('persists assistant steps and check-in triggers', async () => {
  const dir = await tempDir();
  const store = new ConversationStore(dir, {
    now: () => new Date('2026-11-01T09:00:00.000Z')
  });
  const created = await store.create();
  await store.appendMessage(
    created.id,
    message('m1', 'user', '我想考研', '2026-11-01T09:01:00.000Z')
  );
  const updated = await store.appendMessage(created.id, {
    id: 'm2',
    role: 'assistant',
    text: '已创建考研项目。',
    createdAt: '2026-11-01T09:02:00.000Z',
    source: 'check-in',
    trigger: 'morning',
    steps: [
      {
        id: 's1',
        name: 'create_workspace',
        label: '创建项目',
        status: 'done',
        detail: '考研'
      }
    ]
  });

  expect(updated.messages).toHaveLength(2);
  expect(updated.messages[1]).toMatchObject({
    trigger: 'morning',
    source: 'check-in',
    steps: [{ name: 'create_workspace', status: 'done' }]
  });
  const fetched = await store.get(created.id);
  expect(fetched?.messages[1]?.steps?.[0]?.label).toBe('创建项目');
});

test('links a workspace without losing messages', async () => {
  const dir = await tempDir();
  const store = new ConversationStore(dir, {
    now: () => new Date('2026-11-01T09:00:00.000Z')
  });
  const created = await store.create();
  await store.appendMessage(
    created.id,
    message('m1', 'user', '我想考研', '2026-11-01T09:01:00.000Z')
  );

  const linked = await store.linkWorkspace(created.id, 'kaoyan');
  expect(linked.workspaceId).toBe('kaoyan');
  expect(linked.messages).toHaveLength(1);
  expect((await store.get(created.id))?.workspaceId).toBe('kaoyan');
  expect((await store.list())[0]?.workspaceId).toBe('kaoyan');
});

test('updates and deletes conversations', async () => {
  const dir = await tempDir();
  const store = new ConversationStore(dir, {
    now: () => new Date('2026-11-01T09:00:00.000Z')
  });
  const created = await store.create();
  await store.appendMessage(
    created.id,
    message('m1', 'user', '你好', '2026-11-01T09:01:00.000Z')
  );

  const updated = await store.update(created.id, (conversation) => ({
    ...conversation,
    title: '改过的标题'
  }));
  expect(updated.title).toBe('改过的标题');

  await store.delete(created.id);
  expect(await store.get(created.id)).toBeNull();
  expect(await store.list()).toEqual([]);
});

test('sorts summaries by updatedAt, newest first', async () => {
  const dir = await tempDir();
  let now = new Date('2026-11-01T09:00:00.000Z');
  const store = new ConversationStore(dir, { now: () => now });
  const first = await store.create();
  await store.appendMessage(
    first.id,
    message('m1', 'user', '第一条', '2026-11-01T09:01:00.000Z')
  );
  now = new Date('2026-11-01T10:00:00.000Z');
  const second = await store.create();
  await store.appendMessage(
    second.id,
    message('m2', 'user', '第二条', '2026-11-01T10:01:00.000Z')
  );

  const summaries = await store.list();
  expect(summaries.map((summary) => summary.id)).toEqual([second.id, first.id]);
});

test('ignores corrupt conversation files and rejects unsafe ids', async () => {
  const dir = await tempDir();
  const store = new ConversationStore(dir);
  await writeFile(join(dir, 'broken.json'), '{not json', 'utf8');

  expect(await store.list()).toEqual([]);
  expect(await store.get('broken')).toBeNull();
  await expect(store.get('../outside')).rejects.toThrow(/invalid/i);
  expect(await readFile(join(dir, 'broken.json'), 'utf8')).toBe('{not json');
});

test('two stores on the same directory see each other writes', async () => {
  const dir = await tempDir();
  const first = new ConversationStore(dir);
  const second = new ConversationStore(dir);
  const created = await first.create();
  await first.appendMessage(
    created.id,
    message('m1', 'user', '共享对话', '2026-11-01T09:01:00.000Z')
  );

  const summaries = await second.list();
  expect(summaries).toHaveLength(1);
  expect(summaries[0]?.id).toBe(created.id);
});

test('writes conversation files with owner-only permissions', async () => {
  const dir = await tempDir();
  const store = new ConversationStore(dir);
  const created = await store.create();
  const stats = await stat(join(dir, `${created.id}.json`));
  expect(stats.mode & 0o777).toBe(0o600);
});
