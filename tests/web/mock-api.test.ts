// @vitest-environment jsdom
import { createMockApi, DEMO_PROFILE, MOCK_STORAGE_KEY } from '../../web/mock-api';

test('starts in onboarding and completes it with a demo plan', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  expect((await api.getBootstrap()).needsOnboarding).toBe(true);
  await api.completeOnboarding(DEMO_PROFILE);
  const bootstrap = await api.getBootstrap();
  expect(bootstrap.needsOnboarding).toBe(false);
  const plan = await api.getTodayPlan();
  expect(plan?.tasks.length).toBeGreaterThan(0);
});

test('updates a task and keeps settings', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  await api.completeOnboarding(DEMO_PROFILE);
  const plan = await api.getTodayPlan();
  const updated = await api.updateTask({ taskId: plan!.tasks[0].id, status: 'done' });
  expect(updated.tasks.find((task) => task.id === plan!.tasks[0].id)?.status).toBe('done');
  const settings = await api.getSettings();
  expect(settings.budget.proactiveSessionsPerDay).toBe(4);
});

test('keeps the api key out of storage and flips hasApiKey', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  expect((await api.getBootstrap()).hasApiKey).toBe(false);
  await api.setApiKey('sk-test');
  expect((await api.getBootstrap()).hasApiKey).toBe(true);
  expect(localStorage.getItem(MOCK_STORAGE_KEY) ?? '').not.toContain('sk-test');
});

test('falls back to memory when storage is unavailable', async () => {
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    }
  } as unknown as Storage;
  const api = createMockApi(blocked);
  await api.completeOnboarding(DEMO_PROFILE);
  expect((await api.getTodayPlan())?.tasks.length).toBeGreaterThan(0);
});
