// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LongPlanPage } from '../../src/renderer/shell/LongPlanPage';
import type {
  CreateLongPlanInput,
  LongPlan,
  LongPlanDay,
  RecalibrateLongPlanInput,
  UpdateLongPlanItemInput
} from '../../src/shared/plans';
import type { Workspace } from '../../src/shared/workspace';

const workspace: Workspace = {
  id: 'agent',
  name: '学习 Agent',
  kind: 'study',
  color: '#34c759',
  goal: '转行做 Agent',
  description: ''
};

function day(
  id: string,
  date: string,
  weekday: string,
  done = false
): LongPlanDay {
  return {
    id,
    date,
    weekday,
    tasks: [`${weekday} 的任务`],
    output: `${weekday} 的产出`,
    done
  };
}

const plan: LongPlan = {
  id: 'lp-1',
  workspaceId: 'agent',
  goal: '学会 AI Agent',
  startDate: '2026-11-02',
  weeks: 2,
  weeklyHours: 10,
  generatedBy: 'agent',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  phases: [
    {
      id: 'ph1',
      title: '阶段一：建立基础',
      subtitle: 'LLM → Prompt → RAG',
      goal: '打牢基础',
      weeks: [
        {
          id: 'w1',
          number: 1,
          title: '第 1 周：LLM 基础',
          goal: '理解 Transformer',
          startDate: '2026-11-02',
          endDate: '2026-11-08',
          days: [
            day('w1d1', '2026-11-02', '周一'),
            day('w1d2', '2026-11-03', '周二')
          ],
          checks: [{ id: 'w1c1', text: '能画出 Transformer', done: false }]
        },
        {
          id: 'w2',
          number: 2,
          title: '第 2 周：Prompt',
          goal: '写结构化 Prompt',
          startDate: '2026-11-09',
          endDate: '2026-11-15',
          days: [day('w2d1', '2026-11-09', '周一', true)],
          checks: []
        }
      ]
    }
  ]
};

function renderPage(options: {
  plans?: LongPlan[];
  onCreatePlan?: (input: CreateLongPlanInput) => Promise<LongPlan>;
  onRecalibrate?: (input: RecalibrateLongPlanInput) => Promise<LongPlan>;
  onSetItemDone?: (input: UpdateLongPlanItemInput) => Promise<LongPlan>;
  onAddDayToSchedule?: (plan: LongPlan, day: LongPlanDay) => Promise<void>;
} = {}) {
  const onCreatePlan =
    options.onCreatePlan ??
    vi.fn(async (input: CreateLongPlanInput) => ({
      ...plan,
      id: 'lp-new',
      goal: input.goal
    }));
  const onSetItemDone =
    options.onSetItemDone ??
    vi.fn(async (input: UpdateLongPlanItemInput) => ({ ...plan, updatedAt: input.itemId }));
  render(
    <LongPlanPage
      plans={options.plans ?? [plan]}
      workspaces={[workspace]}
      defaultWorkspaceId="agent"
      today="2026-11-03"
      onOpenSidebar={vi.fn()}
      onCreatePlan={onCreatePlan}
      {...(options.onRecalibrate ? { onRecalibrate: options.onRecalibrate } : {})}
      onSetItemDone={onSetItemDone}
      onAddDayToSchedule={options.onAddDayToSchedule}
    />
  );
  return { onCreatePlan, onSetItemDone };
}

test('shows the plan overview and today’s week', () => {
  renderPage();

  const detail = screen.getByRole('region', { name: '计划详情' });
  expect(screen.getByText('长期计划')).toBeInTheDocument();
  expect(within(detail).getByText('学会 AI Agent')).toBeInTheDocument();
  expect(within(detail).getByText('阶段一：建立基础')).toBeInTheDocument();
  expect(within(detail).getByText('LLM → Prompt → RAG')).toBeInTheDocument();
  expect(within(detail).getByText('第 1 周：LLM 基础')).toBeInTheDocument();
  expect(within(detail).getByText('周一 的任务')).toBeInTheDocument();
  expect(within(detail).getByText('周二 的任务')).toBeInTheDocument();

  const progress = within(detail).getByRole('progressbar', { name: '计划进度' });
  expect(progress).toHaveAttribute('aria-valuenow', '1');
  expect(progress).toHaveAttribute('aria-valuemax', '4');
  expect(within(detail).getAllByText('25%').length).toBeGreaterThan(0);
  expect(within(detail).getByText('周一 的任务')).toBeInTheDocument();
});

test('expands another week and toggles a day', async () => {
  const { onSetItemDone } = renderPage();

  await userEvent.click(screen.getByRole('button', { name: '展开第 2 周' }));
  expect(screen.getAllByText('周一 的任务').length).toBe(2);

  await userEvent.click(screen.getByRole('checkbox', { name: '完成第 1 周 11/2 的任务' }));
  expect(onSetItemDone).toHaveBeenCalledWith({
    planId: 'lp-1',
    weekId: 'w1',
    itemId: 'w1d1',
    kind: 'day',
    done: true
  });
});

test('toggles a weekly acceptance check', async () => {
  const { onSetItemDone } = renderPage();

  await userEvent.click(screen.getByRole('checkbox', { name: '完成验收：能画出 Transformer' }));
  expect(onSetItemDone).toHaveBeenCalledWith({
    planId: 'lp-1',
    weekId: 'w1',
    itemId: 'w1c1',
    kind: 'check',
    done: true
  });
});

test('adds today’s plan row to the daily schedule', async () => {
  const onAddDayToSchedule = vi.fn(async () => undefined);
  renderPage({ onAddDayToSchedule });

  await userEvent.click(screen.getByRole('button', { name: '加入今日安排' }));

  expect(onAddDayToSchedule).toHaveBeenCalledWith(
    plan,
    expect.objectContaining({ id: 'w1d2', date: '2026-11-03' })
  );
  expect(await screen.findByText('已加入今日安排')).toBeInTheDocument();
});

test('creates a plan from the dialog', async () => {
  const { onCreatePlan } = renderPage();

  await userEvent.click(screen.getByRole('button', { name: '新建长期计划' }));
  await userEvent.clear(screen.getByLabelText('目标'));
  await userEvent.type(screen.getByLabelText('目标'), '系统学习 Agent');
  await userEvent.clear(screen.getByLabelText('总周数'));
  await userEvent.type(screen.getByLabelText('总周数'), '12');
  await userEvent.clear(screen.getByLabelText('每周投入（小时）'));
  await userEvent.type(screen.getByLabelText('每周投入（小时）'), '8');
  await userEvent.click(screen.getByRole('button', { name: '生成计划' }));

  await waitFor(() => expect(onCreatePlan).toHaveBeenCalled());
  expect(onCreatePlan).toHaveBeenCalledWith({
    workspaceId: 'agent',
    goal: '系统学习 Agent',
    startDate: '2026-11-03',
    weeks: 12,
    weeklyHours: 8
  });
});

test('sends references and the research flag from the dialog', async () => {
  const { onCreatePlan } = renderPage();

  await userEvent.click(screen.getByRole('button', { name: '新建长期计划' }));
  await userEvent.type(screen.getByLabelText('目标'), '系统学习 Agent');
  await userEvent.type(
    screen.getByLabelText('参考资料（可选）'),
    '课程大纲：API → 工具 → 评测'
  );
  await userEvent.click(screen.getByLabelText('先联网调研'));
  await userEvent.click(screen.getByRole('button', { name: '生成计划' }));

  await waitFor(() => expect(onCreatePlan).toHaveBeenCalled());
  expect(onCreatePlan).toHaveBeenCalledWith(
    expect.objectContaining({
      goal: '系统学习 Agent',
      references: '课程大纲：API → 工具 → 评测',
      research: true
    })
  );
});

test('shows the research sources and links them', () => {
  renderPage({
    plans: [
      {
        ...plan,
        sources: [{ title: '官方文档', url: 'https://docs.example.com/agents' }]
      }
    ]
  });

  expect(screen.getByText('依据：联网调研 · 1 个来源')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: '官方文档' });
  expect(link).toHaveAttribute('href', 'https://docs.example.com/agents');
});

test('shows user references as the plan basis', () => {
  renderPage({ plans: [{ ...plan, references: '课程大纲：API → 工具 → 评测' }] });
  expect(screen.getByText('依据：你提供的参考资料')).toBeInTheDocument();
  expect(screen.getByText(/课程大纲：API → 工具 → 评测/)).toBeInTheDocument();
});

test('marks model-only plans as unverified', () => {
  renderPage({ plans: [plan] });
  expect(screen.getByText('依据：模型知识（未联网核实）')).toBeInTheDocument();
});

test('shows knowledge used by the plan', () => {
  renderPage({
    plans: [
      {
        ...plan,
        knowledge: [
          { name: 'LangChain', status: 'mastered' },
          { name: 'LangGraph', status: 'learning' }
        ]
      }
    ]
  });
  expect(
    screen.getByText(/已参考知识库：LangChain（已掌握）、LangGraph（在学）/)
  ).toBeInTheDocument();
});

test('shows an empty state and explains the generic framework', async () => {
  renderPage({ plans: [] });
  expect(screen.getByText('还没有长期计划。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '新建长期计划' })).toBeInTheDocument();
});

test('marks template-generated plans so users know to refine them', () => {
  renderPage({ plans: [{ ...plan, generatedBy: 'template' }] });
  expect(screen.getByText(/通用框架/)).toBeInTheDocument();
});

test('recalibrates the remaining weeks with the current hours and notes', async () => {
  const onRecalibrate = vi.fn(async (input: RecalibrateLongPlanInput) => ({
    ...plan,
    weeklyHours: input.weeklyHours ?? plan.weeklyHours,
    recalibratedFrom: 2
  }));
  renderPage({ onRecalibrate });

  await userEvent.click(screen.getByRole('button', { name: '重排剩余安排' }));
  expect(screen.getByText(/会保留已经勾选进度的周/)).toBeInTheDocument();

  const hours = screen.getByLabelText('接下来的每周投入（小时）');
  await userEvent.clear(hours);
  await userEvent.type(hours, '8');
  await userEvent.type(screen.getByLabelText('最近的变化（可选）'), '这周加班');
  await userEvent.click(screen.getByRole('button', { name: '开始重排' }));

  await waitFor(() =>
    expect(onRecalibrate).toHaveBeenCalledWith({
      planId: 'lp-1',
      weeklyHours: 8,
      notes: '这周加班'
    })
  );
  expect(await screen.findByText('已重排剩余安排。')).toBeInTheDocument();
});

test('shows recalibration progress and keeps the dialog open on failure', async () => {
  let reject!: (cause: Error) => void;
  const onRecalibrate = vi.fn(
    () =>
      new Promise<LongPlan>((_resolve, rejectPromise) => {
        reject = rejectPromise;
      })
  );
  renderPage({ onRecalibrate });

  await userEvent.click(screen.getByRole('button', { name: '重排剩余安排' }));
  await userEvent.click(screen.getByRole('button', { name: '开始重排' }));

  expect(await screen.findByText(/正在根据你的进度重排/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /重排中…/ })).toBeDisabled();

  await act(async () => {
    reject(new Error('重排剩余计划需要先配置模型。'));
  });

  expect(await screen.findByRole('alert')).toHaveTextContent(
    '重排剩余计划需要先配置模型。'
  );
  expect(screen.getByRole('button', { name: '开始重排' })).toBeInTheDocument();
});

test('switches between multiple plans', async () => {
  const other: LongPlan = { ...plan, id: 'lp-2', goal: '学会 RAG', updatedAt: '2026-11-02T00:00:00.000Z' };
  renderPage({ plans: [other, plan] });

  expect(
    within(screen.getByRole('region', { name: '计划详情' })).getByText('学会 RAG')
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '查看计划：学会 AI Agent' }));
  expect(
    within(screen.getByRole('region', { name: '计划详情' })).getByText('学会 AI Agent')
  ).toBeInTheDocument();
});
