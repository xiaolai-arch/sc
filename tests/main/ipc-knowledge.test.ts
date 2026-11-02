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
    },
    async getKnowledgeNote(topicId: string) {
      calls.push(['note-get', topicId]);
      return { topicId, body: '', updatedAt: '' };
    },
    async saveKnowledgeNote(input: { topicId: string; body: string }) {
      calls.push(['note-save', input]);
      return { ...input, updatedAt: '' };
    },
    async getKnowledgeBacklinks(topicId: string) {
      calls.push(['backlinks', topicId]);
      return [];
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

test('routes knowledge note and backlink channels and validates payloads', async () => {
  const { api, calls } = fakeApi();
  const handlers = createIpcHandlers(api);

  await handlers.getKnowledgeNote('kt-1');
  await handlers.saveKnowledgeNote({ topicId: 'kt-1', body: '' });
  await handlers.getKnowledgeBacklinks('kt-1');
  expect(calls).toContainEqual(['note-get', 'kt-1']);
  expect(calls).toContainEqual(['note-save', { topicId: 'kt-1', body: '' }]);
  expect(calls).toContainEqual(['backlinks', 'kt-1']);

  await expect(handlers.getKnowledgeNote('  ')).rejects.toThrow(/知识主题 ID/);
  await expect(handlers.saveKnowledgeNote({ topicId: 'kt-1', body: 42 })).rejects.toThrow(
    /笔记内容/
  );
  await expect(
    handlers.saveKnowledgeNote({ topicId: 'kt-1', body: 'x'.repeat(200_001) })
  ).rejects.toThrow(/200000/);
  await expect(handlers.getKnowledgeBacklinks(' ')).rejects.toThrow(/知识主题 ID/);
});

test('passes note revisions through the IPC boundary', async () => {
  const { api, calls } = fakeApi();
  const handlers = createIpcHandlers(api);

  await handlers.saveKnowledgeNote({
    topicId: 'kt-1',
    body: 'draft',
    expectedRevision: 'rev-1',
    force: true
  });
  expect(calls).toContainEqual([
    'note-save',
    { topicId: 'kt-1', body: 'draft', expectedRevision: 'rev-1', force: true }
  ]);

  // An empty revision means "the note did not exist when the editor opened".
  await handlers.saveKnowledgeNote({
    topicId: 'kt-1',
    body: 'new',
    expectedRevision: ''
  });
  expect(calls).toContainEqual([
    'note-save',
    { topicId: 'kt-1', body: 'new', expectedRevision: '' }
  ]);

  // Callers that do not track revisions keep the old payload shape.
  await handlers.saveKnowledgeNote({ topicId: 'kt-1', body: 'plain' });
  expect(calls).toContainEqual(['note-save', { topicId: 'kt-1', body: 'plain' }]);

  await expect(
    handlers.saveKnowledgeNote({ topicId: 'kt-1', body: 'x', expectedRevision: 42 })
  ).rejects.toThrow(/笔记版本/);
  await expect(
    handlers.saveKnowledgeNote({ topicId: 'kt-1', body: 'x', force: 'yes' })
  ).rejects.toThrow(/覆盖/);
});
