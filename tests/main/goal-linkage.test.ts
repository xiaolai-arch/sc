import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppContext } from '../../src/main/context';
import { InMemorySecretStore } from '../../src/main/settings/secret-store';
import { serializeTaskFile } from '../../src/main/workspace/records/tasks';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-goal-linkage-'));
  dirs.push(dir);
  return dir;
}

/** A context whose clock sits on 2026-11-15 so plans start there. */
async function makeContext() {
  const dir = await tempDir();
  return createAppContext({
    userDataPath: join(dir, 'user-data'),
    defaultVaultPath: join(dir, 'vault'),
    secretStore: new InMemorySecretStore(),
    modelClient: null,
    now: () => new Date(2026, 10, 15, 9, 0, 0)
  });
}

/**
 * A task file written the way the vault looked before `goalId` existed: the
 * frontmatter has no goalId key at all, and the markdown body is the plain
 * checklist the old serializer produced.
 */
const LEGACY_TASK_FILE = `---
type: plan
source: user
date: '2026-11-10'
tasks:
  - id: t-legacy
    title: 极限 10 题
    subject: 数学
    durationMin: 30
    materialRefs: []
    acceptance: 完成并订正
    status: pending
---
# 2026-11-10 任务

- [ ] 极限 10 题（数学 · 30 分钟） — 完成并订正
`;

test('a legacy task file without goalId loads and round-trips unchanged', async () => {
  const root = await tempDir();
  const workspaceDir = join(root, 'workspaces', 'kaoyan');
  const tasksDir = join(workspaceDir, 'tasks');
  await mkdir(tasksDir, { recursive: true });
  await writeFile(
    join(workspaceDir, 'workspace.md'),
    `---
type: profile
source: user
id: kaoyan
name: 考研
kind: exam
color: '#0071e3'
goal: 2027 上岸
description: ''
checkIn: daily
---
# 考研
`,
    'utf8'
  );
  const file = join(tasksDir, '2026-11-10.md');
  await writeFile(file, LEGACY_TASK_FILE, 'utf8');

  const service = createWorkspaceService(root, { seed: false });
  const snapshot = await service.getWorkspaceSnapshot('kaoyan');

  const task = snapshot.tasks.find((entry) => entry.id === 't-legacy');
  expect(task).toBeDefined();
  // Missing field means "no goal": it is never invented on read.
  expect(task).not.toHaveProperty('goalId');

  // Reading the vault never rewrites the file it read.
  expect(await readFile(file, 'utf8')).toBe(LEGACY_TASK_FILE);

  // Parse → serialize is byte-identical, so an unrelated write elsewhere cannot
  // silently flesh out this record with a blank goal.
  const reserialized = serializeTaskFile('2026-11-10', [
    {
      id: task!.id,
      title: task!.title,
      subject: task!.subject,
      durationMin: task!.durationMin,
      materialRefs: [],
      acceptance: task!.acceptance,
      status: task!.status
    }
  ]);
  expect(reserialized).toBe(LEGACY_TASK_FILE);
});

test('a legacy workspace without goalId reads with none, and gains one at the next write', async () => {
  const root = await tempDir();
  await mkdir(join(root, 'workspaces', 'kaoyan'), { recursive: true });
  await writeFile(
    join(root, 'workspaces', 'kaoyan', 'workspace.md'),
    `---
type: profile
source: user
id: kaoyan
name: 考研
kind: exam
color: '#0071e3'
goal: 2027 上岸
description: ''
checkIn: daily
---
# 考研
`,
    'utf8'
  );

  const service = createWorkspaceService(root, { seed: false });
  const before = (await service.getWorkspaceSnapshot('kaoyan')).workspace;
  expect(before.goal).toBe('2027 上岸');
  expect(before).not.toHaveProperty('goalId');

  // The first write mints a handle; the goal text is untouched.
  const updated = await service.updateWorkspace?.({ workspaceId: 'kaoyan', goal: '2027 上岸' });
  expect(updated?.goalId).toMatch(/^g-/);
  expect(updated?.goal).toBe('2027 上岸');
});

test('renaming the project and rewording the goal keeps the same goalId', async () => {
  const context = await makeContext();
  const workspace = await context.api.createWorkspace({
    name: '考研',
    kind: 'exam',
    goal: '2027 上岸',
    description: ''
  });
  const goalId = workspace.goalId;
  expect(goalId).toBeTruthy();

  const renamed = await context.api.updateWorkspace!({
    workspaceId: workspace.id,
    name: '考研（二战）'
  });
  expect(renamed.goalId).toBe(goalId);

  const reworded = await context.api.updateWorkspace!({
    workspaceId: workspace.id,
    goal: '2027 上岸，数学 130'
  });
  expect(reworded.goalId).toBe(goalId);
  expect(reworded.goal).toBe('2027 上岸，数学 130');
});

test('an older project without a goalId gains one at its first plan task', async () => {
  const root = await tempDir();
  const workspaceDir = join(root, 'workspaces', 'agent');
  await mkdir(workspaceDir, { recursive: true });
  // A project file written before goal handles existed.
  await writeFile(
    join(workspaceDir, 'workspace.md'),
    `---
type: profile
source: user
id: agent
name: 学习 Agent
kind: study
color: '#34c759'
goal: 转行做 Agent
description: ''
checkIn: daily
---
# 学习 Agent
`,
    'utf8'
  );
  const service = createWorkspaceService(root, { seed: false });
  const before = (await service.getWorkspaceSnapshot('agent')).workspace;
  expect(before).not.toHaveProperty('goalId');

  const task = await service.createTask({
    workspaceId: 'agent',
    title: '读第一本书',
    subject: '学习 Agent',
    durationMin: 30,
    acceptance: '',
    due: '2026-11-16',
    planId: 'lp-1',
    planItemId: 'w1d1'
  });

  const after = (await service.getWorkspaceSnapshot('agent')).workspace;
  expect(after.goalId).toMatch(/^g-/);
  expect(task.goalId).toBe(after.goalId);
});

test('an ordinary task on an older project never mints a goalId', async () => {
  const root = await tempDir();
  const workspaceDir = join(root, 'workspaces', 'agent');
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(
    join(workspaceDir, 'workspace.md'),
    `---
type: profile
source: user
id: agent
name: 学习 Agent
kind: study
color: '#34c759'
goal: 转行做 Agent
description: ''
checkIn: daily
---
# 学习 Agent
`,
    'utf8'
  );
  const service = createWorkspaceService(root, { seed: false });

  const task = await service.createTask({
    workspaceId: 'agent',
    title: '随手记一件事',
    subject: '学习 Agent',
    durationMin: 15,
    acceptance: ''
  });

  expect(task).not.toHaveProperty('goalId');
  expect((await service.getWorkspaceSnapshot('agent')).workspace).not.toHaveProperty(
    'goalId'
  );
});

/** Creates one template long plan (no model needed) in `workspaceId`. */
async function makePlan(context: Awaited<ReturnType<typeof makeContext>>, workspaceId: string) {
  const plan = await context.api.createLongPlan({
    workspaceId,
    goal: '学会 AI Agent',
    weeks: 1,
    weeklyHours: 10,
    startDate: '2026-11-15'
  });
  const day = plan.phases[0]!.weeks[0]!.days[0]!;
  return { plan, week: plan.phases[0]!.weeks[0]!, day };
}

test('a task derived from a long-plan item carries the plan project’s goalId', async () => {
  const context = await makeContext();
  const workspace = await context.api.createWorkspace({
    name: '学习 Agent',
    kind: 'study',
    goal: '转行做 Agent',
    description: ''
  });
  const { plan, week, day } = await makePlan(context, workspace.id);

  const task = await context.api.createTask({
    workspaceId: workspace.id,
    title: day.tasks[0]!,
    subject: workspace.name,
    durationMin: 30,
    acceptance: day.output,
    due: day.date,
    planId: plan.id,
    planWeekId: week.id,
    planItemId: day.id
  });

  expect(task.goalId).toBe(workspace.goalId);
  expect(task.goalId).toBeTruthy();

  // The link is persisted, not only returned in memory.
  const snapshot = await context.api.getWorkspaceSnapshot(workspace.id);
  expect(snapshot.tasks.find((entry) => entry.id === task.id)?.goalId).toBe(workspace.goalId);
});

test('an ordinary task with no plan gets no goal even when the project has one', async () => {
  const context = await makeContext();
  const workspace = await context.api.createWorkspace({
    name: '学习 Agent',
    kind: 'study',
    goal: '转行做 Agent',
    description: ''
  });
  expect(workspace.goalId).toBeTruthy();

  const task = await context.api.createTask({
    workspaceId: workspace.id,
    title: '随手记一件事',
    subject: workspace.name,
    durationMin: 15,
    acceptance: ''
  });
  expect(task).not.toHaveProperty('goalId');
});

test('re-adding the same plan item returns the existing task, not a second one', async () => {
  const context = await makeContext();
  const workspace = await context.api.createWorkspace({
    name: '学习 Agent',
    kind: 'study',
    goal: '转行做 Agent',
    description: ''
  });
  const { plan, week, day } = await makePlan(context, workspace.id);
  const input = {
    workspaceId: workspace.id,
    title: day.tasks[0]!,
    subject: workspace.name,
    durationMin: 30,
    acceptance: day.output,
    due: day.date,
    planId: plan.id,
    planWeekId: week.id,
    planItemId: day.id
  };

  const first = await context.api.createTask(input);
  const second = await context.api.createTask(input);

  expect(second.id).toBe(first.id);
  expect(second.goalId).toBe(first.goalId);
  const snapshot = await context.api.getWorkspaceSnapshot(workspace.id);
  expect(snapshot.tasks.filter((entry) => entry.planItemId === day.id)).toHaveLength(1);
});
