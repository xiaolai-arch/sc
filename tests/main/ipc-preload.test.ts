import type { StudyCoachApi } from '../../src/shared/ipc';
import {
  APP_EVENT_CHANNELS,
  APP_IPC_CHANNELS,
  BUTLER_STREAM_CHANNELS,
  IPC_CHANNELS,
  createStudyCoachBridge,
  type Invoke,
  type Subscribe
} from '../../src/main/ipc';

test('locks the app event channels', () => {
  expect(APP_EVENT_CHANNELS).toEqual({
    quickCapture: 'study-coach:app:quick-capture'
  });
});

test('locks the app IPC channels', () => {
  expect(APP_IPC_CHANNELS).toEqual({
    exportBackup: 'study-coach:app:export-backup',
    restoreBackup: 'study-coach:app:restore-backup',
    restartApp: 'study-coach:app:restart'
  });
});

test('bridge invokes export backup and returns its result', async () => {
  const calls: Array<{ channel: string; args: unknown[] }> = [];
  const bridge = createStudyCoachBridge(async (channel, ...args) => {
    calls.push({ channel, args });
    return {
      path: '/tmp/backup',
      copied: { vault: true, conversations: true, state: true, usage: true }
    };
  });

  const result = await bridge.exportBackup?.();

  expect(result).toMatchObject({ path: '/tmp/backup' });
  expect(calls).toEqual([{ channel: APP_IPC_CHANNELS.exportBackup, args: [] }]);
});

test('bridge invokes restore backup and restart', async () => {
  const calls: string[] = [];
  const bridge = createStudyCoachBridge(async (channel) => {
    calls.push(channel);
    if (channel === APP_IPC_CHANNELS.restoreBackup) {
      return {
        path: '/tmp/backup',
        safetyPath: '/tmp/safety',
        restored: { vault: true, conversations: true, usage: true }
      };
    }
    return undefined;
  });

  expect(await bridge.restoreBackup?.()).toMatchObject({ path: '/tmp/backup' });
  await bridge.restartApp?.();
  expect(calls).toEqual([
    APP_IPC_CHANNELS.restoreBackup,
    APP_IPC_CHANNELS.restartApp
  ]);
});

test('bridge subscribes to quick capture events and unsubscribes', () => {
  const listeners = new Map<string, (payload: unknown) => void>();
  const unsubscribed: string[] = [];
  const subscribe: Subscribe = (channel, listener) => {
    listeners.set(channel, listener);
    return () => unsubscribed.push(channel);
  };
  const bridge: StudyCoachApi = createStudyCoachBridge(async () => null, subscribe);
  let captured = 0;

  const unsubscribe = bridge.onQuickCapture?.(() => {
    captured += 1;
  });
  listeners.get(APP_EVENT_CHANNELS.quickCapture)?.({});
  expect(captured).toBe(1);

  unsubscribe?.();
  expect(unsubscribed).toEqual([APP_EVENT_CHANNELS.quickCapture]);
});

test('locks the public channel names', () => {
  expect(IPC_CHANNELS).toEqual({
    getBootstrap: 'study-coach:bootstrap:get',
    completeWorkspaceOnboarding: 'study-coach:bootstrap:complete-workspace-onboarding',
    getSettings: 'study-coach:settings:get',
    updateSettings: 'study-coach:settings:update',
    setApiKey: 'study-coach:settings:set-api-key',
    listWorkspaces: 'study-coach:workspaces:list',
    createWorkspace: 'study-coach:workspaces:create',
    updateWorkspace: 'study-coach:workspaces:update',
    getWorkspaceSnapshot: 'study-coach:workspaces:snapshot',
    createTask: 'study-coach:workspaces:create-task',
    updateWorkspaceTask: 'study-coach:workspaces:update-task',
    createNote: 'study-coach:workspaces:create-note',
    updateNote: 'study-coach:workspaces:update-note',
    getMemory: 'study-coach:workspaces:memory',
    getReminders: 'study-coach:reminders:list',
    createReminder: 'study-coach:reminders:create',
    updateReminder: 'study-coach:reminders:update',
    submitReview: 'study-coach:review:submit',
    listReviews: 'study-coach:review:list',
    planWorkspace: 'study-coach:planning:plan-workspace',
    listLongPlans: 'study-coach:plans:list',
    getLongPlan: 'study-coach:plans:get',
    createLongPlan: 'study-coach:plans:create',
    setLongPlanItemDone: 'study-coach:plans:set-item-done',
    deleteLongPlan: 'study-coach:plans:delete',
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
    updateMemory: 'study-coach:memory:update',
    deleteMemory: 'study-coach:memory:delete',
    listKnowledgeTopics: 'study-coach:knowledge:list',
    createKnowledgeTopic: 'study-coach:knowledge:create',
    updateKnowledgeTopic: 'study-coach:knowledge:update',
    deleteKnowledgeTopic: 'study-coach:knowledge:delete',
    searchWorkspace: 'study-coach:search:query',
    rebuildSearchIndex: 'study-coach:search:rebuild',
    listConversations: 'study-coach:conversations:list',
    getConversation: 'study-coach:conversations:get',
    createConversation: 'study-coach:conversations:create',
    appendConversationMessage: 'study-coach:conversations:append-message',
    deleteConversation: 'study-coach:conversations:delete',
    renameConversation: 'study-coach:conversations:rename',
    setConversationPinned: 'study-coach:conversations:set-pinned',
    truncateConversationMessages: 'study-coach:conversations:truncate-messages',
    searchConversations: 'study-coach:conversations:search',
    setConversationModel: 'study-coach:conversations:set-model',
    getUsageSummary: 'study-coach:usage:summary',
    clearUsage: 'study-coach:usage:clear',
    send: 'study-coach:butler:send',
    scanLocalClis: 'study-coach:local-cli:scan'
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
  await bridge.getSettings();
  await bridge.updateSettings({ launchAtLogin: true });
  await bridge.setApiKey('k');
  await bridge.listWorkspaces();
  await bridge.createWorkspace({ name: 'n', kind: 'exam', goal: 'g', description: 'd' });
  await bridge.updateWorkspace?.({ workspaceId: 'ws-1', checkIn: 'off' });
  await bridge.getWorkspaceSnapshot('ws-1');
  await bridge.createTask({ workspaceId: 'ws-1', title: 't', subject: 's', durationMin: 30, acceptance: 'a' });
  await bridge.updateWorkspaceTask({ taskId: 't1', status: 'done' });
  await bridge.createNote({ workspaceId: 'ws-1', title: 't', subject: 's', body: 'b' });
  await bridge.updateNote({ noteId: 'n1', body: 'b' });
  await bridge.getMemory('ws-1');
  await bridge.getReminders();
  await bridge.createReminder?.({ time: '21:30', label: '复盘' });
  await bridge.updateReminder?.({ id: 'r1', enabled: false });
  await bridge.submitReview({ date: '2026-10-31', answers: { completed: 'a', stuck: 'b', tomorrow: 'c' } });
  await bridge.listReviews({ workspaceId: 'ws-1', limit: 5 });
  await bridge.planWorkspace({ workspaceId: 'ws-1', availableMinutes: 90 });
  await bridge.listLongPlans('ws-1');
  await bridge.getLongPlan('lp-1');
  await bridge.createLongPlan({
    workspaceId: 'ws-1',
    goal: '学会 Agent',
    weeks: 12,
    weeklyHours: 10
  });
  await bridge.setLongPlanItemDone({
    planId: 'lp-1',
    weekId: 'w1',
    itemId: 'w1d1',
    kind: 'day',
    done: true
  });
  await bridge.deleteLongPlan('lp-1');
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
  await bridge.updateMemory({
    workspaceId: 'ws-1',
    id: 'm1',
    text: '新内容',
    kind: 'strength'
  });
  await bridge.deleteMemory({ workspaceId: 'ws-1', id: 'm1' });
  await bridge.listKnowledgeTopics('ws-1');
  await bridge.createKnowledgeTopic({ name: 'LangChain', workspaceId: 'ws-1' });
  await bridge.updateKnowledgeTopic({ id: 'kt-1', status: 'mastered' });
  await bridge.deleteKnowledgeTopic('kt-1');
  await bridge.searchWorkspace({ workspaceId: 'ws-1', query: '极限', limit: 5 });
  await bridge.rebuildSearchIndex();
  await bridge.listConversations();
  await bridge.getConversation('c1');
  await bridge.createConversation({ workspaceId: 'ws-1' });
  await bridge.appendConversationMessage('c1', {
    id: 'm1',
    role: 'user',
    text: 'hi',
    createdAt: '2026-11-01T09:00:00.000Z'
  });
  await bridge.deleteConversation('c1');
  await bridge.renameConversation('c1', '数学复盘');
  await bridge.setConversationPinned('c1', true);
  await bridge.truncateConversationMessages('c1', 2);
  await bridge.searchConversations('极限');
  await bridge.setConversationModel('c1', 'gpt-x');
  await bridge.getUsageSummary(7);
  await bridge.clearUsage();
  await bridge.send({ message: 'hi' });
  await bridge.scanLocalClis();

  expect(calls.map((entry) => entry.channel)).toEqual(Object.values(IPC_CHANNELS));
  expect(calls[0]).toEqual({ channel: IPC_CHANNELS.getBootstrap, args: [] });
  expect(calls[1]?.channel).toBe(IPC_CHANNELS.completeWorkspaceOnboarding);
  expect(calls[4]).toEqual({ channel: IPC_CHANNELS.setApiKey, args: ['k'] });
  expect(calls[7]).toEqual({
    channel: IPC_CHANNELS.updateWorkspace,
    args: [{ workspaceId: 'ws-1', checkIn: 'off' }]
  });
  expect(calls[8]).toEqual({ channel: IPC_CHANNELS.getWorkspaceSnapshot, args: ['ws-1'] });
  expect(calls[13]).toEqual({ channel: IPC_CHANNELS.getMemory, args: ['ws-1'] });
  expect(calls[15]).toEqual({
    channel: IPC_CHANNELS.createReminder,
    args: [{ time: '21:30', label: '复盘' }]
  });
  expect(calls[16]).toEqual({
    channel: IPC_CHANNELS.updateReminder,
    args: [{ id: 'r1', enabled: false }]
  });
  expect(calls[18]).toEqual({
    channel: IPC_CHANNELS.listReviews,
    args: [{ workspaceId: 'ws-1', limit: 5 }]
  });
  expect(calls[20]).toEqual({
    channel: IPC_CHANNELS.listLongPlans,
    args: ['ws-1']
  });
  expect(calls[21]).toEqual({ channel: IPC_CHANNELS.getLongPlan, args: ['lp-1'] });
  expect(calls[22]).toEqual({
    channel: IPC_CHANNELS.createLongPlan,
    args: [{ workspaceId: 'ws-1', goal: '学会 Agent', weeks: 12, weeklyHours: 10 }]
  });
  expect(calls[23]).toEqual({
    channel: IPC_CHANNELS.setLongPlanItemDone,
    args: [{ planId: 'lp-1', weekId: 'w1', itemId: 'w1d1', kind: 'day', done: true }]
  });
  expect(calls[24]).toEqual({ channel: IPC_CHANNELS.deleteLongPlan, args: ['lp-1'] });
  expect(calls[35]).toEqual({
    channel: IPC_CHANNELS.updateMemory,
    args: [{ workspaceId: 'ws-1', id: 'm1', text: '新内容', kind: 'strength' }]
  });
  expect(calls[36]).toEqual({
    channel: IPC_CHANNELS.deleteMemory,
    args: [{ workspaceId: 'ws-1', id: 'm1' }]
  });
  expect(calls[37]).toEqual({
    channel: IPC_CHANNELS.listKnowledgeTopics,
    args: ['ws-1']
  });
  expect(calls[38]).toEqual({
    channel: IPC_CHANNELS.createKnowledgeTopic,
    args: [{ name: 'LangChain', workspaceId: 'ws-1' }]
  });
  expect(calls[39]).toEqual({
    channel: IPC_CHANNELS.updateKnowledgeTopic,
    args: [{ id: 'kt-1', status: 'mastered' }]
  });
  expect(calls[40]).toEqual({
    channel: IPC_CHANNELS.deleteKnowledgeTopic,
    args: ['kt-1']
  });
  expect(calls[41]).toEqual({
    channel: IPC_CHANNELS.searchWorkspace,
    args: [{ workspaceId: 'ws-1', query: '极限', limit: 5 }]
  });
  expect(calls[46]).toEqual({
    channel: IPC_CHANNELS.appendConversationMessage,
    args: [
      {
        conversationId: 'c1',
        message: {
          id: 'm1',
          role: 'user',
          text: 'hi',
          createdAt: '2026-11-01T09:00:00.000Z'
        }
      }
    ]
  });
  expect(calls[48]).toEqual({
    channel: IPC_CHANNELS.renameConversation,
    args: [{ conversationId: 'c1', title: '数学复盘' }]
  });
  expect(calls[49]).toEqual({
    channel: IPC_CHANNELS.setConversationPinned,
    args: [{ conversationId: 'c1', pinned: true }]
  });
  expect(calls[50]).toEqual({
    channel: IPC_CHANNELS.truncateConversationMessages,
    args: [{ conversationId: 'c1', keepCount: 2 }]
  });
  expect(calls[51]).toEqual({
    channel: IPC_CHANNELS.searchConversations,
    args: ['极限']
  });
  expect(calls[52]).toEqual({
    channel: IPC_CHANNELS.setConversationModel,
    args: [{ conversationId: 'c1', model: 'gpt-x' }]
  });
  expect(calls[53]).toEqual({ channel: IPC_CHANNELS.getUsageSummary, args: [7] });
  expect(calls[54]).toEqual({ channel: IPC_CHANNELS.clearUsage, args: [] });
  expect(calls[55]?.args).toEqual([{ message: 'hi' }]);
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

test('bridge cancels a stream by assistant message id', async () => {
  const calls: Array<{ channel: string; args: unknown[] }> = [];
  const bridge = createStudyCoachBridge(async (channel, ...args) => {
    calls.push({ channel, args });
    return null;
  });
  await bridge.cancelStream('a1');
  expect(calls).toEqual([
    { channel: BUTLER_STREAM_CHANNELS.cancel, args: ['a1'] }
  ]);
});
