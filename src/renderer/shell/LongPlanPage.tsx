import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { friendlyErrorMessage } from '../../shared/errors';
import type {
  CreateLongPlanInput,
  LongPlan,
  LongPlanDay,
  LongPlanPhase,
  LongPlanWeek,
  UpdateLongPlanItemInput
} from '../../shared/plans';
import {
  currentPlanWeek,
  phaseProgress,
  planBasis,
  planMonthDay,
  planProgress,
  weekProgress
} from '../../shared/plans';
import type { KnowledgeStatus } from '../../shared/knowledge';
import type { Workspace } from '../../shared/workspace';
import { Dialog } from '../ui/Dialog';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from '../ui/icons';
import { PageFrame } from './PageFrame';

const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  planned: '计划中',
  learning: '在学',
  mastered: '已掌握',
  paused: '暂停'
};

type LongPlanPageProps = {
  plans: LongPlan[];
  workspaces: Workspace[];
  defaultWorkspaceId?: string | null;
  today: string;
  onOpenSidebar: () => void;
  onCreatePlan: (input: CreateLongPlanInput) => Promise<LongPlan>;
  onSetItemDone: (input: UpdateLongPlanItemInput) => Promise<LongPlan>;
  onDeletePlan?: (planId: string) => Promise<void>;
  onAddDayToSchedule?: (plan: LongPlan, day: LongPlanDay) => Promise<void>;
};

type PlanForm = {
  workspaceId: string;
  goal: string;
  startDate: string;
  weeks: string;
  weeklyHours: string;
  notes: string;
  references: string;
  research: boolean;
};

function messageOf(cause: unknown): string {
  return friendlyErrorMessage(cause);
}

function errorText(cause: unknown): string {
  return messageOf(cause);
}

function dateRangeLabel(week: LongPlanWeek): string {
  return `${planMonthDay(week.startDate)} — ${planMonthDay(week.endDate)}`;
}

function planRangeLabel(plan: LongPlan): string {
  const weeks = plan.phases.flatMap((phase) => phase.weeks);
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  if (!first || !last) return `${plan.weeks} 周`;
  return `${plan.weeks} 周 · ${planMonthDay(first.startDate)} — ${planMonthDay(last.endDate)}`;
}

const primaryButton =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[#0071e3] px-4 py-2 text-[13px] font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none motion-reduce:active:scale-100';
const secondaryButton =
  'inline-flex min-h-9 items-center justify-center rounded-full px-3 py-1.5 text-[12px] font-medium text-[#0071e3] transition-all duration-300 hover:bg-[#0071e3]/10 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 disabled:pointer-events-none disabled:opacity-40 dark:text-[#4da3ff] dark:hover:bg-[#0a84ff]/20 motion-reduce:transition-none motion-reduce:active:scale-100';

function Checkbox({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 ${
        checked
          ? 'border-[#0071e3] bg-[#0071e3] text-white'
          : 'border-gray-300 bg-white text-transparent hover:border-[#0071e3]/60 dark:border-white/20 dark:bg-transparent'
      }`}
    >
      <span aria-hidden="true" className="text-[12px] leading-none">
        ✓
      </span>
    </button>
  );
}

function DayRow({
  week,
  day,
  today,
  notice,
  onToggle,
  onAddToSchedule
}: {
  week: LongPlanWeek;
  day: LongPlanDay;
  today: string;
  notice: string | null;
  onToggle: () => void;
  onAddToSchedule?: () => void;
}) {
  const isToday = day.date === today;
  return (
    <div
      data-week={week.id}
      className={`grid gap-3 rounded-2xl px-3 py-3 md:grid-cols-[88px_minmax(0,1fr)_minmax(0,0.8fr)_auto] md:items-start ${
        isToday ? 'bg-[#0071e3]/[0.06] dark:bg-[#0a84ff]/10' : ''
      }`}
    >
      <div className="flex items-center gap-2 md:block">
        <p className="text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
          {day.weekday}
        </p>
        <p className="text-[12px] tabular-nums text-gray-400 dark:text-[#8e8e93]">
          {planMonthDay(day.date)}
          {isToday ? <span className="ml-1 text-[#0071e3] dark:text-[#4da3ff]">今天</span> : null}
        </p>
      </div>
      <ul
        className={`space-y-1 text-[13px] leading-6 ${
          day.done
            ? 'text-gray-400 line-through dark:text-[#8e8e93]'
            : 'text-[#1d1d1f] dark:text-[#f5f5f7]'
        }`}
      >
        {day.tasks.map((task, index) => (
          <li key={`${day.id}-${index}`} className="flex gap-2">
            <span aria-hidden="true" className="text-gray-400 dark:text-[#8e8e93]">
              •
            </span>
            <span>{task}</span>
          </li>
        ))}
      </ul>
      <div className="text-[12px] leading-5 text-gray-500 dark:text-[#a1a1a6]">
        <span className="text-gray-400 dark:text-[#8e8e93]">产出：</span>
        {day.output || '—'}
        {onAddToSchedule ? (
          <button type="button" onClick={onAddToSchedule} className={`mt-2 block ${secondaryButton}`}>
            加入今日安排
          </button>
        ) : null}
        {notice ? (
          <span role="status" className="mt-1 block text-[11px] text-[#34c759]">
            {notice}
          </span>
        ) : null}
      </div>
      <div className="flex md:justify-end">
        <Checkbox
          checked={day.done}
          label={`完成第 ${week.number} 周 ${planMonthDay(day.date)} 的任务`}
          onChange={onToggle}
        />
      </div>
    </div>
  );
}

function WeekSection({
  plan,
  week,
  today,
  expanded,
  onToggleExpanded,
  onSetItemDone,
  onAddDayToSchedule
}: {
  plan: LongPlan;
  week: LongPlanWeek;
  today: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onSetItemDone: (input: UpdateLongPlanItemInput) => Promise<LongPlan>;
  onAddDayToSchedule?: (plan: LongPlan, day: LongPlanDay) => Promise<void>;
}) {
  const progress = weekProgress(week);
  const [notice, setNotice] = useState<{ dayId: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(kind: 'day' | 'check', itemId: string, done: boolean) {
    setError(null);
    try {
      await onSetItemDone({
        planId: plan.id,
        weekId: week.id,
        itemId,
        kind,
        done
      });
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function addDay(day: LongPlanDay) {
    if (!onAddDayToSchedule) return;
    setError(null);
    try {
      await onAddDayToSchedule(plan, day);
      setNotice({ dayId: day.id, text: '已加入今日安排' });
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-gray-200/70 dark:border-white/10">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? `收起第 ${week.number} 周` : `展开第 ${week.number} 周`}
        onClick={onToggleExpanded}
        className="flex w-full items-center gap-3 bg-white px-4 py-3 text-left transition-colors duration-200 hover:bg-black/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0071e3]/30 dark:bg-[#1c1c1e] dark:hover:bg-white/[0.03]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f5f5f7] text-[12px] font-semibold text-[#1d1d1f] dark:bg-white/[0.08] dark:text-[#f5f5f7]">
          {week.number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
            {week.title}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-gray-500 dark:text-[#8e8e93]">
            {dateRangeLabel(week)} · {week.goal}
          </span>
        </span>
        <span className="shrink-0 text-[12px] tabular-nums text-gray-500 dark:text-[#a1a1a6]">
          {progress.percent}%
        </span>
        {expanded ? (
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-gray-400" />
        ) : (
          <ChevronRightIcon className="h-4 w-4 shrink-0 text-gray-400" />
        )}
      </button>

      {expanded ? (
        <div className="border-t border-gray-100 bg-[#fbfbfd] px-2 py-2 dark:border-white/[0.08] dark:bg-[#161618]">
          <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
            {week.days.map((day) => (
              <DayRow
                key={day.id}
                week={week}
                day={day}
                today={today}
                notice={notice?.dayId === day.id ? notice.text : null}
                onToggle={() => void toggle('day', day.id, !day.done)}
                onAddToSchedule={
                  onAddDayToSchedule &&
                  day.date === today &&
                  !day.done &&
                  notice?.dayId !== day.id
                    ? () => void addDay(day)
                    : undefined
                }
              />
            ))}
          </div>

          <div className="mt-2 rounded-2xl bg-white p-4 dark:bg-[#1c1c1e]">
            <p className="text-[12px] font-medium tracking-wide text-gray-500 dark:text-[#a1a1a6]">
              本周验收
            </p>
            <ul className="mt-2 space-y-2">
              {week.checks.map((check) => (
                <li key={check.id} className="flex items-start gap-2.5">
                  <Checkbox
                    checked={check.done}
                    label={`完成验收：${check.text}`}
                    onChange={() => void toggle('check', check.id, !check.done)}
                  />
                  <span
                    className={`text-[13px] leading-6 ${
                      check.done
                        ? 'text-gray-400 line-through dark:text-[#8e8e93]'
                        : 'text-[#1d1d1f] dark:text-[#f5f5f7]'
                    }`}
                  >
                    {check.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {error ? (
            <p role="alert" className="px-2 pt-2 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function PhaseSection({
  plan,
  phase,
  today,
  expandedWeeks,
  onToggleWeek,
  onSetItemDone,
  onAddDayToSchedule
}: {
  plan: LongPlan;
  phase: LongPlanPhase;
  today: string;
  expandedWeeks: Set<string>;
  onToggleWeek: (weekId: string) => void;
  onSetItemDone: (input: UpdateLongPlanItemInput) => Promise<LongPlan>;
  onAddDayToSchedule?: (plan: LongPlan, day: LongPlanDay) => Promise<void>;
}) {
  const progress = phaseProgress(phase);
  return (
    <section className="mt-6">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
            {phase.title}
          </h3>
          {phase.subtitle ? (
            <p className="mt-0.5 text-[12px] text-gray-500 dark:text-[#8e8e93]">
              {phase.subtitle}
            </p>
          ) : null}
          {phase.goal ? (
            <p className="mt-1 text-[12px] leading-5 text-gray-400 dark:text-[#8e8e93]">
              {phase.goal}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-[12px] tabular-nums text-gray-500 dark:text-[#a1a1a6]">
          {progress.done}/{progress.total} · {progress.percent}%
        </span>
      </header>
      <div className="space-y-2">
        {phase.weeks.map((week) => (
          <WeekSection
            key={week.id}
            plan={plan}
            week={week}
            today={today}
            expanded={expandedWeeks.has(week.id)}
            onToggleExpanded={() => onToggleWeek(week.id)}
            onSetItemDone={onSetItemDone}
            {...(onAddDayToSchedule ? { onAddDayToSchedule } : {})}
          />
        ))}
      </div>
    </section>
  );
}

export function LongPlanPage({
  plans,
  workspaces,
  defaultWorkspaceId,
  today,
  onOpenSidebar,
  onCreatePlan,
  onSetItemDone,
  onDeletePlan,
  onAddDayToSchedule
}: LongPlanPageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<string>>(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<PlanForm>({
    workspaceId: defaultWorkspaceId ?? workspaces[0]?.id ?? '',
    goal: '',
    startDate: today,
    weeks: '12',
    weeklyHours: '10',
    notes: '',
    references: '',
    research: false
  });

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedId) ?? plans[0] ?? null,
    [plans, selectedId]
  );
  const workspaceName = useMemo(() => {
    const map = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
    return (id: string) => map.get(id) ?? '工作区';
  }, [workspaces]);
  const progress = selectedPlan ? planProgress(selectedPlan) : null;
  const basis = selectedPlan ? planBasis(selectedPlan) : 'model';

  useEffect(() => {
    if (!selectedPlan) {
      setExpandedWeeks(new Set());
      return;
    }
    const week = currentPlanWeek(selectedPlan, today);
    setExpandedWeeks(new Set(week ? [week.id] : []));
  }, [selectedPlan?.id, today]);

  function openForm() {
    setForm({
      workspaceId:
        defaultWorkspaceId && workspaces.some((item) => item.id === defaultWorkspaceId)
          ? defaultWorkspaceId
          : workspaces[0]?.id ?? '',
      goal: '',
      startDate: today,
      weeks: '12',
      weeklyHours: '10',
      notes: '',
      references: '',
      research: false
    });
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    if (creating) return;
    setFormOpen(false);
    setFormError(null);
  }

  function toggleWeek(weekId: string) {
    setExpandedWeeks((current) => {
      const next = new Set(current);
      if (next.has(weekId)) next.delete(weekId);
      else next.add(weekId);
      return next;
    });
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    const goal = form.goal.trim();
    const weeks = Number(form.weeks);
    const weeklyHours = Number(form.weeklyHours);
    if (!goal) {
      setFormError('目标不能为空。');
      return;
    }
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 16) {
      setFormError('总周数必须在 1 到 16 之间。');
      return;
    }
    if (!Number.isFinite(weeklyHours) || weeklyHours < 1 || weeklyHours > 80) {
      setFormError('每周投入必须在 1 到 80 小时之间。');
      return;
    }
    if (!form.workspaceId) {
      setFormError('请先创建一个工作区。');
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      const created = await onCreatePlan({
        workspaceId: form.workspaceId,
        goal,
        startDate: form.startDate,
        weeks,
        weeklyHours,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        ...(form.references.trim() ? { references: form.references.trim() } : {}),
        ...(form.research ? { research: true } : {})
      });
      setSelectedId(created.id);
      setFormOpen(false);
    } catch (cause) {
      setFormError(errorText(cause));
    } finally {
      setCreating(false);
    }
  }

  async function deleteSelectedPlan() {
    if (!selectedPlan || !onDeletePlan || deleting) return;
    if (typeof window !== 'undefined' && !window.confirm(`删除计划「${selectedPlan.goal}」？`)) {
      return;
    }
    setDeleting(true);
    setPlanError(null);
    try {
      await onDeletePlan(selectedPlan.id);
      setSelectedId(null);
    } catch (cause) {
      setPlanError(errorText(cause));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <PageFrame
      title="长期计划"
      subtitle="阶段 · 周 · 日"
      onOpenSidebar={onOpenSidebar}
      action={
        plans.length > 0 ? (
          <button type="button" onClick={openForm} className={primaryButton}>
            <PlusIcon className="h-4 w-4" />
            新建长期计划
          </button>
        ) : null
      }
    >
      {plans.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300/80 px-6 py-16 text-center dark:border-white/10">
          <p className="text-[16px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
            还没有长期计划。
          </p>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
            告诉阿咲你的目标、总时长和每周投入，阿咲会拆成阶段、周和每天该做什么。
          </p>
          <button
            type="button"
            onClick={openForm}
            disabled={workspaces.length === 0}
            className={`mt-5 ${primaryButton}`}
          >
            <PlusIcon className="h-4 w-4" />
            新建长期计划
          </button>
          {workspaces.length === 0 ? (
            <p className="mt-3 text-[12px] text-gray-400 dark:text-[#8e8e93]">
              先在对话里创建一个工作区。
            </p>
          ) : null}
        </div>
      ) : null}

      {selectedPlan && progress ? (
        <>
          {plans.length > 1 ? (
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {plans.map((plan) => {
                const current = plan.id === selectedPlan.id;
                const planPercent = planProgress(plan).percent;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    aria-label={`查看计划：${plan.goal}`}
                    aria-pressed={current}
                    onClick={() => setSelectedId(plan.id)}
                    className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-[12px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 ${
                      current
                        ? 'bg-[#0071e3]/10 font-medium text-[#0071e3] dark:bg-[#0a84ff]/15 dark:text-[#4da3ff]'
                        : 'bg-white text-gray-600 hover:bg-black/[0.03] dark:bg-[#1c1c1e] dark:text-[#a1a1a6] dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className="max-w-[180px] truncate">{plan.goal}</span>
                    <span className="tabular-nums text-gray-400">{planPercent}%</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <section
            aria-label="计划详情"
            className="rounded-2xl bg-white p-5 shadow-sm dark:bg-[#1c1c1e] md:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-[20px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7] md:text-[22px]">
                  {selectedPlan.goal}
                </h2>
                <p className="mt-1 text-[12px] text-gray-500 dark:text-[#8e8e93]">
                  {workspaceName(selectedPlan.workspaceId)} · {planRangeLabel(selectedPlan)} · 每周约{' '}
                  {selectedPlan.weeklyHours} 小时
                </p>
                {selectedPlan.generatedBy === 'template' ? (
                  <p className="mt-2 rounded-xl bg-[#ff9f0a]/10 px-3 py-2 text-[12px] leading-5 text-[#8a5a00] dark:bg-[#ff9f0a]/15 dark:text-[#ffb340]">
                    阿咲没有连接到模型，这份是通用框架；配置模型后可以重新生成更贴合目标的计划。
                  </p>
                ) : null}
                {selectedPlan.generatedBy !== 'template' ? (
                  <div className="mt-2 text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
                    <p>
                      {basis === 'web'
                        ? `依据：联网调研 · ${selectedPlan.sources?.length ?? 0} 个来源`
                        : basis === 'references'
                          ? '依据：你提供的参考资料'
                          : '依据：模型知识（未联网核实）'}
                    </p>
                    {selectedPlan.knowledge?.length ? (
                      <p className="mt-1">
                        已参考知识库：
                        {selectedPlan.knowledge
                          .map((topic) => `${topic.name}（${KNOWLEDGE_STATUS_LABELS[topic.status]}）`)
                          .join('、')}
                      </p>
                    ) : null}
                    {basis === 'web' && selectedPlan.sources?.length ? (
                      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        {selectedPlan.sources.map((source) => (
                          <li key={source.url}>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              className="underline decoration-gray-300 underline-offset-2 transition-colors hover:text-[#0071e3] dark:decoration-white/20 dark:hover:text-[#4da3ff]"
                            >
                              {source.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {selectedPlan.references ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer select-none">查看参考资料</summary>
                        <p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-gray-400 dark:text-[#8e8e93]">
                          {selectedPlan.references}
                        </p>
                      </details>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {onDeletePlan ? (
                  <button
                    type="button"
                    onClick={() => void deleteSelectedPlan()}
                    disabled={deleting}
                    className={secondaryButton}
                  >
                    删除计划
                  </button>
                ) : null}
                <span className="rounded-full bg-[#0071e3]/10 px-3 py-1 text-[12px] font-medium tabular-nums text-[#0071e3] dark:bg-[#0a84ff]/15 dark:text-[#4da3ff]">
                  {progress.percent}%
                </span>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-[12px] text-gray-500 dark:text-[#a1a1a6]">
                <span>完成进度</span>
                <span className="tabular-nums">
                  {progress.done} / {progress.total}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="计划进度"
                aria-valuenow={progress.done}
                aria-valuemin={0}
                aria-valuemax={progress.total}
                className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/10"
              >
                <div
                  className="h-full rounded-full bg-[#0071e3] transition-all duration-300 motion-reduce:transition-none"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>

            {planError ? (
              <p role="alert" className="mt-3 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
                {planError}
              </p>
            ) : null}

            {selectedPlan.phases.map((phase) => (
              <PhaseSection
                key={phase.id}
                plan={selectedPlan}
                phase={phase}
                today={today}
                expandedWeeks={expandedWeeks}
                onToggleWeek={toggleWeek}
                onSetItemDone={onSetItemDone}
                {...(onAddDayToSchedule ? { onAddDayToSchedule } : {})}
              />
            ))}
          </section>
        </>
      ) : null}

      <Dialog open={formOpen} onClose={closeForm} title="新建长期计划">
        <form onSubmit={(event) => void submitForm(event)}>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="long-plan-workspace"
                className="mb-1.5 block text-[12px] font-medium text-gray-500 dark:text-[#a1a1a6]"
              >
                工作区
              </label>
              <select
                id="long-plan-workspace"
                value={form.workspaceId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, workspaceId: event.target.value }))
                }
                disabled={creating}
                className="h-10 w-full rounded-xl border-0 bg-[#f5f5f7] px-3 text-[13px] text-[#1d1d1f] outline-none focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="long-plan-goal"
                className="mb-1.5 block text-[12px] font-medium text-gray-500 dark:text-[#a1a1a6]"
              >
                目标
              </label>
              <textarea
                id="long-plan-goal"
                value={form.goal}
                onChange={(event) =>
                  setForm((current) => ({ ...current, goal: event.target.value }))
                }
                rows={3}
                maxLength={300}
                disabled={creating}
                placeholder="例如：系统学习 AI Agent，能独立做一个多工具 Agent 项目"
                className="w-full rounded-xl border-0 bg-[#f5f5f7] px-3 py-2.5 text-[13px] leading-6 text-[#1d1d1f] outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="long-plan-start"
                  className="mb-1.5 block text-[12px] font-medium text-gray-500 dark:text-[#a1a1a6]"
                >
                  开始日期
                </label>
                <input
                  id="long-plan-start"
                  type="date"
                  value={form.startDate}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, startDate: event.target.value }))
                  }
                  disabled={creating}
                  className="h-10 w-full rounded-xl border-0 bg-[#f5f5f7] px-2 text-[12px] text-[#1d1d1f] outline-none focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
                />
              </div>
              <div>
                <label
                  htmlFor="long-plan-weeks"
                  className="mb-1.5 block text-[12px] font-medium text-gray-500 dark:text-[#a1a1a6]"
                >
                  总周数
                </label>
                <input
                  id="long-plan-weeks"
                  type="number"
                  min={1}
                  max={16}
                  value={form.weeks}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, weeks: event.target.value }))
                  }
                  disabled={creating}
                  className="h-10 w-full rounded-xl border-0 bg-[#f5f5f7] px-2 text-[12px] text-[#1d1d1f] outline-none focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
                />
              </div>
              <div>
                <label
                  htmlFor="long-plan-hours"
                  className="mb-1.5 block text-[12px] font-medium text-gray-500 dark:text-[#a1a1a6]"
                >
                  每周投入（小时）
                </label>
                <input
                  id="long-plan-hours"
                  type="number"
                  min={1}
                  max={80}
                  value={form.weeklyHours}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, weeklyHours: event.target.value }))
                  }
                  disabled={creating}
                  className="h-10 w-full rounded-xl border-0 bg-[#f5f5f7] px-2 text-[12px] text-[#1d1d1f] outline-none focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="long-plan-notes"
                className="mb-1.5 block text-[12px] font-medium text-gray-500 dark:text-[#a1a1a6]"
              >
                补充说明（可选）
              </label>
              <textarea
                id="long-plan-notes"
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                rows={2}
                maxLength={800}
                disabled={creating}
                placeholder="已有基础、每天可用的时间、偏好的资料……"
                className="w-full rounded-xl border-0 bg-[#f5f5f7] px-3 py-2.5 text-[13px] leading-6 text-[#1d1d1f] outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
              />
            </div>

            <div>
              <label
                htmlFor="long-plan-references"
                className="mb-1.5 block text-[12px] font-medium text-gray-500 dark:text-[#a1a1a6]"
              >
                参考资料（可选）
              </label>
              <textarea
                id="long-plan-references"
                value={form.references}
                onChange={(event) =>
                  setForm((current) => ({ ...current, references: event.target.value }))
                }
                rows={4}
                maxLength={4000}
                disabled={creating}
                placeholder="粘贴课程大纲、招聘 JD、教材目录或链接里的内容，计划会按它来排。"
                className="w-full rounded-xl border-0 bg-[#f5f5f7] px-3 py-2.5 text-[13px] leading-6 text-[#1d1d1f] outline-none placeholder:text-gray-400 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
              />
            </div>

            <label className="flex items-start gap-2.5 rounded-xl bg-[#f5f5f7] px-3 py-2.5 dark:bg-[#242426]">
              <input
                type="checkbox"
                aria-label="先联网调研"
                checked={form.research}
                onChange={(event) =>
                  setForm((current) => ({ ...current, research: event.target.checked }))
                }
                disabled={creating}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-[#0071e3]"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                  先联网调研
                </span>
                <span className="mt-0.5 block text-[11px] leading-5 text-gray-400 dark:text-[#8e8e93]">
                  生成前先查资料并记录来源；模型或 CLI 不支持联网时会标注「未联网核实」，不会编造来源。
                </span>
              </span>
            </label>
          </div>

          {formError ? (
            <p role="alert" className="mt-3 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
              {formError}
            </p>
          ) : null}

          <p className="mt-3 text-[11px] leading-5 text-gray-400 dark:text-[#8e8e93]">
            阿咲会按总时长拆成阶段、周和每日任务；模型生成可能需要 1–2 分钟，勾选联网调研会再多一步查资料。
          </p>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeForm}
              disabled={creating}
              className="rounded-full px-4 py-2 text-[13px] font-medium text-gray-500 transition-all duration-300 hover:bg-black/[0.04] active:scale-[0.98] disabled:opacity-40 dark:text-[#a1a1a6] dark:hover:bg-white/[0.06]"
            >
              取消
            </button>
            <button type="submit" disabled={creating} className={primaryButton}>
              {creating ? '生成中…' : '生成计划'}
            </button>
          </div>
        </form>
      </Dialog>
    </PageFrame>
  );
}
