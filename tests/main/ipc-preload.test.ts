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
    quickCapture: 'study-coach:app:quick-capture',
    navigate: 'study-coach:app:navigate'
  });
});

test('locks the app IPC channels', () => {
  expect(APP_IPC_CHANNELS).toEqual({
    exportBackup: 'study-coach:app:export-backup',
    restoreBackup: 'study-coach:app:restore-backup',
    restartApp: 'study-coach:app:restart',
    pickVideoFiles: 'study-coach:app:pick-video-files',
    pickOutputDirectory: 'study-coach:app:pick-output-directory',
    openPath: 'study-coach:app:open-path',
    // iter31 P1: appended last so every existing channel keeps its position.
    chooseBackupDirectory: 'study-coach:app:choose-backup-directory',
    // item 66 P2-2: the settings card's directory-validity stat.
    statBackupDirectory: 'study-coach:app:stat-backup-directory'
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
        restored: { vault: true, conversations: true, usage: true, state: false }
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

test('bridge invokes choose backup directory and passes null through', async () => {
  const calls: Array<{ channel: string; args: unknown[] }> = [];
  const bridge = createStudyCoachBridge(async (channel, ...args) => {
    calls.push({ channel, args });
    return 'D:\\backups';
  });

  expect(await bridge.chooseBackupDirectory?.()).toBe('D:\\backups');
  // The channel is the only argument; the picker takes no renderer input.
  expect(calls).toEqual([{ channel: APP_IPC_CHANNELS.chooseBackupDirectory, args: [] }]);

  const canceling = createStudyCoachBridge(async () => null);
  expect(await canceling.chooseBackupDirectory?.()).toBeNull();
});

test('bridge stats a backup directory with the path as the only argument', async () => {
  const calls: Array<{ channel: string; args: unknown[] }> = [];
  const bridge = createStudyCoachBridge(async (channel, ...args) => {
    calls.push({ channel, args });
    return { exists: false, isDirectory: false };
  });

  expect(await bridge.statBackupDirectory?.('D:\\gone')).toEqual({
    exists: false,
    isDirectory: false
  });
  expect(calls).toEqual([
    { channel: APP_IPC_CHANNELS.statBackupDirectory, args: ['D:\\gone'] }
  ]);
});

test('bridge forwards the conversation-changed event and unsubscribes', () => {
  const listeners = new Map<string, (payload: unknown) => void>();
  const unsubscribed: string[] = [];
  const subscribe: Subscribe = (channel, listener) => {
    listeners.set(channel, listener);
    return () => unsubscribed.push(channel);
  };
  const bridge: StudyCoachApi = createStudyCoachBridge(async () => null, subscribe);
  const received: string[] = [];

  // item 66 P2-6: the sidebar refresh rides the `changed` channel; only a
  // well-formed { conversationId } payload reaches the listener.
  const unsubscribe = bridge.onConversationChanged((id) => received.push(id));
  listeners.get('study-coach:conversations:changed')?.({ conversationId: 'c-check-in' });
  listeners.get('study-coach:conversations:changed')?.({ unrelated: true });
  expect(received).toEqual(['c-check-in']);

  unsubscribe();
  expect(unsubscribed).toEqual(['study-coach:conversations:changed']);
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

test('bridge subscribes to navigation events and ignores invalid targets', () => {
  const listeners = new Map<string, (payload: unknown) => void>();
  const subscribe: Subscribe = (channel, listener) => {
    listeners.set(channel, listener);
    return () => undefined;
  };
  const bridge = createStudyCoachBridge(async () => null, subscribe);
  const targets: string[] = [];

  bridge.onNavigate?.((target) => {
    targets.push(target);
  });
  const emit = listeners.get(APP_EVENT_CHANNELS.navigate);
  emit?.({ target: 'review' });
  emit?.({ target: 'settings' });
  emit?.({ target: 'chat' });
  emit?.('review');

  expect(targets).toEqual(['review', 'settings']);
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
    listProfile: 'study-coach:profile:list',
    createProfileEntry: 'study-coach:profile:create',
    updateProfileEntry: 'study-coach:profile:update',
    deleteProfileEntry: 'study-coach:profile:delete',
    listKnowledgeTopics: 'study-coach:knowledge:list',
    createKnowledgeTopic: 'study-coach:knowledge:create',
    updateKnowledgeTopic: 'study-coach:knowledge:update',
    deleteKnowledgeTopic: 'study-coach:knowledge:delete',
    getKnowledgeNote: 'study-coach:knowledge:note:get',
    saveKnowledgeNote: 'study-coach:knowledge:note:save',
    getKnowledgeBacklinks: 'study-coach:knowledge:backlinks',
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
    setConversationPermissions: 'study-coach:conversations:set-permissions',
    getUsageSummary: 'study-coach:usage:summary',
    clearUsage: 'study-coach:usage:clear',
    send: 'study-coach:butler:send',
    scanLocalClis: 'study-coach:local-cli:scan',
    recalibrateLongPlan: 'study-coach:plans:recalibrate',
    searchAll: 'study-coach:search:all',
    deleteTask: 'study-coach:workspaces:delete-task',
    deleteReminder: 'study-coach:reminders:delete',
    createMemory: 'study-coach:memory:create',
    deleteWorkspace: 'study-coach:workspaces:delete',
    updateLongPlan: 'study-coach:plans:update',
    mergeKnowledgeTopics: 'study-coach:knowledge:merge',
    deleteNote: 'study-coach:workspaces:delete-note',
    updatePracticeSet: 'study-coach:practice:update-set',
    deletePracticeSet: 'study-coach:practice:delete-set',
    reviewPracticeMistake: 'study-coach:practice:review-mistake',
    setPracticeMistakeResolved: 'study-coach:practice:set-mistake-resolved',
    exportMistakeSheet: 'study-coach:practice:export-mistake-sheet',
    submitPracticeShortAnswer: 'study-coach:practice:submit-short-answer',
    listPendingCommitments: 'study-coach:commitments:pending',
    listCommitments: 'study-coach:commitments:list',
    resolveCommitmentEntry: 'study-coach:commitments:resolve',
    listWeekAvailability: 'study-coach:week-availability:list',
    clearWeekAvailability: 'study-coach:week-availability:clear',
    getFocusSnapshot: 'study-coach:focus-snapshot:get',
    setFocusSnapshot: 'study-coach:focus-snapshot:set',
    setPracticeMistakeCause: 'study-coach:practice:set-mistake-cause',
    archiveResolvedPracticeMistakes: 'study-coach:practice:archive-resolved-mistakes',
    listArchivedPracticeMistakes: 'study-coach:practice:list-archived-mistakes',
    restorePracticeMistake: 'study-coach:practice:restore-mistake'
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
  await bridge.getKnowledgeNote('kt-1');
  await bridge.saveKnowledgeNote({ topicId: 'kt-1', body: 'b' });
  await bridge.getKnowledgeBacklinks('kt-1');
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
  await bridge.recalibrateLongPlan({
    planId: 'lp-1',
    weeklyHours: 8,
    notes: '这周加班'
  });
  await bridge.searchAll({ query: '极限', limit: 5 });
  await bridge.deleteTask?.({ taskId: 't1' });
  await bridge.deleteReminder?.({ id: 'r1' });
  await bridge.createMemory?.({
    workspaceId: 'ws-1',
    text: '更喜欢早上学习',
    kind: 'preference'
  });
  await bridge.deleteWorkspace?.('ws-1');
  await bridge.updateLongPlan({ planId: 'lp-1', goal: '学会 LangGraph', weeklyHours: 8 });
  await bridge.mergeKnowledgeTopics({ sourceId: 'kt-1', targetId: 'kt-2' });
  await bridge.deleteNote?.({ noteId: 'n1' });
  await bridge.updatePracticeSet?.({ setId: 'ps-1', title: '线代冲刺' });
  await bridge.deletePracticeSet?.({ setId: 'ps-1' });
  await bridge.reviewPracticeMistake?.({ mistakeId: 'pm-1', choice: 1 });
  await bridge.setPracticeMistakeResolved?.({ mistakeId: 'pm-1', resolved: true });
  await bridge.exportMistakeSheet?.({ workspaceId: 'ws-1', dueOnly: true });
  await bridge.listProfile();
  await bridge.createProfileEntry({ category: 'identity', text: '早上效率高' });
  await bridge.updateProfileEntry({ id: 'pf-1', confidence: 'confirmed' });
  await bridge.deleteProfileEntry({ id: 'pf-1' });
  await bridge.setConversationPermissions('c1', { web: true, write: false, shell: false });
  await bridge.submitPracticeShortAnswer({
    questionId: 'q-1',
    response: '极限是 1',
    selfCorrect: true
  });
  await bridge.listPendingCommitments({ byDate: '2026-11-01' });
  await bridge.listCommitments();
  await bridge.resolveCommitmentEntry({
    id: 'cm-1',
    action: 'reschedule',
    due: '2026-11-25'
  });
  await bridge.listWeekAvailability();
  await bridge.clearWeekAvailability({ weekStart: '2026-11-23' });
  // iter33 P2b①: the single focus-snapshot slot.
  await bridge.getFocusSnapshot();
  await bridge.setFocusSnapshot({
    workspaceId: 'ws-1',
    session: {
      sessionId: 1,
      taskId: 't1',
      taskTitle: '极限',
      remainingMs: 600_000,
      running: false,
      recorded: false,
      lastTickAt: 0
    }
  });
  // iter34 P0: the 错因 / 归档 channels ride last, same rule.
  await bridge.setPracticeMistakeCause?.({ mistakeId: 'pm-1', cause: '导数链没拆完' });
  await bridge.archiveResolvedPracticeMistakes?.({ workspaceId: 'ws-1' });
  await bridge.listArchivedPracticeMistakes?.('ws-1');
  await bridge.restorePracticeMistake?.({ mistakeId: 'pm-1' });

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
  expect(calls.at(-30)).toEqual({
    channel: IPC_CHANNELS.searchAll,
    args: [{ query: '极限', limit: 5 }]
  });
  expect(calls.at(-29)).toEqual({
    channel: IPC_CHANNELS.deleteTask,
    args: [{ taskId: 't1' }]
  });
  expect(calls.at(-28)).toEqual({
    channel: IPC_CHANNELS.deleteReminder,
    args: [{ id: 'r1' }]
  });
  expect(calls.at(-27)).toEqual({
    channel: IPC_CHANNELS.createMemory,
    args: [{ workspaceId: 'ws-1', text: '更喜欢早上学习', kind: 'preference' }]
  });
  expect(calls.at(-26)).toEqual({
    channel: IPC_CHANNELS.deleteWorkspace,
    args: [{ workspaceId: 'ws-1' }]
  });
  expect(calls.at(-25)).toEqual({
    channel: IPC_CHANNELS.updateLongPlan,
    args: [{ planId: 'lp-1', goal: '学会 LangGraph', weeklyHours: 8 }]
  });
  expect(calls.at(-24)).toEqual({
    channel: IPC_CHANNELS.mergeKnowledgeTopics,
    args: [{ sourceId: 'kt-1', targetId: 'kt-2' }]
  });
  expect(calls.at(-23)).toEqual({
    channel: IPC_CHANNELS.deleteNote,
    args: [{ noteId: 'n1' }]
  });
  expect(calls.at(-22)).toEqual({
    channel: IPC_CHANNELS.updatePracticeSet,
    args: [{ setId: 'ps-1', title: '线代冲刺' }]
  });
  expect(calls.at(-21)).toEqual({
    channel: IPC_CHANNELS.deletePracticeSet,
    args: [{ setId: 'ps-1' }]
  });
  expect(calls.at(-20)).toEqual({
    channel: IPC_CHANNELS.reviewPracticeMistake,
    args: [{ mistakeId: 'pm-1', choice: 1 }]
  });
  expect(calls.at(-19)).toEqual({
    channel: IPC_CHANNELS.setPracticeMistakeResolved,
    args: [{ mistakeId: 'pm-1', resolved: true }]
  });
  expect(calls.at(-18)).toEqual({
    channel: IPC_CHANNELS.exportMistakeSheet,
    args: [{ workspaceId: 'ws-1', dueOnly: true }]
  });
  expect(calls.at(-13)).toEqual({
    channel: IPC_CHANNELS.setConversationPermissions,
    args: [{ conversationId: 'c1', permissions: { web: true, write: false, shell: false } }]
  });
  expect(calls.at(-12)).toEqual({
    channel: IPC_CHANNELS.submitPracticeShortAnswer,
    args: [{ questionId: 'q-1', response: '极限是 1', selfCorrect: true }]
  });
  expect(calls.at(-11)).toEqual({
    channel: IPC_CHANNELS.listPendingCommitments,
    args: [{ byDate: '2026-11-01' }]
  });
  expect(calls.at(-10)).toEqual({ channel: IPC_CHANNELS.listCommitments, args: [undefined] });
  expect(calls.at(-9)).toEqual({
    channel: IPC_CHANNELS.resolveCommitmentEntry,
    args: [{ id: 'cm-1', action: 'reschedule', due: '2026-11-25' }]
  });
  expect(calls.at(-8)).toEqual({ channel: IPC_CHANNELS.listWeekAvailability, args: [] });
  expect(calls.at(-7)).toEqual({
    channel: IPC_CHANNELS.clearWeekAvailability,
    args: [{ weekStart: '2026-11-23' }]
  });
  // iter34 P0: the four new practice channels are appended; the snapshot pair
  // sits just before them.
  expect(calls.at(-4)).toEqual({
    channel: IPC_CHANNELS.setPracticeMistakeCause,
    args: [{ mistakeId: 'pm-1', cause: '导数链没拆完' }]
  });
  expect(calls.at(-3)).toEqual({
    channel: IPC_CHANNELS.archiveResolvedPracticeMistakes,
    args: [{ workspaceId: 'ws-1' }]
  });
  expect(calls.at(-2)).toEqual({
    channel: IPC_CHANNELS.listArchivedPracticeMistakes,
    args: ['ws-1']
  });
  expect(calls.at(-1)).toEqual({
    channel: IPC_CHANNELS.restorePracticeMistake,
    args: [{ mistakeId: 'pm-1' }]
  });
  // iter33 P2b①: the snapshot channels ride just before them, payload whole.
  expect(calls.at(-6)).toEqual({ channel: IPC_CHANNELS.getFocusSnapshot, args: [] });
  expect(calls.at(-5)?.channel).toBe(IPC_CHANNELS.setFocusSnapshot);
  expect((calls.at(-5)?.args as unknown[])[0]).toEqual({
    workspaceId: 'ws-1',
    session: {
      sessionId: 1,
      taskId: 't1',
      taskTitle: '极限',
      remainingMs: 600_000,
      running: false,
      recorded: false,
      lastTickAt: 0
    }
  });
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
    channel: IPC_CHANNELS.getKnowledgeNote,
    args: ['kt-1']
  });
  expect(calls[42]).toEqual({
    channel: IPC_CHANNELS.saveKnowledgeNote,
    args: [{ topicId: 'kt-1', body: 'b' }]
  });
  expect(calls[43]).toEqual({
    channel: IPC_CHANNELS.getKnowledgeBacklinks,
    args: ['kt-1']
  });
  expect(calls[44]).toEqual({
    channel: IPC_CHANNELS.searchWorkspace,
    args: [{ workspaceId: 'ws-1', query: '极限', limit: 5 }]
  });
  expect(calls[49]).toEqual({
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
  expect(calls[51]).toEqual({
    channel: IPC_CHANNELS.renameConversation,
    args: [{ conversationId: 'c1', title: '数学复盘' }]
  });
  expect(calls[52]).toEqual({
    channel: IPC_CHANNELS.setConversationPinned,
    args: [{ conversationId: 'c1', pinned: true }]
  });
  expect(calls[53]).toEqual({
    channel: IPC_CHANNELS.truncateConversationMessages,
    args: [{ conversationId: 'c1', keepCount: 2 }]
  });
  expect(calls[54]).toEqual({
    channel: IPC_CHANNELS.searchConversations,
    args: ['极限']
  });
  expect(calls[55]).toEqual({
    channel: IPC_CHANNELS.setConversationModel,
    args: [{ conversationId: 'c1', model: 'gpt-x' }]
  });
  expect(calls[56]).toEqual({ channel: IPC_CHANNELS.getUsageSummary, args: [7] });
  expect(calls[57]).toEqual({ channel: IPC_CHANNELS.clearUsage, args: [] });
  expect(calls[58]?.args).toEqual([{ message: 'hi' }]);
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
