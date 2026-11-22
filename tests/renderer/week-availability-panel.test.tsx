// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LongPlanPage } from '../../src/renderer/shell/LongPlanPage';
import type { CreateLongPlanInput, LongPlan } from '../../src/shared/plans';
import type { WeekAvailabilitySummary } from '../../src/shared/ipc';
import type { Workspace } from '../../src/shared/workspace';

const workspace: Workspace = {
  id: 'agent',
  name: '学习 Agent',
  kind: 'study',
  color: '#34c759',
  goal: '转行做 Agent',
  description: ''
};

function day(id: string, date: string, weekday: string): LongPlan['phases'][0]['weeks'][0]['days'][0] {
  return {
    id,
    date,
    weekday,
    tasks: [`${weekday} 的任务`],
    output: `${weekday} 的产出`,
    done: false
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
          days: [day('w1d1', '2026-11-02', '周一'), day('w1d2', '2026-11-03', '周二')],
          checks: [{ id: 'w1c1', text: '能画出 Transformer', done: false }]
        }
      ]
    }
  ]
};

// 2026-11-03 is the Tuesday of the week starting Monday 2026-11-02.
const TODAY = '2026-11-03';

const currentWeek: WeekAvailabilitySummary = {
  weekStart: '2026-11-02',
  busyDates: ['2026-11-03', '2026-11-05']
};

function renderPage(
  weekAvailability: WeekAvailabilitySummary[],
  onClearWeekAvailability?: (weekStart: string) => Promise<void>
) {
  const onClear =
    onClearWeekAvailability ?? vi.fn(async (_weekStart: string) => undefined);
  const view = render(
    <LongPlanPage
      plans={[plan]}
      workspaces={[workspace]}
      defaultWorkspaceId="agent"
      today={TODAY}
      weekAvailability={weekAvailability}
      onOpenSidebar={vi.fn()}
      onCreatePlan={vi.fn(async (input: CreateLongPlanInput) => ({ ...plan, goal: input.goal }))}
      onSetItemDone={vi.fn(async () => plan)}
      onClearWeekAvailability={onClear}
    />
  );
  return { view, onClear };
}

function rerenderWithoutRecord(
  view: ReturnType<typeof render>,
  onClear: (weekStart: string) => Promise<void>
) {
  view.rerender(
    <LongPlanPage
      plans={[plan]}
      workspaces={[workspace]}
      defaultWorkspaceId="agent"
      today={TODAY}
      weekAvailability={[]}
      onOpenSidebar={vi.fn()}
      onCreatePlan={vi.fn(async (input: CreateLongPlanInput) => ({ ...plan, goal: input.goal }))}
      onSetItemDone={vi.fn(async () => plan)}
      onClearWeekAvailability={onClear}
    />
  );
}

test('shows the current week sentence with weekday words and a clear button', () => {
  renderPage([currentWeek]);

  const panel = document.querySelector('[data-week-availability="true"]');
  expect(panel).not.toBeNull();
  expect(panel!.textContent).toContain('你说过这周特别满：周二、周四（来自周复盘）');
  expect(
    screen.getByRole('button', { name: '清除一周安排：2026-11-02' })
  ).toBeInTheDocument();
});

test('a future week and a past week never render the panel', () => {
  renderPage([
    { weekStart: '2026-11-09', busyDates: ['2026-11-10'] },
    { weekStart: '2026-10-26', busyDates: ['2026-10-27'] }
  ]);

  expect(screen.queryByText(/你说过这周特别满/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /清除一周安排/ })).not.toBeInTheDocument();
});

test('no record at all means the whole block is absent', () => {
  renderPage([]);

  expect(screen.queryByText(/你说过这周特别满/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /清除一周安排/ })).not.toBeInTheDocument();
});

test('clearing removes the block and states the plain fact once', async () => {
  const onClear = vi.fn(async (_weekStart: string) => undefined);
  const { view } = renderPage([currentWeek], onClear);

  await userEvent.click(screen.getByRole('button', { name: '清除一周安排：2026-11-02' }));
  expect(onClear).toHaveBeenCalledWith('2026-11-02');

  // The page drops the record; the block disappears with it.
  rerenderWithoutRecord(view, onClear);

  expect(screen.queryByText(/你说过这周特别满/)).not.toBeInTheDocument();
  expect(screen.getByText('已清除。之后排计划会恢复按项目设置的可用时间。')).toBeInTheDocument();
});
