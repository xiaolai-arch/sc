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
    ['delete', 'c1']
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
});
