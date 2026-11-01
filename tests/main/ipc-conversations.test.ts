import type { StudyCoachApi } from '../../src/shared/ipc';
import { createIpcHandlers } from '../../src/main/ipc';

function fakeApi(): { api: StudyCoachApi; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const api = {
    async listConversations() {
      calls.push(['list']);
      return [];
    },
    async getConversation(id: string) {
      calls.push(['get', id]);
      return null;
    },
    async createConversation(input: unknown) {
      calls.push(['create', input]);
      return {
        id: 'c1',
        title: '新对话',
        kind: 'chat',
        createdAt: '2026-11-01T09:00:00.000Z',
        updatedAt: '2026-11-01T09:00:00.000Z',
        messages: []
      };
    },
    async appendConversationMessage(id: string, message: unknown) {
      calls.push(['append', id, message]);
      return {
        id,
        title: '新对话',
        kind: 'chat',
        createdAt: '2026-11-01T09:00:00.000Z',
        updatedAt: '2026-11-01T09:00:00.000Z',
        messages: []
      };
    },
    async deleteConversation(id: string) {
      calls.push(['delete', id]);
    },
    async renameConversation(id: string, title: string) {
      calls.push(['rename', id, title]);
      return {
        id,
        title,
        kind: 'chat',
        createdAt: '2026-11-01T09:00:00.000Z',
        updatedAt: '2026-11-01T09:00:00.000Z',
        messages: []
      };
    },
    async setConversationPinned(id: string, pinned: boolean) {
      calls.push(['pin', id, pinned]);
      return {
        id,
        title: '新对话',
        kind: 'chat',
        pinned,
        createdAt: '2026-11-01T09:00:00.000Z',
        updatedAt: '2026-11-01T09:00:00.000Z',
        messages: []
      };
    },
    async truncateConversationMessages(id: string, keepCount: number) {
      calls.push(['truncate', id, keepCount]);
      return {
        id,
        title: '新对话',
        kind: 'chat',
        createdAt: '2026-11-01T09:00:00.000Z',
        updatedAt: '2026-11-01T09:00:00.000Z',
        messages: []
      };
    },
    async searchConversations(query: string) {
      calls.push(['search', query]);
      return [];
    },
    async setConversationModel(id: string, model: string | null) {
      calls.push(['model', id, model]);
      return {
        id,
        title: '新对话',
        kind: 'chat',
        createdAt: '2026-11-01T09:00:00.000Z',
        updatedAt: '2026-11-01T09:00:00.000Z',
        messages: []
      };
    }
  } as unknown as StudyCoachApi;
  return { api, calls };
}

test('routes conversation channels and validates payloads', async () => {
  const { api, calls } = fakeApi();
  const handlers = createIpcHandlers(api);

  await handlers.listConversations();
  await handlers.getConversation('c1');
  await handlers.createConversation({ title: '考研', kind: 'chat', workspaceId: 'kaoyan' });
  await handlers.appendConversationMessage({
    conversationId: 'c1',
    message: {
      id: 'm1',
      role: 'user',
      text: '你好',
      createdAt: '2026-11-01T09:00:00.000Z'
    }
  });
  await handlers.deleteConversation('c1');
  await handlers.renameConversation({ conversationId: 'c1', title: '数学复盘' });
  await handlers.setConversationPinned({ conversationId: 'c1', pinned: true });
  await handlers.truncateConversationMessages({ conversationId: 'c1', keepCount: 2 });
  await handlers.searchConversations('极限');
  await handlers.setConversationModel({ conversationId: 'c1', model: 'gpt-x' });
  await handlers.setConversationModel({ conversationId: 'c1', model: null });

  expect(calls).toEqual([
    ['list'],
    ['get', 'c1'],
    ['create', { title: '考研', kind: 'chat', workspaceId: 'kaoyan' }],
    [
      'append',
      'c1',
      {
        id: 'm1',
        role: 'user',
        text: '你好',
        createdAt: '2026-11-01T09:00:00.000Z'
      }
    ],
    ['delete', 'c1'],
    ['rename', 'c1', '数学复盘'],
    ['pin', 'c1', true],
    ['truncate', 'c1', 2],
    ['search', '极限'],
    ['model', 'c1', 'gpt-x'],
    ['model', 'c1', null]
  ]);
});

test('rejects malformed conversation payloads', async () => {
  const { api } = fakeApi();
  const handlers = createIpcHandlers(api);

  await expect(handlers.getConversation('')).rejects.toThrow(/对话 ID/);
  await expect(handlers.createConversation({ kind: 'unknown' })).rejects.toThrow(
    /对话类型/
  );
  await expect(
    handlers.appendConversationMessage({
      conversationId: 'c1',
      message: { id: 'm1', role: 'system', text: 'x', createdAt: 'now' }
    })
  ).rejects.toThrow(/消息角色/);
  await expect(
    handlers.renameConversation({ conversationId: 'c1', title: '   ' })
  ).rejects.toThrow(/对话标题/);
  await expect(
    handlers.setConversationPinned({ conversationId: 'c1', pinned: 'yes' })
  ).rejects.toThrow(/置顶状态/);
  await expect(
    handlers.truncateConversationMessages({ conversationId: 'c1', keepCount: -1 })
  ).rejects.toThrow(/保留消息数/);
  await expect(handlers.searchConversations(42)).rejects.toThrow(/搜索关键词/);
  await expect(handlers.setConversationModel({ model: 'gpt-x' })).rejects.toThrow(
    /对话 ID/
  );
  await expect(
    handlers.setConversationModel({ conversationId: 'c1', model: 'x'.repeat(121) })
  ).rejects.toThrow(/对话模型/);
  await expect(
    handlers.setConversationModel({ conversationId: 'c1', model: 42 })
  ).rejects.toThrow(/对话模型/);
});
