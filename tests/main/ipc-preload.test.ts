import type { StudyCoachApi } from '../../src/shared/ipc';
import {
  BUTLER_STREAM_CHANNELS,
  IPC_CHANNELS,
  createStudyCoachBridge,
  type Invoke,
  type Subscribe
} from '../../src/main/ipc';

test('locks the public channel names', () => {
  expect(IPC_CHANNELS).toEqual({
    getBootstrap: 'study-coach:bootstrap:get',
    completeWorkspaceOnboarding: 'study-coach:bootstrap:complete-workspace-onboarding',
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
    listReviews: 'study-coach:review:list',
    planWorkspace: 'study-coach:planning:plan-workspace',
    listPracticeSets: 'study-coach:practice:list-sets',
    getPracticeSet: 'study-coach:practice:get-set',
    createPracticeSet: 'study-coach:practice:create-set',
    submitPracticeAnswer: 'study-coach:practice:submit-answer',
    getPracticeMistakes: 'study-coach:practice:mistakes',
    getPracticeDue: 'study-coach:practice:due',
    listPracticeAttempts: 'study-coach:practice:attempts',
    listMemory: 'study-coach:memory:list',
    synthesizeMemory: 'study-coach:memory:synthesize',
    getMemoryProfile: 'study-coach:memory:profile',
    searchWorkspace: 'study-coach:search:query',
    rebuildSearchIndex: 'study-coach:search:rebuild',
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
  await bridge.completeWorkspaceOnboarding({
    name: '我的学习',
    kind: 'study',
    goal: 'g',
    description: 'd',
    useDemo: true
  });
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
  await bridge.listReviews({ workspaceId: 'ws-1', limit: 5 });
  await bridge.planWorkspace({ workspaceId: 'ws-1', availableMinutes: 90 });
  await bridge.listPracticeSets('ws-1');
  await bridge.getPracticeSet('ps-1');
  await bridge.createPracticeSet({
    workspaceId: 'ws-1',
    title: '极限',
    questions: [{ prompt: 'p', options: ['a', 'b'], answer: 0 }]
  });
  await bridge.submitPracticeAnswer({ questionId: 'q-1', choice: 1 });
  await bridge.getPracticeMistakes('ws-1');
  await bridge.getPracticeDue({ workspaceId: 'ws-1', date: '2026-10-31' });
  await bridge.listPracticeAttempts('ws-1');
  await bridge.listMemory('ws-1');
  await bridge.synthesizeMemory({
    workspaceId: 'ws-1',
    date: '2026-10-31',
    answers: { completed: 'a', stuck: 'b', tomorrow: 'c' }
  });
  await bridge.getMemoryProfile('ws-1');
  await bridge.searchWorkspace({ workspaceId: 'ws-1', query: '极限', limit: 5 });
  await bridge.rebuildSearchIndex();
  await bridge.send({ message: 'hi' });

  expect(calls.map((entry) => entry.channel)).toEqual(Object.values(IPC_CHANNELS));
  expect(calls[0]).toEqual({ channel: IPC_CHANNELS.getBootstrap, args: [] });
  expect(calls[1]?.channel).toBe(IPC_CHANNELS.completeWorkspaceOnboarding);
  expect(calls[5]).toEqual({ channel: IPC_CHANNELS.setApiKey, args: ['k'] });
  expect(calls[11]).toEqual({ channel: IPC_CHANNELS.getWorkspaceSnapshot, args: ['ws-1'] });
  expect(calls[16]).toEqual({ channel: IPC_CHANNELS.getMemory, args: ['ws-1'] });
  expect(calls[19]).toEqual({
    channel: IPC_CHANNELS.listReviews,
    args: [{ workspaceId: 'ws-1', limit: 5 }]
  });
  expect(calls[31]).toEqual({
    channel: IPC_CHANNELS.searchWorkspace,
    args: [{ workspaceId: 'ws-1', query: '极限', limit: 5 }]
  });
  expect(calls[33]?.args).toEqual([{ message: 'hi' }]);
});

test('bridge does not swallow rejected invokes', async () => {
  const invoke: Invoke = async () => {
    throw new Error('main exploded');
  };
  const bridge = createStudyCoachBridge(invoke);
  await expect(bridge.getBootstrap()).rejects.toThrow('main exploded');
  await expect(bridge.send({ message: 'hi' })).rejects.toThrow('main exploded');
});

test('bridge streams events for the matching requestId and unsubscribes', async () => {
  const listeners = new Map<string, (payload: unknown) => void>();
  const unsubscribed: string[] = [];
  const subscribe: Subscribe = (channel, listener) => {
    listeners.set(channel, listener);
    return () => {
      unsubscribed.push(channel);
    };
  };
  const invoke: Invoke = async (channel, ...args) => {
    if (channel !== BUTLER_STREAM_CHANNELS.stream) return null;
    const payload = args[0] as { requestId: string };
    const listener = listeners.get(BUTLER_STREAM_CHANNELS.event);
    listener?.({ requestId: 'other-request', event: { type: 'text', text: '错误请求' } });
    listener?.({ requestId: payload.requestId, event: { type: 'reasoning', text: '想' } });
    listener?.({ requestId: payload.requestId, event: { type: 'done', text: '答' } });
    return { text: '答' };
  };

  const bridge: StudyCoachApi = createStudyCoachBridge(invoke, subscribe);
  const events: unknown[] = [];
  const result = await bridge.stream({ message: '你好' }, (event) => events.push(event));

  expect(result).toEqual({ text: '答' });
  expect(events).toEqual([
    { type: 'reasoning', text: '想' },
    { type: 'done', text: '答' }
  ]);
  expect(unsubscribed).toEqual([BUTLER_STREAM_CHANNELS.event]);
});
