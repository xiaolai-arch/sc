import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ButlerService, WorkspaceService } from '../../src/shared/workspace';
import type { PracticeService } from '../../src/shared/practice';
import type { StudyCoachApi } from '../../src/shared/ipc';
import { createAppContext, type AppContext } from '../../src/main/context';
import {
  BUTLER_RUN_CHANNELS,
  BUTLER_STREAM_CHANNELS,
  IPC_CHANNELS,
  VIDEO_NOTES_CHANNELS,
  createIpcHandlers,
  registerIpcHandlers,
  serializeError
} from '../../src/main/ipc';
import { InMemorySecretStore } from '../../src/main/settings/secret-store';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fakeWorkspace(overrides: Partial<WorkspaceService> = {}): WorkspaceService {
  return {
    listWorkspaces: vi.fn().mockResolvedValue([]),
    createWorkspace: vi.fn(),
    getWorkspaceSnapshot: vi.fn(),
    createTask: vi.fn(),
    updateWorkspaceTask: vi.fn(),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    getMemory: vi.fn().mockResolvedValue([]),
    getReminders: vi.fn().mockResolvedValue([]),
    submitReview: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as WorkspaceService;
}

function fakeButler(overrides: Partial<ButlerService> = {}): ButlerService {
  return {
    send: vi.fn().mockResolvedValue({ text: '好的' }),
    stream: vi.fn().mockResolvedValue({ text: '好的' }),
    ...overrides
  };
}

async function makeContext(
  workspace: WorkspaceService = fakeWorkspace(),
  butler: ButlerService = fakeButler(),
  practiceService?: PracticeService
): Promise<{ context: AppContext; dir: string; workspace: WorkspaceService; butler: ButlerService }> {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-ipc-'));
  cleanup.push(dir);
  const context = await createAppContext({
    userDataPath: dir,
    defaultVaultPath: join(dir, 'vault'),
    workspaceService: workspace,
    butlerService: butler,
    ...(practiceService ? { practiceService } : {}),
    secretStore: new InMemorySecretStore(),
    now: () => new Date(2026, 9, 31, 10, 0, 0)
  });
  return { context, dir, workspace, butler };
}

test('registers every channel exactly once', async () => {
  const { context } = await makeContext();
  const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  registerIpcHandlers(context.api, {
    handle(channel, listener) {
      expect(registered.has(channel)).toBe(false);
      registered.set(channel, listener);
    }
  });

  expect(registered.size).toBe(Object.keys(IPC_CHANNELS).length + 12);
  for (const channel of Object.values(IPC_CHANNELS)) {
    expect(registered.has(channel)).toBe(true);
  }
  expect(registered.has(BUTLER_STREAM_CHANNELS.stream)).toBe(true);
  expect(registered.has(BUTLER_STREAM_CHANNELS.cancel)).toBe(true);
  expect(registered.has(BUTLER_RUN_CHANNELS.list)).toBe(true);
  expect(registered.has(BUTLER_RUN_CHANNELS.cancel)).toBe(true);
  expect(registered.has(VIDEO_NOTES_CHANNELS.generate)).toBe(true);
  expect(registered.has(VIDEO_NOTES_CHANNELS.enqueue)).toBe(true);
  expect(registered.has(VIDEO_NOTES_CHANNELS.listJobs)).toBe(true);
});

test('routes every channel to the matching api method', async () => {
  const workspace = fakeWorkspace({
    listWorkspaces: vi.fn().mockResolvedValue([{ id: 'ws-1' }]),
    createWorkspace: vi.fn().mockResolvedValue({ id: 'ws-2' }),
    getWorkspaceSnapshot: vi.fn().mockResolvedValue({ workspace: { id: 'ws-1' } }),
    createTask: vi.fn().mockResolvedValue({ id: 'task-1' }),
    updateWorkspaceTask: vi.fn().mockResolvedValue({ id: 'task-1', status: 'done' }),
    createNote: vi.fn().mockResolvedValue({ id: 'note-1' }),
    updateNote: vi.fn().mockResolvedValue({ id: 'note-1' }),
    getMemory: vi.fn().mockResolvedValue([{ id: 'memory-1' }]),
    getReminders: vi.fn().mockResolvedValue([{ id: 'reminder-1' }]),
    submitReview: vi.fn().mockResolvedValue(undefined)
  });
  const butler = fakeButler({ send: vi.fn().mockResolvedValue({ text: '回复' }) });
  const { context } = await makeContext(workspace, butler);
  const handlers = createIpcHandlers(context.api);

  expect(await handlers.listWorkspaces()).toEqual([{ id: 'ws-1' }]);
  expect(await handlers.getWorkspaceSnapshot('ws-1')).toEqual({ workspace: { id: 'ws-1' } });
  expect(await handlers.getMemory(undefined)).toEqual([{ id: 'memory-1' }]);
  expect(await handlers.getReminders()).toEqual([{ id: 'reminder-1' }]);
  expect(
    await handlers.send({ workspaceId: 'ws-1', message: '今天学什么？' })
  ).toEqual({ text: '回复' });

  expect(workspace.getWorkspaceSnapshot).toHaveBeenCalledWith('ws-1');
  expect(workspace.getMemory).toHaveBeenCalledWith(undefined);
  expect(butler.send).toHaveBeenCalledWith({ workspaceId: 'ws-1', message: '今天学什么？' });
});

test('deletes a note through the workspace service', async () => {
  const deleteNote = vi.fn().mockResolvedValue(undefined);
  const workspace = fakeWorkspace({ deleteNote });
  const { context } = await makeContext(workspace);
  const handlers = createIpcHandlers(context.api);

  await handlers.deleteNote({ noteId: 'note-1' });

  expect(deleteNote).toHaveBeenCalledWith({ noteId: 'note-1' });
});

test('updates and deletes practice sets through the practice service', async () => {
  const updateSet = vi.fn().mockResolvedValue({ id: 'ps-1', title: '线代冲刺' });
  const deleteSet = vi.fn().mockResolvedValue(undefined);
  const practice = {
    listSets: vi.fn(),
    getSet: vi.fn(),
    createSet: vi.fn(),
    updateSet,
    deleteSet,
    submitAnswer: vi.fn(),
    getMistakes: vi.fn(),
    getDue: vi.fn(),
    listAttempts: vi.fn()
  } as unknown as PracticeService;
  const { context } = await makeContext(fakeWorkspace(), fakeButler(), practice);
  const handlers = createIpcHandlers(context.api);

  await handlers.updatePracticeSet({ setId: 'ps-1', title: '线代冲刺' });
  const questions = [{ prompt: '矩阵可逆的条件？', options: ['A', 'B'], answer: 1 }];
  await handlers.updatePracticeSet({ setId: 'ps-1', questions });
  await handlers.updatePracticeSet({
    setId: 'ps-1',
    reviewedAt: '2026-11-21T10:00:00.000Z'
  });
  await handlers.deletePracticeSet({ setId: 'ps-1' });

  expect(updateSet).toHaveBeenCalledWith({ setId: 'ps-1', title: '线代冲刺' });
  expect(updateSet).toHaveBeenCalledWith({ setId: 'ps-1', questions });
  expect(updateSet).toHaveBeenCalledWith({
    setId: 'ps-1',
    reviewedAt: '2026-11-21T10:00:00.000Z'
  });
  expect(deleteSet).toHaveBeenCalledWith({ setId: 'ps-1' });
});

test('exports the mistake review sheet through the practice service', async () => {
  const exportMistakeSheet = vi.fn().mockResolvedValue({
    path: 'workspaces/kaoyan/practice/review-sheets/2026-11-01.md',
    count: 2,
    date: '2026-11-01'
  });
  const practice = {
    listSets: vi.fn(),
    getSet: vi.fn(),
    createSet: vi.fn(),
    submitAnswer: vi.fn(),
    getMistakes: vi.fn(),
    getDue: vi.fn(),
    listAttempts: vi.fn(),
    exportMistakeSheet
  } as unknown as PracticeService;
  const { context } = await makeContext(fakeWorkspace(), fakeButler(), practice);
  const handlers = createIpcHandlers(context.api);

  const result = await handlers.exportMistakeSheet({ workspaceId: 'kaoyan' });
  expect(result).toMatchObject({ count: 2 });

  await handlers.exportMistakeSheet({ workspaceId: 'kaoyan', dueOnly: true });
  expect(exportMistakeSheet).toHaveBeenLastCalledWith({
    workspaceId: 'kaoyan',
    dueOnly: true
  });

  // The empty id and the bad dueOnly never reach the service.
  await expect(handlers.exportMistakeSheet({ workspaceId: '' })).rejects.toThrow(
    '项目 ID不能为空。'
  );
  await expect(
    handlers.exportMistakeSheet({ workspaceId: 'kaoyan', dueOnly: 'yes' })
  ).rejects.toThrow('导出范围参数无效。');
  expect(exportMistakeSheet).toHaveBeenCalledTimes(2);
});

test('submits a short answer with a typed response and a self-assessment', async () => {
  const submitShortAnswer = vi.fn().mockResolvedValue({
    questionId: 'q-1',
    correct: false,
    attempt: { id: 'pa-1', response: '极限是 0' }
  });
  const practice = {
    listSets: vi.fn(),
    getSet: vi.fn(),
    createSet: vi.fn(),
    submitAnswer: vi.fn(),
    submitShortAnswer,
    getMistakes: vi.fn(),
    getDue: vi.fn(),
    listAttempts: vi.fn()
  } as unknown as PracticeService;
  const { context } = await makeContext(fakeWorkspace(), fakeButler(), practice);
  const handlers = createIpcHandlers(context.api);

  const result = await handlers.submitPracticeShortAnswer({
    questionId: 'q-1',
    response: '极限是 0',
    selfCorrect: false
  });
  expect(result).toMatchObject({ questionId: 'q-1', correct: false });
  expect(submitShortAnswer).toHaveBeenCalledWith({
    questionId: 'q-1',
    response: '极限是 0',
    selfCorrect: false
  });

  // Stricter than the service: blanks, a non-boolean verdict and a missing id
  // never cross the IPC boundary.
  await expect(
    handlers.submitPracticeShortAnswer({ questionId: 'q-1', response: '  ', selfCorrect: true })
  ).rejects.toThrow('回答内容不能为空。');
  await expect(
    handlers.submitPracticeShortAnswer({ questionId: 'q-1', response: '答', selfCorrect: 1 })
  ).rejects.toThrow('自评参数无效。');
  await expect(
    handlers.submitPracticeShortAnswer({ response: '答', selfCorrect: true })
  ).rejects.toThrow('题目 ID不能为空。');
  expect(submitShortAnswer).toHaveBeenCalledTimes(1);
});

test('reads pending promises for the day and rejects a bad date early', async () => {
  const listPendingCommitments = vi.fn().mockResolvedValue([
    {
      id: 'cm-1',
      text: '整理错题',
      due: '2026-11-22',
      status: 'open',
      createdAt: '2026-11-21T08:00:00.000Z'
    }
  ]);
  const { context } = await makeContext();
  const handlers = createIpcHandlers({
    ...context.api,
    listPendingCommitments
  });

  const pending = await handlers.listPendingCommitments({ byDate: '2026-11-22' });
  expect(pending).toEqual([
    {
      id: 'cm-1',
      text: '整理错题',
      due: '2026-11-22',
      status: 'open',
      createdAt: '2026-11-21T08:00:00.000Z'
    }
  ]);
  expect(listPendingCommitments).toHaveBeenCalledWith({ byDate: '2026-11-22' });

  // A blank or malformed day never reaches the service.
  await expect(handlers.listPendingCommitments({ byDate: '' })).rejects.toThrow(
    '日期不能为空。'
  );
  await expect(handlers.listPendingCommitments({ byDate: '22-11-2026' })).rejects.toThrow(
    '日期格式必须为 YYYY-MM-DD。'
  );
  await expect(handlers.listPendingCommitments(null)).rejects.toThrow('读取承诺参数无效。');
  expect(listPendingCommitments).toHaveBeenCalledTimes(1);
});

test('reviews a short mistake over IPC with its typed answer', async () => {
  const reviewMistake = vi.fn().mockResolvedValue({ questionId: 'q-1', correct: true });
  const practice = {
    listSets: vi.fn(),
    getSet: vi.fn(),
    createSet: vi.fn(),
    submitAnswer: vi.fn(),
    submitShortAnswer: vi.fn(),
    reviewMistake,
    getMistakes: vi.fn(),
    getDue: vi.fn(),
    listAttempts: vi.fn()
  } as unknown as PracticeService;
  const { context } = await makeContext(fakeWorkspace(), fakeButler(), practice);
  const handlers = createIpcHandlers(context.api);

  await handlers.reviewPracticeMistake({
    mistakeId: 'pm-1',
    response: '极限是 1',
    selfCorrect: true
  });
  expect(reviewMistake).toHaveBeenCalledWith({
    mistakeId: 'pm-1',
    response: '极限是 1',
    selfCorrect: true
  });

  // The choice shape still validates the same way.
  await expect(
    handlers.reviewPracticeMistake({ mistakeId: 'pm-1', choice: 1.5 })
  ).rejects.toThrow('选项无效。');
});

test('rejects malformed handler parameters before they reach services', async () => {
  const { context, workspace } = await makeContext();
  const handlers = createIpcHandlers(context.api);

  await expect(handlers.getWorkspaceSnapshot('   ')).rejects.toThrow('项目 ID不能为空。');
  await expect(
    handlers.createTask({ workspaceId: 'ws-1', subject: '数学', durationMin: 30, acceptance: '完成' })
  ).rejects.toThrow('任务标题不能为空。');
  await expect(
    handlers.createTask({ workspaceId: 'ws-1', title: 't', subject: '数学', durationMin: 0, acceptance: '完成' })
  ).rejects.toThrow('任务时长无效。');
  await expect(
    handlers.createTask({ workspaceId: 'ws-1', title: 't', subject: '数学', durationMin: 30 })
  ).rejects.toThrow('任务验收标准无效。');
  await expect(
    handlers.createTask({
      workspaceId: 'ws-1',
      title: 't',
      subject: '数学',
      durationMin: 30,
      acceptance: '',
      repeat: 'monthly'
    })
  ).rejects.toThrow('任务重复规则无效。');
  await expect(
    handlers.updateWorkspaceTask({ taskId: 't1', repeat: 'monthly' })
  ).rejects.toThrow('任务重复规则无效。');
  await expect(handlers.updateWorkspaceTask({ taskId: 't1', status: 'later' })).rejects.toThrow(
    '任务状态无效。'
  );
  await expect(handlers.updateNote({ noteId: '' })).rejects.toThrow('笔记 ID不能为空。');
  await expect(handlers.deleteNote({ noteId: '' })).rejects.toThrow('笔记 ID不能为空。');
  await expect(handlers.updatePracticeSet({ setId: '' })).rejects.toThrow('练习 ID不能为空。');
  await expect(handlers.updatePracticeSet({ setId: 'ps-1' })).rejects.toThrow(
    '练习更新参数无效。'
  );
  await expect(handlers.updatePracticeSet({ setId: 'ps-1', questions: [] })).rejects.toThrow(
    '练习题目不能为空。'
  );
  await expect(
    handlers.updatePracticeSet({ setId: 'ps-1', reviewedAt: 'not-a-date' })
  ).rejects.toThrow('复习确认时间无效。');
  await expect(
    handlers.createPracticeSet({
      workspaceId: 'ws-1',
      title: '题',
      source: 'robot',
      questions: [{ prompt: '题？', options: ['A', 'B'], answer: 0 }]
    })
  ).rejects.toThrow('练习来源无效。');
  await expect(handlers.deletePracticeSet({ setId: '' })).rejects.toThrow('练习 ID不能为空。');
  await expect(handlers.submitReview({ date: '2026-10-31' })).rejects.toThrow(
    '复盘答案参数无效。'
  );
  await expect(handlers.send({ message: '   ' })).rejects.toThrow('消息内容不能为空。');
  await expect(handlers.setApiKey(42)).rejects.toThrow('API key不能为空。');
  await expect(handlers.createWorkspace(null)).rejects.toThrow('创建项目参数无效。');
  await expect(
    handlers.createLongPlan({ workspaceId: 'ws-1', goal: '学会 Agent', weeks: 0 })
  ).rejects.toThrow('周数必须在 1 到 16 之间。');
  await expect(
    handlers.createLongPlan({
      workspaceId: 'ws-1',
      goal: '学会 Agent',
      weeks: 2,
      references: 42
    })
  ).rejects.toThrow('参考资料无效。');
  await expect(
    handlers.createLongPlan({
      workspaceId: 'ws-1',
      goal: '学会 Agent',
      weeks: 2,
      research: 'yes'
    })
  ).rejects.toThrow('联网调研选项无效。');
  await expect(
    handlers.recalibrateLongPlan({ planId: '   ' })
  ).rejects.toThrow('计划 ID不能为空。');
  await expect(
    handlers.recalibrateLongPlan({ planId: 'lp-1', weeklyHours: '8' })
  ).rejects.toThrow('每周投入参数无效。');
  await expect(
    handlers.recalibrateLongPlan({ planId: 'lp-1', notes: 42 })
  ).rejects.toThrow('重排说明无效。');
  await expect(
    handlers.setLongPlanItemDone({
      planId: 'lp-1',
      weekId: 'w1',
      itemId: 'w1d1',
      kind: 'week',
      done: true
    })
  ).rejects.toThrow('条目类型无效。');

  expect(workspace.createTask).not.toHaveBeenCalled();
  expect(workspace.updateWorkspaceTask).not.toHaveBeenCalled();
});

test('lets a task with an empty optional acceptance standard through', async () => {
  const { context, workspace } = await makeContext();
  const handlers = createIpcHandlers(context.api);

  await handlers.createTask({
    workspaceId: 'ws-1',
    title: 't',
    subject: '数学',
    durationMin: 30,
    acceptance: ''
  });

  expect(workspace.createTask).toHaveBeenCalledWith({
    workspaceId: 'ws-1',
    title: 't',
    subject: '数学',
    durationMin: 30,
    acceptance: ''
  });
});

test('validates and forwards a task cue through the task handlers', async () => {
  const { context, workspace } = await makeContext(
    fakeWorkspace({
      updateWorkspaceTask: vi
        .fn()
        .mockResolvedValue({ id: 't1', status: 'pending', planId: undefined })
    })
  );
  const handlers = createIpcHandlers(context.api);

  await handlers.createTask({
    workspaceId: 'ws-1',
    title: 't',
    subject: '数学',
    durationMin: 30,
    acceptance: '',
    cue: '  晚饭后  '
  });
  expect(workspace.createTask).toHaveBeenLastCalledWith({
    workspaceId: 'ws-1',
    title: 't',
    subject: '数学',
    durationMin: 30,
    acceptance: '',
    cue: '晚饭后'
  });

  await handlers.updateWorkspaceTask({ taskId: 't1', cue: null });
  expect(workspace.updateWorkspaceTask).toHaveBeenLastCalledWith({ taskId: 't1', cue: null });

  await expect(
    handlers.createTask({
      workspaceId: 'ws-1',
      title: 't',
      subject: '数学',
      durationMin: 30,
      acceptance: '',
      cue: '晚'.repeat(41)
    })
  ).rejects.toThrow('触发时机不能超过 40 个字符。');

  await expect(
    handlers.createTask({
      workspaceId: 'ws-1',
      title: 't',
      subject: '数学',
      durationMin: 30,
      acceptance: '',
      cue: '晚饭\n后'
    })
  ).rejects.toThrow('触发时机不能包含换行。');
});

test('serializes service errors and redacts secret-like values', async () => {
  const workspace = fakeWorkspace({
    getReminders: vi
      .fn()
      .mockRejectedValue(new Error('provider rejected key sk-live-abcdefgh12345678 and Bearer abcdefghijklmnop'))
  });
  const { context } = await makeContext(workspace);
  const handlers = createIpcHandlers(context.api);

  await expect(handlers.getReminders()).rejects.toThrow('[redacted]');
  await expect(handlers.getReminders()).rejects.not.toThrow('sk-live-abcdefgh12345678');
  await expect(handlers.getReminders()).rejects.not.toThrow('abcdefghijklmnop');

  expect(serializeError('plain string')).toEqual({ name: 'Error', message: 'plain string' });
  expect(serializeError(new Error('sk-ant-abcdefgh12345678')).message).toBe('[redacted]');
});

test('an empty API key clears the stored key when switching endpoints', async () => {
  const { context } = await makeContext();
  const handlers = createIpcHandlers(context.api);
  // A keyed provider makes bootstrap report the stored-key state.
  await context.api.updateSettings({
    provider: { kind: 'anthropic', model: 'claude-sonnet-5-5' }
  });

  await handlers.setApiKey('sk-live-clear-me-987654321');
  expect(await handlers.getBootstrap()).toMatchObject({ hasApiKey: true });

  await expect(handlers.setApiKey('')).resolves.toBeUndefined();
  expect(await handlers.getBootstrap()).toMatchObject({ hasApiKey: false });
});

test('routes strictMastery through settings and rejects a non-boolean', async () => {
  const { context } = await makeContext();
  const handlers = createIpcHandlers(context.api);

  const saved = await handlers.updateSettings({ strictMastery: true });
  expect(saved).toMatchObject({ strictMastery: true });
  expect(await handlers.getSettings()).toMatchObject({ strictMastery: true });

  const cleared = await handlers.updateSettings({ strictMastery: false });
  expect(cleared).not.toHaveProperty('strictMastery');

  await expect(handlers.updateSettings({ strictMastery: 'yes' })).rejects.toThrow(
    '严格掌握设置必须是布尔值。'
  );
  // The rejected patch never reached the store.
  expect(await handlers.getSettings()).not.toHaveProperty('strictMastery');
});

test('routes the accountability name through settings, validates it and clears it', async () => {
  const { context } = await makeContext();
  const handlers = createIpcHandlers(context.api);

  const saved = (await handlers.updateSettings({
    accountabilityName: '  小林 '
  })) as { accountabilityName?: string };
  expect(saved.accountabilityName).toBe('小林');
  expect(await handlers.getSettings()).toMatchObject({ accountabilityName: '小林' });

  await expect(
    handlers.updateSettings({ accountabilityName: '一二三四五六七八九十一二三四五六七八九十一' })
  ).rejects.toThrow('问责对象不能超过 20 字。');
  await expect(handlers.updateSettings({ accountabilityName: 42 })).rejects.toThrow(
    '问责对象必须是文本。'
  );

  const cleared = (await handlers.updateSettings({ accountabilityName: '' })) as Record<
    string,
    unknown
  >;
  expect(cleared).not.toHaveProperty('accountabilityName');
});

test('api key is never echoed by settings, bootstrap or workspace payloads', async () => {  const { context, dir } = await makeContext();
  const handlers = createIpcHandlers(context.api);
  const key = 'sk-live-never-echo-this-987654321';

  await handlers.setApiKey(key);
  expect(await handlers.getBootstrap()).toMatchObject({ hasApiKey: true });

  const payloads = JSON.stringify({
    settings: await handlers.getSettings(),
    bootstrap: await handlers.getBootstrap(),
    workspaces: await handlers.listWorkspaces(),
    memory: await handlers.getMemory(),
    reminders: await handlers.getReminders()
  });
  expect(payloads).not.toContain(key);
  expect(payloads).not.toContain('never-echo');

  const stateFile = await readFile(join(dir, 'state.json'), 'utf8').catch(() => '');
  expect(stateFile).not.toContain(key);
});

test('rejected handlers surface a single sanitized error message', async () => {
  const workspace = fakeWorkspace({ listWorkspaces: vi.fn().mockRejectedValue(new Error('boom')) });
  const { context } = await makeContext(workspace);
  const registered = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  registerIpcHandlers(context.api, {
    handle(channel, listener) {
      registered.set(channel, listener);
    }
  });
  const listener = registered.get(IPC_CHANNELS.listWorkspaces);
  expect(listener).toBeDefined();
  await expect(listener!({})).rejects.toThrow('boom');
});


test('rejects invalid knowledge topic payloads before reaching the service', async () => {
  const { context } = await makeContext();
  const handlers = createIpcHandlers(context.api);

  await expect(handlers.createKnowledgeTopic({ name: '   ' })).rejects.toThrow(/知识主题名称/);
  await expect(handlers.createKnowledgeTopic({ name: 'X', status: 'mystery' })).rejects.toThrow(
    /知识主题状态/
  );
  await expect(handlers.createKnowledgeTopic({ name: 'X', level: 0 })).rejects.toThrow(/掌握程度/);
  await expect(
    handlers.createKnowledgeTopic({ name: 'X', aliases: ['a'.repeat(41)] })
  ).rejects.toThrow(/别名/);
  await expect(handlers.updateKnowledgeTopic({ id: 'kt-1', level: 9 })).rejects.toThrow(
    /掌握程度/
  );
  await expect(handlers.deleteKnowledgeTopic('')).rejects.toThrow(/知识主题 ID/);
  await expect(handlers.listKnowledgeTopics('ws-1')).resolves.toEqual([]);
});

test('routes local CLI discovery without parameters', async () => {
  const scanLocalClis = vi.fn().mockResolvedValue({
    scannedAt: '2026-11-01T10:00:00.000Z',
    entries: []
  });
  const handlers = createIpcHandlers({ scanLocalClis } as unknown as StudyCoachApi);

  await expect(handlers.scanLocalClis()).resolves.toMatchObject({ entries: [] });
  expect(scanLocalClis).toHaveBeenCalledWith();
});

test('carries the optional confidence enum over IPC and rejects anything else', async () => {
  const submitAnswer = vi.fn().mockResolvedValue({ questionId: 'q-1', correct: true });
  const submitShortAnswer = vi.fn().mockResolvedValue({ questionId: 'q-1', correct: false });
  const reviewMistake = vi.fn().mockResolvedValue({ questionId: 'q-1', correct: true });
  const practice = {
    listSets: vi.fn(),
    getSet: vi.fn(),
    createSet: vi.fn(),
    submitAnswer,
    submitShortAnswer,
    reviewMistake,
    getMistakes: vi.fn(),
    getDue: vi.fn(),
    listAttempts: vi.fn()
  } as unknown as PracticeService;
  const { context } = await makeContext(fakeWorkspace(), fakeButler(), practice);
  const handlers = createIpcHandlers(context.api);

  await handlers.submitPracticeAnswer({ questionId: 'q-1', choice: 0, confidence: 'sure' });
  expect(submitAnswer).toHaveBeenLastCalledWith({
    questionId: 'q-1',
    choice: 0,
    confidence: 'sure'
  });
  // An unmarked answer keeps the original input shape exactly.
  await handlers.submitPracticeAnswer({ questionId: 'q-1', choice: 0 });
  expect(submitAnswer).toHaveBeenLastCalledWith({ questionId: 'q-1', choice: 0 });

  await handlers.submitPracticeShortAnswer({
    questionId: 'q-1',
    response: '极限是 1',
    selfCorrect: true,
    confidence: 'unsure'
  });
  expect(submitShortAnswer).toHaveBeenLastCalledWith({
    questionId: 'q-1',
    response: '极限是 1',
    selfCorrect: true,
    confidence: 'unsure'
  });

  await handlers.reviewPracticeMistake({ mistakeId: 'pm-1', choice: 1, confidence: 'sure' });
  expect(reviewMistake).toHaveBeenLastCalledWith({
    mistakeId: 'pm-1',
    choice: 1,
    confidence: 'sure'
  });
  await handlers.reviewPracticeMistake({
    mistakeId: 'pm-1',
    response: '极限是 1',
    selfCorrect: false,
    confidence: 'unsure'
  });
  expect(reviewMistake).toHaveBeenLastCalledWith({
    mistakeId: 'pm-1',
    response: '极限是 1',
    selfCorrect: false,
    confidence: 'unsure'
  });

  // An unknown enum value never crosses the boundary.
  await expect(
    handlers.submitPracticeAnswer({ questionId: 'q-1', choice: 0, confidence: 'certain' })
  ).rejects.toThrow('把握度参数无效。');
  await expect(
    handlers.submitPracticeShortAnswer({
      questionId: 'q-1',
      response: '答',
      selfCorrect: true,
      confidence: 'maybe'
    })
  ).rejects.toThrow('把握度参数无效。');
  await expect(
    handlers.reviewPracticeMistake({ mistakeId: 'pm-1', choice: 1, confidence: 'yes' })
  ).rejects.toThrow('把握度参数无效。');
});
