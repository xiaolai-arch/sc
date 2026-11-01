import { createButlerTools, executeButlerTool } from '../../src/main/butler/tools';
import type { WorkspaceService } from '../../src/shared/workspace';

const workspaceService = {
  listWorkspaces: async () => [],
  getWorkspaceSnapshot: async () => {
    throw new Error('not used');
  },
  createWorkspace: async (input: {
    name: string;
    kind: string;
    goal: string;
    description: string;
  }) => ({
    id: 'ws-new',
    name: input.name,
    kind: input.kind,
    color: '#0071e3',
    goal: input.goal,
    description: input.description
  }),
  createTask: async (input: {
    workspaceId: string;
    title: string;
    subject: string;
    durationMin: number;
    acceptance: string;
  }) => ({
    id: 'task-1',
    ...input,
    status: 'pending'
  }),
  createReminder: async (input: { time: string; label: string; enabled?: boolean }) => ({
    id: 'rem-1',
    time: input.time,
    label: input.label,
    enabled: input.enabled ?? true
  }),
  updateWorkspaceTask: async () => {
    throw new Error('not used');
  },
  createNote: async () => {
    throw new Error('not used');
  },
  updateNote: async () => {
    throw new Error('not used');
  },
  getMemory: async () => [],
  getReminders: async () => [],
  submitReview: async () => undefined
} as unknown as WorkspaceService;

const tools = createButlerTools();
const context = { workspace: workspaceService, workspaceId: 'ws-exam', now: () => new Date() };

test('creates a workspace through a tool call', async () => {
  const result = await executeButlerTool(
    {
      id: 'c1',
      name: 'create_workspace',
      arguments: { name: '英语', kind: 'study', goal: '每天读外刊' }
    },
    tools,
    context
  );
  expect(result.ok).toBe(true);
  expect(JSON.parse(result.content)).toMatchObject({
    ok: true,
    result: { workspaceId: 'ws-new', name: '英语', kind: 'study' }
  });
});

test('creates a task in the current workspace by default', async () => {
  const result = await executeButlerTool(
    {
      id: 'c2',
      name: 'create_task',
      arguments: {
        title: '精读一篇',
        subject: '英语',
        durationMin: 30,
        acceptance: '整理 5 个表达'
      }
    },
    tools,
    context
  );
  expect(result.ok).toBe(true);
  expect(JSON.parse(result.content)).toMatchObject({
    ok: true,
    result: {
      id: 'task-1',
      workspaceId: 'ws-exam',
      title: '精读一篇',
      status: 'pending'
    }
  });
});

test('sets a global reminder', async () => {
  const result = await executeButlerTool(
    {
      id: 'c3',
      name: 'set_reminder',
      arguments: { time: '21:30', label: '复盘' }
    },
    tools,
    context
  );
  expect(result.ok).toBe(true);
  expect(JSON.parse(result.content)).toMatchObject({
    ok: true,
    result: { id: 'rem-1', time: '21:30', label: '复盘' }
  });
});

test('reports missing workspace and reminder capability', async () => {
  const noWorkspace = await executeButlerTool(
    {
      id: 'c4',
      name: 'create_task',
      arguments: { title: '任务', durationMin: 20 }
    },
    tools,
    { workspace: workspaceService, now: () => new Date() }
  );
  expect(noWorkspace.ok).toBe(false);
  expect(noWorkspace.content).toContain('workspaceId');

  const noReminder = await executeButlerTool(
    {
      id: 'c5',
      name: 'set_reminder',
      arguments: { time: '21:30', label: '复盘' }
    },
    tools,
    {
      workspace: { ...workspaceService, createReminder: undefined } as unknown as WorkspaceService,
      now: () => new Date()
    }
  );
  expect(noReminder.ok).toBe(false);
  expect(noReminder.content).toContain('不支持写入提醒');
});
