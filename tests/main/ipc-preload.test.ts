import type { StudyCoachApi } from '../../src/shared/ipc';
import {
  IPC_CHANNELS,
  createStudyCoachBridge,
  type Invoke
} from '../../src/main/ipc';

test('locks the public channel names', () => {
  expect(IPC_CHANNELS).toEqual({
    getBootstrap: 'study-coach:bootstrap:get',
    completeOnboarding: 'study-coach:bootstrap:complete-onboarding',
    getSettings: 'study-coach:settings:get',
    updateSettings: 'study-coach:settings:update',
    setApiKey: 'study-coach:settings:set-api-key',
    getTodayPlan: 'study-coach:today-plan:get',
    generateTodayPlan: 'study-coach:today-plan:generate',
    updateTask: 'study-coach:today-plan:update-task',
    listWorkspaces: 'study-coach:workspaces:list',
    createWorkspace: 'study-coach:workspaces:create',
    getWorkspaceSnapshot: 'study-coach:workspaces:snapshot',
    createTask: 'study-coach:workspaces:create-task',
    updateWorkspaceTask: 'study-coach:workspaces:update-task',
    createNote: 'study-coach:workspaces:create-note',
    updateNote: 'study-coach:workspaces:update-note',
    getMemory: 'study-coach:workspaces:memory',
    getReminders: 'study-coach:reminders:list',
    submitReview: 'study-coach:review:submit',
    send: 'study-coach:butler:send'
  });
});

test('bridge invokes the expected channel and forwards arguments', async () => {
  const calls: Array<{ channel: string; args: unknown[] }> = [];
  const invoke: Invoke = async (channel, ...args) => {
    calls.push({ channel, args });
    return null;
  };
  const bridge: StudyCoachApi = createStudyCoachBridge(invoke);

  await bridge.getBootstrap();
  await bridge.completeOnboarding({ examDate: '2027-12-18', subjects: [], dailyMinutes: 60, currentLevel: 'x' } as never);
  await bridge.getSettings();
  await bridge.updateSettings({ launchAtLogin: true });
  await bridge.setApiKey('k');
  await bridge.getTodayPlan();
  await bridge.generateTodayPlan();
  await bridge.updateTask({ taskId: 't1', status: 'done' });
  await bridge.listWorkspaces();
  await bridge.createWorkspace({ name: 'n', kind: 'exam', goal: 'g', description: 'd' });
  await bridge.getWorkspaceSnapshot('ws-1');
  await bridge.createTask({ workspaceId: 'ws-1', title: 't', subject: 's', durationMin: 30, acceptance: 'a' });
  await bridge.updateWorkspaceTask({ taskId: 't1', status: 'done' });
  await bridge.createNote({ workspaceId: 'ws-1', title: 't', subject: 's', body: 'b' });
  await bridge.updateNote({ noteId: 'n1', body: 'b' });
  await bridge.getMemory('ws-1');
  await bridge.getReminders();
  await bridge.submitReview({ date: '2026-10-31', answers: { completed: 'a', stuck: 'b', tomorrow: 'c' } });
  await bridge.send({ message: 'hi' });

  expect(calls.map((entry) => entry.channel)).toEqual(Object.values(IPC_CHANNELS));
  expect(calls[0]).toEqual({ channel: IPC_CHANNELS.getBootstrap, args: [] });
  expect(calls[4]).toEqual({ channel: IPC_CHANNELS.setApiKey, args: ['k'] });
  expect(calls[10]).toEqual({ channel: IPC_CHANNELS.getWorkspaceSnapshot, args: ['ws-1'] });
  expect(calls[15]).toEqual({ channel: IPC_CHANNELS.getMemory, args: ['ws-1'] });
  expect(calls[18]?.args).toEqual([{ message: 'hi' }]);
});

test('bridge does not swallow rejected invokes', async () => {
  const invoke: Invoke = async () => {
    throw new Error('main exploded');
  };
  const bridge = createStudyCoachBridge(invoke);
  await expect(bridge.getBootstrap()).rejects.toThrow('main exploded');
  await expect(bridge.send({ message: 'hi' })).rejects.toThrow('main exploded');
});
