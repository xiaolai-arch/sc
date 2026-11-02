import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { createKnowledgeService } from '../../src/main/knowledge/create-knowledge-service';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import { createLongPlanService } from '../../src/main/plans/long-plan-service';
import type { KnowledgeService } from '../../src/shared/knowledge';
import { planWeekday, type LongPlan } from '../../src/shared/plans';

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
    const langChain = await knowledge!.create({
      name: 'LangChain',
      workspaceId,
      status: 'mastered',
      level: 4,
      summary: '会搭 AgentExecutor 和自定义 tool'
    });
    await knowledge!.create({
      name: 'LangGraph',
      workspaceId,
      status: 'learning',
      level: 2,
      summary: '只看过文档，还没动手'
    });
    await knowledge!.saveNote({
      topicId: langChain.id,
      body: 'RAG 还没做过；LangGraph 只看过文档。'
    });

    const plan = await service.create({ workspaceId, goal: '系统学习 AI Agent', weeks: 1 });

    const prompt = client.calls[0]?.messages[1]?.content ?? '';
    expect(prompt).toContain('已掌握：LangChain');
    expect(prompt).toContain('正在学：LangGraph');
    expect(prompt).toContain('不要从头安排');
    expect(prompt).toContain('L4');
    expect(prompt).toContain('会搭 AgentExecutor 和自定义 tool');
    expect(prompt).toContain('RAG 还没做过');
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
    expect(file).not.toContain('会搭 AgentExecutor');
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

function planWeeks(plan: LongPlan): number[] {
  return plan.phases.flatMap((phase) => phase.weeks).map((week) => week.number);
}

test('recalibrates the untouched remaining weeks from actual progress', async () => {
  const client = new FakeModelClient([modelReply(4), modelReply(3)]);
  const { dir, workspaceId, service, setNow } = await setup(client);
  try {
    const plan = await service.create({
      workspaceId,
      goal: '学会 AI Agent',
      startDate: '2026-11-02',
      weeks: 4,
      weeklyHours: 12
    });
    const weeks = plan.phases.flatMap((phase) => phase.weeks);
    await service.setItemDone({
      planId: plan.id,
      weekId: weeks[0]!.id,
      itemId: weeks[0]!.days[0]!.id,
      kind: 'day',
      done: true
    });
    setNow(new Date('2026-11-11T09:00:00.000Z'));

    const updated = await service.recalibrate({
      planId: plan.id,
      weeklyHours: 6,
      notes: '这周加班，只学了两个晚上'
    });

    const resultWeeks = updated.phases.flatMap((phase) => phase.weeks);
    expect(resultWeeks.map((week) => week.number)).toEqual([1, 2, 3, 4]);
    expect(resultWeeks[0]!.days[0]!.done).toBe(true);
    expect(resultWeeks[1]!.title).toBe('第 2 周：基础 1');
    expect(resultWeeks[1]!.id).toBe('w2');
    expect(resultWeeks[1]!.startDate).toBe('2026-11-09');
    expect(resultWeeks[1]!.days[0]!.id).toBe('w2d1');
    expect(resultWeeks[2]!.startDate).toBe('2026-11-16');
    expect(resultWeeks[3]!.endDate).toBe('2026-11-29');
    expect(resultWeeks.every((week) => week.days.length === 7)).toBe(true);
    expect(updated.generatedBy).toBe('agent');
    expect(updated.weeklyHours).toBe(6);
    expect(updated.recalibratedFrom).toBe(2);
    expect(updated.recalibratedAt).toBeTruthy();

    const prompt = client.calls[1]?.messages[1]?.content ?? '';
    expect(prompt).toContain('重排范围：从第 2 周开始，共 3 周（计划共 4 周）');
    expect(prompt).toContain('整体完成 1/');
    expect(prompt).toContain('这周加班');
    expect(prompt).toContain('每周投入：约 6 小时');
    expect(prompt).toContain('原计划剩余安排');

    const file = await readFile(
      join(dir, 'workspaces', workspaceId, 'plans', `${plan.id}.md`),
      'utf8'
    );
    expect(file).toContain('recalibratedFrom: 2');
    expect((await service.get(plan.id))?.recalibratedFrom).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('does not rewrite a week that already has completed work', async () => {
  const client = new FakeModelClient([modelReply(3), modelReply(2)]);
  const { dir, workspaceId, service, setNow } = await setup(client);
  try {
    const plan = await service.create({
      workspaceId,
      goal: '学会 AI Agent',
      startDate: '2026-11-02',
      weeks: 3
    });
    const weeks = plan.phases.flatMap((phase) => phase.weeks);
    await service.setItemDone({
      planId: plan.id,
      weekId: weeks[0]!.id,
      itemId: weeks[0]!.checks[0]!.id,
      kind: 'check',
      done: true
    });
    setNow(new Date('2026-11-04T09:00:00.000Z'));

    const updated = await service.recalibrate({ planId: plan.id });
    const resultWeeks = updated.phases.flatMap((phase) => phase.weeks);

    expect(planWeeks(updated)).toEqual([1, 2, 3]);
    expect(resultWeeks[0]!.id).toBe('w1');
    expect(resultWeeks[0]!.checks[0]!.done).toBe(true);
    expect(resultWeeks[0]!.title).toBe('第 1 周：基础 1');
    expect(resultWeeks[1]!.startDate).toBe('2026-11-09');
    expect(updated.recalibratedFrom).toBe(2);
    // The preserved phase and the regenerated phase remain separate sections.
    expect(updated.phases).toHaveLength(2);
    expect(updated.phases[0]!.weeks.map((week) => week.number)).toEqual([1]);
    expect(updated.phases[1]!.weeks.map((week) => week.number)).toEqual([2, 3]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('recalibration requires a model and leaves the plan untouched without one', async () => {
  const { dir, workspaceId, service } = await setup(null);
  try {
    const plan = await service.create({
      workspaceId,
      goal: '学会 AI Agent',
      startDate: '2026-11-02',
      weeks: 2
    });

    await expect(service.recalibrate({ planId: plan.id })).rejects.toThrow(/模型/);
    expect(await service.get(plan.id)).toEqual(plan);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('does not overwrite the plan when the model cannot produce a replan', async () => {
  const client = new FakeModelClient([modelReply(2), '我看过了，建议先学 Python。']);
  const { dir, workspaceId, service } = await setup(client);
  try {
    const plan = await service.create({
      workspaceId,
      goal: '学会 AI Agent',
      startDate: '2026-11-02',
      weeks: 2
    });

    await expect(service.recalibrate({ planId: plan.id })).rejects.toThrow(/重排结果/);
    expect(await service.get(plan.id)).toEqual(plan);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refuses to recalibrate when every remaining week already has progress', async () => {
  const { dir, workspaceId, service, setNow } = await setup(
    new FakeModelClient([modelReply(1)])
  );
  try {
    const plan = await service.create({
      workspaceId,
      goal: '学会 AI Agent',
      startDate: '2026-11-02',
      weeks: 1
    });
    const week = plan.phases[0]!.weeks[0]!;
    await service.setItemDone({
      planId: plan.id,
      weekId: week.id,
      itemId: week.days[0]!.id,
      kind: 'day',
      done: true
    });
    setNow(new Date('2026-11-04T09:00:00.000Z'));

    await expect(service.recalibrate({ planId: plan.id })).rejects.toThrow(/没有可重排/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('recalibration re-reads the knowledge base before generating', async () => {
  const client = new FakeModelClient([modelReply(2), modelReply(1)]);
  let knowledge: KnowledgeService | null = null;
  const { dir, workspaceId, service, setNow } = await setup(client, {
    knowledgeService: (root) => {
      knowledge = createKnowledgeService({ root, now: () => NOW });
      return knowledge;
    }
  });
  try {
    const langChain = await knowledge!.create({
      name: 'LangChain',
      workspaceId,
      status: 'learning',
      level: 2
    });
    const plan = await service.create({
      workspaceId,
      goal: '系统学习 AI Agent',
      startDate: '2026-11-02',
      weeks: 2
    });

    await knowledge!.update({ id: langChain.id, status: 'mastered', level: 4 });
    await knowledge!.saveNote({
      topicId: langChain.id,
      body: 'AgentExecutor 已经跑通，RAG 还没做。'
    });
    setNow(new Date('2026-11-09T09:00:00.000Z'));

    const updated = await service.recalibrate({ planId: plan.id });
    const prompt = client.calls[1]?.messages[1]?.content ?? '';

    expect(prompt).toContain('已掌握：LangChain');
    expect(prompt).toContain('AgentExecutor 已经跑通');
    expect(updated.knowledge).toEqual([{ name: 'LangChain', status: 'mastered' }]);
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
