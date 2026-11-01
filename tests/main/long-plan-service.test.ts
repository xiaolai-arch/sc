import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { createKnowledgeService } from '../../src/main/knowledge/create-knowledge-service';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import { createLongPlanService } from '../../src/main/plans/long-plan-service';
import type { KnowledgeService } from '../../src/shared/knowledge';
import { planWeekday } from '../../src/shared/plans';

const NOW = new Date('2026-11-01T09:00:00.000Z');

function weekDays(output: string, count = 7) {
  return Array.from({ length: count }, (_value, index) => ({
    tasks: [`${output} 任务 ${index + 1}`],
    output: `${output} 产出 ${index + 1}`
  }));
}

function modelReply(weeks = 1) {
  return JSON.stringify({
    title: '学会 AI Agent',
    phases: [
      {
        title: '阶段一：基础',
        subtitle: 'LLM → Prompt → RAG',
        goal: '打牢基础',
        weeks: Array.from({ length: weeks }, (_value, index) => ({
          title: `第 ${index + 1} 周：基础 ${index + 1}`,
          goal: `完成基础 ${index + 1}`,
          days: weekDays(`第${index + 1}周`),
          checks: [`能讲清基础 ${index + 1}`, '完成一个可运行 demo']
        }))
      }
    ]
  });
}

async function setup(
  modelClient: FakeModelClient | null = null,
  options: { knowledgeService?: KnowledgeService | ((root: string) => KnowledgeService) } = {}
) {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-long-plan-'));
  const workspaceService = createWorkspaceService(dir, { seed: false });
  await workspaceService.createWorkspace({
    name: '学习 Agent',
    kind: 'study',
    goal: '找到 Agent 方向的工作',
    description: ''
  });
  const workspaces = await workspaceService.listWorkspaces();
  const workspaceId = workspaces[0]!.id;
  let current = NOW;
  const knowledgeService =
    typeof options.knowledgeService === 'function'
      ? options.knowledgeService(dir)
      : options.knowledgeService;
  const service = createLongPlanService({
    root: dir,
    workspaceService,
    modelClient,
    ...(knowledgeService ? { knowledgeService } : {}),
    now: () => current
  });
  return {
    dir,
    workspaceId,
    service,
    workspaceService,
    setNow: (value: Date) => {
      current = value;
    }
  };
}

test('generates a dated phase/week/day plan from the model and persists it', async () => {
  const { dir, workspaceId, service } = await setup(
    new FakeModelClient([modelReply(2)])
  );
  try {
    const plan = await service.create({
      workspaceId,
      goal: '学会 AI Agent，能独立做项目',
      startDate: '2026-11-02',
      weeks: 2,
      weeklyHours: 12
    });

    expect(plan.generatedBy).toBe('agent');
    expect(plan.workspaceId).toBe(workspaceId);
    expect(plan.weeks).toBe(2);
    expect(plan.phases).toHaveLength(1);
    const weeks = plan.phases[0]!.weeks;
    expect(weeks.map((week) => week.number)).toEqual([1, 2]);
    expect(weeks[0]).toMatchObject({
      title: '第 1 周：基础 1',
      startDate: '2026-11-02',
      endDate: '2026-11-08'
    });
    expect(weeks[1]!.startDate).toBe('2026-11-09');
    expect(weeks[0]!.days).toHaveLength(7);
    expect(weeks[0]!.days[0]!.date).toBe('2026-11-02');
    expect(weeks[0]!.days[0]!.weekday).toBe(planWeekday('2026-11-02'));
    expect(weeks[0]!.days[6]!.date).toBe('2026-11-08');
    expect(weeks[0]!.checks.slice(0, 2).map((check) => check.text)).toEqual([
      '能讲清基础 1',
      '完成一个可运行 demo'
    ]);
    expect(weeks[0]!.checks).toHaveLength(3);
    expect(weeks[0]!.days.every((day) => !day.done)).toBe(true);

    const listed = await service.list(workspaceId);
    expect(listed).toHaveLength(1);
    expect((await service.get(plan.id))?.goal).toBe('学会 AI Agent，能独立做项目');

    const file = await readFile(
      join(dir, 'workspaces', workspaceId, 'plans', `${plan.id}.md`),
      'utf8'
    );
    expect(file).toContain('kind: long-plan');
    expect(file).toContain('第 1 周：基础 1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pads missing weeks and days so the duration is always honored', async () => {
  const { dir, workspaceId, service } = await setup(
    new FakeModelClient([modelReply(1)])
  );
  try {
    const plan = await service.create({
      workspaceId,
      goal: '系统学习 Agent',
      startDate: '2026-11-02',
      weeks: 3
    });

    const weeks = plan.phases.flatMap((phase) => phase.weeks);
    expect(weeks).toHaveLength(3);
    expect(weeks.every((week) => week.days.length === 7)).toBe(true);
    expect(weeks[2]!.title).toContain('第 3 周');
    expect(weeks[2]!.days[0]!.date).toBe('2026-11-16');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('falls back to a deterministic framework when no model is available', async () => {
  const { dir, workspaceId, service } = await setup(null);
  try {
    const plan = await service.create({
      workspaceId,
      goal: '学会 AI Agent',
      startDate: '2026-11-02',
      weeks: 6,
      weeklyHours: 8
    });

    expect(plan.generatedBy).toBe('template');
    expect(plan.weeks).toBe(6);
    const weeks = plan.phases.flatMap((phase) => phase.weeks);
    expect(weeks).toHaveLength(6);
    expect(plan.phases.length).toBeGreaterThanOrEqual(2);
    expect(weeks.every((week) => week.days.length === 7)).toBe(true);
    expect(weeks.every((week) => week.checks.length >= 3)).toBe(true);
    expect(weeks.some((week) => week.goal.includes('学会 AI Agent'))).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('falls back to the template when the model reply is unusable', async () => {
  const { dir, workspaceId, service } = await setup(
    new FakeModelClient(['我看了一下你的目标，建议先学 Python。'])
  );
  try {
    const plan = await service.create({
      workspaceId,
      goal: '学会 AI Agent',
      weeks: 2
    });
    expect(plan.generatedBy).toBe('template');
    expect(plan.startDate).toBe('2026-11-01');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('marks a day or an acceptance check done and persists the change', async () => {
  const { dir, workspaceId, service, setNow } = await setup(null);
  try {
    const plan = await service.create({ workspaceId, goal: '学会 Agent', weeks: 1 });
    const week = plan.phases[0]!.weeks[0]!;
    setNow(new Date(NOW.getTime() + 60_000));

    const afterDay = await service.setItemDone({
      planId: plan.id,
      weekId: week.id,
      itemId: week.days[0]!.id,
      kind: 'day',
      done: true
    });
    expect(afterDay.phases[0]!.weeks[0]!.days[0]!.done).toBe(true);
    expect(afterDay.updatedAt).not.toBe(plan.updatedAt);

    const afterCheck = await service.setItemDone({
      planId: plan.id,
      weekId: week.id,
      itemId: week.checks[0]!.id,
      kind: 'check',
      done: true
    });
    expect(afterCheck.phases[0]!.weeks[0]!.checks[0]!.done).toBe(true);

    const reloaded = await service.get(plan.id);
    expect(reloaded?.phases[0]!.weeks[0]!.days[0]!.done).toBe(true);
    expect(reloaded?.phases[0]!.weeks[0]!.checks[0]!.done).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects invalid goals, durations, dates and unknown workspaces', async () => {
  const { dir, workspaceId, service } = await setup(null);
  try {
    await expect(
      service.create({ workspaceId, goal: '  ', weeks: 4 })
    ).rejects.toThrow(/目标/);
    await expect(
      service.create({ workspaceId, goal: '学会 Agent', weeks: 0 })
    ).rejects.toThrow(/周数/);
    await expect(
      service.create({ workspaceId, goal: '学会 Agent', weeks: 17 })
    ).rejects.toThrow(/周数/);
    await expect(
      service.create({ workspaceId, goal: '学会 Agent', weeks: 4, weeklyHours: 0 })
    ).rejects.toThrow(/每周/);
    await expect(
      service.create({ workspaceId, goal: '学会 Agent', weeks: 4, startDate: '2026-13-01' })
    ).rejects.toThrow(/起始日期/);
    await expect(
      service.create({ workspaceId: 'missing', goal: '学会 Agent', weeks: 4 })
    ).rejects.toThrow(/工作区/);
    await expect(
      service.create({
        workspaceId,
        goal: '学会 Agent',
        weeks: 4,
        references: 42 as unknown as string
      })
    ).rejects.toThrow(/参考资料/);
    await expect(
      service.create({
        workspaceId,
        goal: '学会 Agent',
        weeks: 4,
        research: 'yes' as unknown as boolean
      })
    ).rejects.toThrow(/联网调研/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('grounds plan generation in mastered topics and records the snapshot', async () => {
  const client = new FakeModelClient([modelReply(1)]);
  let knowledge: KnowledgeService | null = null;
  const { dir, workspaceId, service } = await setup(client, {
    knowledgeService: (root) => {
      knowledge = createKnowledgeService({ root, now: () => NOW });
      return knowledge;
    }
  });
  try {
    await knowledge!.create({ name: 'LangChain', workspaceId, status: 'mastered' });
    await knowledge!.create({ name: 'LangGraph', workspaceId, status: 'learning' });

    const plan = await service.create({ workspaceId, goal: '系统学习 AI Agent', weeks: 1 });

    const prompt = client.calls[0]?.messages[1]?.content ?? '';
    expect(prompt).toContain('已掌握：LangChain');
    expect(prompt).toContain('正在学：LangGraph');
    expect(prompt).toContain('不要从头安排');
    expect(plan.knowledge).toEqual([
      { name: 'LangChain', status: 'mastered' },
      { name: 'LangGraph', status: 'learning' }
    ]);

    const file = await readFile(
      join(dir, 'workspaces', workspaceId, 'plans', `${plan.id}.md`),
      'utf8'
    );
    expect(file).toContain('knowledge:');
    expect(file).toContain('name: LangChain');
    expect((await service.get(plan.id))?.knowledge).toEqual(plan.knowledge);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a broken knowledge file does not break or empty plan generation', async () => {
  const client = new FakeModelClient([modelReply(1)]);
  const { dir, workspaceId, service } = await setup(client, {
    knowledgeService: (root) => createKnowledgeService({ root, now: () => NOW })
  });
  try {
    const topicsDir = join(dir, 'knowledge', 'topics');
    await mkdir(topicsDir, { recursive: true });
    await writeFile(join(topicsDir, 'kt-broken.md'), 'not: [valid', 'utf8');

    const plan = await service.create({ workspaceId, goal: '系统学习 AI Agent', weeks: 1 });

    expect(plan.generatedBy).toBe('agent');
    expect(plan.knowledge).toBeUndefined();
    expect(await readFile(join(topicsDir, 'kt-broken.md'), 'utf8')).toBe('not: [valid');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('does not claim knowledge grounding when the template falls back', async () => {
  let knowledge: KnowledgeService | null = null;
  const { dir, workspaceId, service } = await setup(null, {
    knowledgeService: (root) => {
      knowledge = createKnowledgeService({ root, now: () => NOW });
      return knowledge;
    }
  });
  try {
    await knowledge!.create({ name: 'LangChain', workspaceId, status: 'mastered' });
    const plan = await service.create({ workspaceId, goal: '系统学习 AI Agent', weeks: 1 });
    expect(plan.generatedBy).toBe('template');
    expect(plan.knowledge).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('feeds user references into the prompt and keeps them on the plan', async () => {
  const client = new FakeModelClient([modelReply(1)]);
  const { dir, workspaceId, service } = await setup(client);
  try {
    const plan = await service.create({
      workspaceId,
      goal: '学会 AI Agent',
      weeks: 1,
      references: '大纲：1. API 调用 2. 工具调用 3. 评测'
    });

    expect(plan.references).toContain('工具调用');
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.messages[1]?.content).toContain('参考资料');
    expect(client.calls[0]?.messages[1]?.content).toContain('工具调用');

    const file = await readFile(
      join(dir, 'workspaces', workspaceId, 'plans', `${plan.id}.md`),
      'utf8'
    );
    expect(file).toContain('工具调用');
    expect((await service.get(plan.id))?.references).toContain('大纲');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('researches the web first and records its sources on the plan', async () => {
  const research = JSON.stringify({
    sources: [{ title: '官方文档', url: 'https://docs.example.com/agents' }],
    facts: ['先建评测集再优化']
  });
  const client = new FakeModelClient([research, modelReply(1)]);
  const { dir, workspaceId, service } = await setup(client);
  try {
    const plan = await service.create({
      workspaceId,
      goal: '学会 AI Agent',
      weeks: 1,
      research: true
    });

    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.webTools).toBe(true);
    expect(client.calls[1]?.webTools).not.toBe(true);
    expect(client.calls[1]?.messages[1]?.content).toContain('先建评测集再优化');
    expect(plan.generatedBy).toBe('agent');
    expect(plan.sources).toEqual([
      { title: '官方文档', url: 'https://docs.example.com/agents' }
    ]);

    const file = await readFile(
      join(dir, 'workspaces', workspaceId, 'plans', `${plan.id}.md`),
      'utf8'
    );
    expect(file).toContain('https://docs.example.com/agents');
    expect((await service.get(plan.id))?.sources).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('completes the plan without sources when research finds nothing', async () => {
  const client = new FakeModelClient(['无法联网', modelReply(1)]);
  const { dir, workspaceId, service } = await setup(client);
  try {
    const plan = await service.create({
      workspaceId,
      goal: '学会 AI Agent',
      weeks: 1,
      research: true
    });
    expect(plan.generatedBy).toBe('agent');
    expect(plan.sources).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deletes a plan file and hides it from the list', async () => {
  const { dir, workspaceId, service } = await setup(null);
  try {
    const plan = await service.create({ workspaceId, goal: '学会 Agent', weeks: 1 });
    await service.delete(plan.id);

    expect(await service.get(plan.id)).toBeNull();
    expect(await service.list()).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('does not let a plan id escape the vault', async () => {
  const { dir, service } = await setup(null);
  try {
    await expect(service.get('../../etc/passwd')).resolves.toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
