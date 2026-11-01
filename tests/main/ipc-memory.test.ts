import type { StudyCoachApi } from '../../src/shared/ipc';
import { createIpcHandlers } from '../../src/main/ipc';

function fakeApi(): { api: StudyCoachApi; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const api = {
    async updateMemory(input: unknown) {
      calls.push(['update', input]);
      return {
        id: 'm1',
        workspaceId: 'ws-1',
        text: '新内容',
        kind: 'strength',
        source: 'review:2026-11-01',
        createdAt: '2026-11-01T00:00:00.000Z'
      };
    },
    async deleteMemory(input: unknown) {
      calls.push(['delete', input]);
    }
  } as unknown as StudyCoachApi;
  return { api, calls };
}

test('routes memory update and delete channels', async () => {
  const { api, calls } = fakeApi();
  const handlers = createIpcHandlers(api);

  await handlers.updateMemory({
    workspaceId: 'ws-1',
    id: 'm1',
    text: '新内容',
    kind: 'strength'
  });
  await handlers.deleteMemory({ workspaceId: 'ws-1', id: 'm1' });

  expect(calls).toEqual([
    ['update', { workspaceId: 'ws-1', id: 'm1', text: '新内容', kind: 'strength' }],
    ['delete', { workspaceId: 'ws-1', id: 'm1' }]
  ]);
});

test('validates memory payloads', async () => {
  const { api } = fakeApi();
  const handlers = createIpcHandlers(api);

  await expect(handlers.updateMemory({ id: 'm1', text: 'x' })).rejects.toThrow(/工作区 ID/);
  await expect(handlers.updateMemory({ workspaceId: 'ws-1', text: 'x' })).rejects.toThrow(
    /记忆 ID/
  );
  await expect(
    handlers.updateMemory({ workspaceId: 'ws-1', id: 'm1', text: '   ' })
  ).rejects.toThrow(/记忆内容/);
  await expect(
    handlers.updateMemory({ workspaceId: 'ws-1', id: 'm1', kind: 'mystery' })
  ).rejects.toThrow(/记忆类型/);
  await expect(handlers.deleteMemory({ workspaceId: 'ws-1' })).rejects.toThrow(/记忆 ID/);
  await expect(handlers.deleteMemory({ id: 'm1' })).rejects.toThrow(/工作区 ID/);
});
