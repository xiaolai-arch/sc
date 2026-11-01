import type { StudyCoachApi } from '../../src/shared/ipc';
import { createIpcHandlers } from '../../src/main/ipc';

function fakeApi(): { api: StudyCoachApi; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const api = {
    async createReminder(input: unknown) {
      calls.push(['create', input]);
      return { id: 'r1', time: '21:30', label: '复盘', enabled: true };
    },
    async updateReminder(input: unknown) {
      calls.push(['update', input]);
      return { id: 'r1', time: '22:00', label: '复盘', enabled: false };
    }
  } as unknown as StudyCoachApi;
  return { api, calls };
}

test('routes reminder create and update channels', async () => {
  const { api, calls } = fakeApi();
  const handlers = createIpcHandlers(api);

  await handlers.createReminder({ time: '21:30', label: '复盘' });
  await handlers.updateReminder({ id: 'r1', time: '22:00', enabled: false });

  expect(calls).toEqual([
    ['create', { time: '21:30', label: '复盘' }],
    ['update', { id: 'r1', time: '22:00', enabled: false }]
  ]);
});

test('validates reminder payloads', async () => {
  const { api } = fakeApi();
  const handlers = createIpcHandlers(api);

  await expect(handlers.createReminder({ time: '25:00', label: '复盘' })).rejects.toThrow(
    /提醒时间/
  );
  await expect(handlers.createReminder({ time: '21:30', label: '   ' })).rejects.toThrow(
    /提醒内容/
  );
  await expect(handlers.updateReminder({ id: '' })).rejects.toThrow(/提醒 ID/);
  await expect(handlers.updateReminder({ id: 'r1', enabled: 'yes' })).rejects.toThrow(
    /启用状态/
  );
  await expect(handlers.updateReminder({ id: 'r1', time: '9:5' })).rejects.toThrow(
    /提醒时间/
  );
});

test('reports unsupported reminder storage clearly', async () => {
  const handlers = createIpcHandlers({} as StudyCoachApi);

  await expect(handlers.createReminder({ time: '21:30', label: '复盘' })).rejects.toThrow(
    /不支持提醒/
  );
  await expect(handlers.updateReminder({ id: 'r1', enabled: false })).rejects.toThrow(
    /不支持提醒/
  );
});
