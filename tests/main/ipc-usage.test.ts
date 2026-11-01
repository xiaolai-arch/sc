import type { StudyCoachApi } from '../../src/shared/ipc';
import { createIpcHandlers } from '../../src/main/ipc';

function fakeApi(): { api: StudyCoachApi; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const api = {
    async getUsageSummary(days?: number) {
      calls.push(['summary', days]);
      return {
        days: [],
        totals: { inputTokens: 0, outputTokens: 0, calls: 0 },
        estimatedCost: null
      };
    },
    async clearUsage() {
      calls.push(['clear']);
    }
  } as unknown as StudyCoachApi;
  return { api, calls };
}

test('routes usage summary and clear channels', async () => {
  const { api, calls } = fakeApi();
  const handlers = createIpcHandlers(api);

  await handlers.getUsageSummary(undefined);
  await handlers.getUsageSummary(30);
  await handlers.clearUsage();

  expect(calls).toEqual([['summary', undefined], ['summary', 30], ['clear']]);
});

test('validates usage day windows', async () => {
  const { api } = fakeApi();
  const handlers = createIpcHandlers(api);

  await expect(handlers.getUsageSummary(0)).rejects.toThrow(/1-90/);
  await expect(handlers.getUsageSummary(91)).rejects.toThrow(/1-90/);
  await expect(handlers.getUsageSummary(1.5)).rejects.toThrow(/1-90/);
  await expect(handlers.getUsageSummary('7')).rejects.toThrow(/1-90/);
});
