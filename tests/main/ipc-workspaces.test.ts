import type { StudyCoachApi } from '../../src/shared/ipc';
import { createIpcHandlers } from '../../src/main/ipc';

const workspace = {
  id: 'ws-1',
  name: '考研',
  kind: 'exam',
  color: '#0071e3',
  goal: '上岸',
  description: '',
  checkIn: 'off'
};

function fakeApi(): { api: StudyCoachApi; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const api = {
    async updateWorkspace(input: unknown) {
      calls.push(['update', input]);
      return workspace;
    }
  } as unknown as StudyCoachApi;
  return { api, calls };
}

test('routes workspace update and validates payloads', async () => {
  const { api, calls } = fakeApi();
  const handlers = createIpcHandlers(api);

  await handlers.updateWorkspace({ workspaceId: 'ws-1', checkIn: 'off' });
  expect(calls).toEqual([['update', { workspaceId: 'ws-1', checkIn: 'off' }]]);

  await expect(handlers.updateWorkspace({})).rejects.toThrow(/工作区 ID/);
  await expect(
    handlers.updateWorkspace({ workspaceId: 'ws-1', checkIn: 'weekly' })
  ).rejects.toThrow(/检查频率/);
  await expect(
    handlers.updateWorkspace({ workspaceId: 'ws-1', name: '   ' })
  ).rejects.toThrow(/工作区名称/);
});

test('reports unsupported workspace updates clearly', async () => {
  const handlers = createIpcHandlers({} as StudyCoachApi);

  await expect(handlers.updateWorkspace({ workspaceId: 'ws-1', checkIn: 'off' })).rejects.toThrow(
    /不支持更新项目/
  );
});
