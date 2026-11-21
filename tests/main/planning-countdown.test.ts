import { FakeModelClient } from '../../src/main/agent/model-client';
import {
  buildWorkspacePlanPrompt,
  createWorkspacePlanner,
  WORKSPACE_PLAN_SYSTEM_PROMPT
} from '../../src/main/planning';
import type {
  CreateNoteInput,
  CreateTaskInput,
  CreateWorkspaceInput,
  MemoryItem,
  Reminder,
  SubmitReviewInput,
  UpdateWorkspaceNoteInput,
  UpdateWorkspaceTaskInput,
  Workspace,
  WorkspaceNote,
  WorkspaceService,
  WorkspaceSnapshot,
  WorkspaceTask
} from '../../src/shared/workspace';

const DATE = '2026-11-21';

const WORKSPACE: Workspace = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#ef4444',
  goal: '2027 考研上岸',
  description: '每天推进一点'
};

/**
 * The exact user prompt this workspace produced before target dates existed.
 * Pinned so adding the countdown cannot quietly reshape today's prompt for
 * projects that have not set a date.
 */
const PRE_CHANGE_USER_PROMPT = [
  `今天：${DATE}`,
  '今日可用时间：约 90 分钟（用户本次说明）',
  '工作区：考研（exam）',
  '工作区目标：2027 考研上岸',
  '工作区说明：每天推进一点',
  '最近记录：暂无。',
  '相关记忆：暂无。',
  `请结合以上信息，为 ${DATE} 安排 1-5 个任务，总时长接近 90 分钟。只输出 JSON。`
].join('\n');

function promptFor(workspace: Workspace): { system: string; user: string } {
  return buildWorkspacePlanPrompt({
    workspace,
    notes: [],
    memory: [],
    date: DATE,
    availableMinutes: 90,
    availableMinutesSource: 'input'
  });
}

test('without a target date the planner prompt is byte-identical to before', () => {
  const prompt = promptFor(WORKSPACE);
  expect(prompt.user).toBe(PRE_CHANGE_USER_PROMPT);
  expect(prompt.system).toBe(WORKSPACE_PLAN_SYSTEM_PROMPT);
  expect(prompt.user).not.toContain('目标日期');
  expect(prompt.user).not.toContain('轮次');
  // An unreadable date must behave like no date at all.
  expect(promptFor({ ...WORKSPACE, targetDate: '2027-02-31' }).user).toBe(PRE_CHANGE_USER_PROMPT);
});

test('a target date adds the remaining days and the review-rounds instruction', () => {
  const prompt = promptFor({ ...WORKSPACE, targetDate: '2027-12-19' });

  expect(prompt.user).toContain('目标日期：2027-12-19（距离 2026-11-21 还有 393 天）');
  expect(prompt.user).toContain('复习轮次');
  expect(prompt.user).toContain('基础 → 强化 → 冲刺');
  expect(prompt.user).toContain('393 天');
  // The countdown sits right after the workspace description and before notes.
  const lines = prompt.user.split('\n');
  const targetAt = lines.findIndex((line) => line.startsWith('目标日期：'));
  expect(targetAt).toBe(5);
  expect(lines[targetAt + 1]).toContain('复习轮次');
  // Everything the old prompt said is still there.
  expect(prompt.system).toBe(WORKSPACE_PLAN_SYSTEM_PROMPT);
  for (const line of PRE_CHANGE_USER_PROMPT.split('\n')) {
    expect(prompt.user).toContain(line);
  }
});

test('a passed deadline still asks for rounds instead of a negative countdown', () => {
  const prompt = promptFor({ ...WORKSPACE, targetDate: '2026-11-19' });

  expect(prompt.user).toContain('目标日期：2026-11-19（已过去 2 天）');
  expect(prompt.user).toContain('复习轮次');
  expect(prompt.user).not.toContain('还有 -2 天');
});

class FakeWorkspaceService implements WorkspaceService {
  constructor(private readonly snapshot: WorkspaceSnapshot) {}

  async getWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
    if (workspaceId !== this.snapshot.workspace.id) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }
    return this.snapshot;
  }

  async listWorkspaces(): Promise<Workspace[]> {
    return [this.snapshot.workspace];
  }

  async createWorkspace(_input: CreateWorkspaceInput): Promise<Workspace> {
    throw new Error('not used');
  }

  async createTask(_input: CreateTaskInput): Promise<WorkspaceTask> {
    throw new Error('not used');
  }

  async updateWorkspaceTask(_input: UpdateWorkspaceTaskInput): Promise<WorkspaceTask> {
    throw new Error('not used');
  }

  async createNote(_input: CreateNoteInput): Promise<WorkspaceNote> {
    throw new Error('not used');
  }

  async updateNote(_input: UpdateWorkspaceNoteInput): Promise<WorkspaceNote> {
    throw new Error('not used');
  }

  async getMemory(_workspaceId?: string): Promise<MemoryItem[]> {
    return [];
  }

  async getReminders(): Promise<Reminder[]> {
    return [];
  }

  async submitReview(_input: SubmitReviewInput): Promise<void> {
    throw new Error('not used');
  }
}

test('the planner threads the workspace target date into the model prompt', async () => {
  const client = new FakeModelClient([
    '{"tasks":[{"title":"极限错题","subject":"数学","durationMin":45,"acceptance":"完成 10 题"}]}'
  ]);
  const planner = createWorkspacePlanner({
    modelClient: client,
    workspaceService: new FakeWorkspaceService({
      workspace: { ...WORKSPACE, targetDate: '2027-12-19' },
      tasks: [],
      notes: [],
      memory: [],
      reminders: []
    }),
    now: () => new Date(2026, 10, 21, 9, 0, 0)
  });

  await planner.plan({ workspaceId: 'ws-exam', date: DATE, availableMinutes: 90 });

  const user = client.calls[0]?.messages.find((message) => message.role === 'user')?.content;
  expect(user).toContain('目标日期：2027-12-19（距离 2026-11-21 还有 393 天）');
  expect(user).toContain('复习轮次');
});

test('the planner prompt stays unchanged when the project has no target date', async () => {
  const client = new FakeModelClient([
    '{"tasks":[{"title":"极限错题","subject":"数学","durationMin":45,"acceptance":"完成 10 题"}]}'
  ]);
  const planner = createWorkspacePlanner({
    modelClient: client,
    workspaceService: new FakeWorkspaceService({
      workspace: WORKSPACE,
      tasks: [],
      notes: [],
      memory: [],
      reminders: []
    }),
    now: () => new Date(2026, 10, 21, 9, 0, 0)
  });

  await planner.plan({ workspaceId: 'ws-exam', date: DATE, availableMinutes: 90 });

  const user = client.calls[0]?.messages.find((message) => message.role === 'user')?.content;
  expect(user).toBe(PRE_CHANGE_USER_PROMPT);
});
