import type { StudyCoachApi } from '../../src/shared/ipc';
import { createIpcHandlers } from '../../src/main/ipc';

function fakeApi(): { api: StudyCoachApi; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const api = {
    async listKnowledgeTopics(workspaceId?: string) {
      calls.push(['list', workspaceId]);
      return [];
    },
    async createKnowledgeTopic(input: unknown) {
      calls.push(['create', input]);
      return { id: 'kt-1', name: 'LangChain' };
    },
    async updateKnowledgeTopic(input: unknown) {
      calls.push(['update', input]);
      return { id: 'kt-1', name: 'LangChain' };
    },
    async deleteKnowledgeTopic(id: string) {
      calls.push(['delete', id]);
    }
  } as unknown as StudyCoachApi;
  return { api, calls };
}

test('routes knowledge channels and validates payloads', async () => {
  const { api, calls } = fakeApi();
  const handlers = createIpcHandlers(api);

  await handlers.listKnowledgeTopics('agent');
  await handlers.deleteKnowledgeTopic('kt-1');
  expect(calls).toEqual([
    ['list', 'agent'],
    ['delete', 'kt-1']
  ]);

  await expect(handlers.createKnowledgeTopic({ name: '  ' })).rejects.toThrow(/知识主题名称/);
  await expect(handlers.createKnowledgeTopic({ name: 'X', level: 6 })).rejects.toThrow(/掌握程度/);
  await expect(handlers.updateKnowledgeTopic({ id: '' })).rejects.toThrow(/主题 ID/);
});
