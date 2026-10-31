// @vitest-environment jsdom
import { createMockApi, DEMO_PROFILE } from '../../web/mock-api';

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
