import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ButlerService, WorkspaceService } from '../../src/shared/workspace';
import { createAppContext, type AppContext } from '../../src/main/context';
import {
  IPC_CHANNELS,
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
  return { send: vi.fn().mockResolvedValue({ text: '好的' }), ...overrides };
}

async function makeContext(
  workspace: WorkspaceService = fakeWorkspace(),
  butler: ButlerService = fakeButler()
): Promise<{ context: AppContext; dir: string; workspace: WorkspaceService; butler: ButlerService }> {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-ipc-'));
  cleanup.push(dir);
  const context = await createAppContext({
    userDataPath: dir,
    defaultVaultPath: join(dir, 'vault'),
    workspaceService: workspace,
    butlerService: butler,
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

  expect(registered.size).toBe(Object.keys(IPC_CHANNELS).length);
  for (const channel of Object.values(IPC_CHANNELS)) {
    expect(registered.has(channel)).toBe(true);
  }
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

test('rejects malformed handler parameters before they reach services', async () => {
  const { context, workspace } = await makeContext();
  const handlers = createIpcHandlers(context.api);

  await expect(handlers.getWorkspaceSnapshot('   ')).rejects.toThrow('工作区 ID不能为空。');
  await expect(
    handlers.createTask({ workspaceId: 'ws-1', subject: '数学', durationMin: 30, acceptance: '完成' })
  ).rejects.toThrow('任务标题不能为空。');
  await expect(
    handlers.createTask({ workspaceId: 'ws-1', title: 't', subject: '数学', durationMin: 0, acceptance: '完成' })
  ).rejects.toThrow('任务时长无效。');
  await expect(handlers.updateWorkspaceTask({ taskId: 't1', status: 'later' })).rejects.toThrow(
    '任务状态无效。'
  );
  await expect(handlers.updateNote({ noteId: '' })).rejects.toThrow('笔记 ID不能为空。');
  await expect(handlers.submitReview({ date: '2026-10-31' })).rejects.toThrow(
    '复盘答案参数无效。'
  );
  await expect(handlers.send({ message: '   ' })).rejects.toThrow('消息内容不能为空。');
  await expect(handlers.setApiKey(42)).rejects.toThrow('API key不能为空。');
  await expect(handlers.createWorkspace(null)).rejects.toThrow('创建工作区参数无效。');

  expect(workspace.createTask).not.toHaveBeenCalled();
  expect(workspace.updateWorkspaceTask).not.toHaveBeenCalled();
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

test('api key is never echoed by settings, bootstrap or workspace payloads', async () => {
  const { context, dir } = await makeContext();
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
