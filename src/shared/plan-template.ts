import { formatLocalDate, parseLocalDate } from './date';
import type {
  LongPlanCheck,
  LongPlanDay,
  LongPlanGeneratedBy,
  LongPlanKnowledge,
  LongPlanPhase,
  LongPlanWeek
} from './plans';
import { planWeekday } from './plans';
import type { Workspace } from './workspace';

const MAX_WEEKS = 16;
const DAYS_PER_WEEK = 7;
const MAX_TASKS_PER_DAY = 4;
const MAX_CHECKS_PER_WEEK = 6;
const MIN_CHECKS_PER_WEEK = 3;

export interface RawDay {
  tasks: string[];
  output: string;
}

export interface RawWeek {
  title: string;
  goal: string;
  days: RawDay[];
  checks: string[];
}

export interface RawPhase {
  title: string;
  subtitle: string;
  goal: string;
  weeks: RawWeek[];
}

export interface LongPlanGenerationInput {
  workspace: Workspace;
  goal: string;
  startDate: string;
  weeks: number;
  weeklyHours: number;
  notes?: string;
  /** Reference material the user pasted; the plan must follow it. */
  references?: string;
  /** Verified facts from the optional web research pass. */
  researchFacts?: string[];
  /** Topics the user has mastered or is learning; only the model can use them. */
  knownTopics?: LongPlanKnowledge[];
}

export interface GeneratedLongPlan {
  phases: LongPlanPhase[];
  generatedBy: LongPlanGeneratedBy;
}

export function clipPlanText(value: string, maxLength: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

function addDays(date: string, days: number): string {
  const value = parseLocalDate(date);
  value.setDate(value.getDate() + days);
  return formatLocalDate(value);
}

function catchUpDay(goal: string): RawDay {
  return {
    tasks: ['补上未完成的内容', '整理本周笔记，列出下周重点'],
    output: `「${goal}」的本周进度已补齐`
  };
}

function fillerChecks(goal: string): string[] {
  return [
    `本周目标与「${goal}」相关，能说清完成了什么`,
    '留下一条可复用的笔记或产出',
    '下周的三个重点已经写下来'
  ];
}

function fillerWeek(goal: string): RawWeek {
  return {
    title: '',
    goal: `继续推进「${goal}」：复盘上一周并完成一个可验收的小产出`,
    days: Array.from({ length: DAYS_PER_WEEK }, () => catchUpDay(goal)),
    checks: fillerChecks(goal)
  };
}

function normalizeDay(
  day: RawDay | undefined,
  weekId: string,
  date: string,
  index: number,
  goal: string
): LongPlanDay {
  const resolved = day ?? catchUpDay(goal);
  return {
    id: `${weekId}d${index + 1}`,
    date,
    weekday: planWeekday(date),
    tasks: resolved.tasks.length > 0 ? resolved.tasks.slice(0, MAX_TASKS_PER_DAY) : [`推进「${goal}」`],
    output: resolved.output || '完成当天任务并留下记录',
    done: false
  };
}

function normalizeChecks(raw: string[], weekId: string, goal: string): LongPlanCheck[] {
  const texts = raw.slice(0, MAX_CHECKS_PER_WEEK);
  const fallback = [
    `本周目标「${goal}」已经完成`,
    '留下可复用的笔记或产出',
    '能用自己的话讲清本周学到的内容'
  ];
  for (let index = 0; texts.length < MIN_CHECKS_PER_WEEK; index += 1) {
    const text = fallback[index % fallback.length]!;
    if (!texts.includes(text)) texts.push(text);
  }
  return texts.map((text, index) => ({
    id: `${weekId}c${index + 1}`,
    text,
    done: false
  }));
}

/**
 * Turns the raw phase list into a continuous, exactly-N-week plan. Missing
 * weeks are padded with catch-up weeks, extra weeks are dropped, and missing
 * days are padded so every week has seven dated rows.
 */
export function normalizeLongPlanPhases(
  rawPhases: RawPhase[],
  input: LongPlanGenerationInput
): LongPlanPhase[] {
  const groups = rawPhases.length > 0 ? rawPhases : buildTemplatePhases(input);
  const entries: Array<{ phaseIndex: number; week: RawWeek }> = [];
  groups.forEach((phase, phaseIndex) => {
    phase.weeks.forEach((week) => entries.push({ phaseIndex, week }));
  });
  const targetWeeks = Math.max(1, Math.min(MAX_WEEKS, input.weeks));

  if (entries.length === 0) {
    entries.push({ phaseIndex: 0, week: fillerWeek(input.goal) });
  }
  while (entries.length < targetWeeks) {
    entries.push({
      phaseIndex: entries[entries.length - 1]!.phaseIndex,
      week: fillerWeek(input.goal)
    });
  }
  entries.length = targetWeeks;

  const byPhase = new Map<number, Array<{ index: number; week: RawWeek }>>();
  entries.forEach((entry, index) => {
    const list = byPhase.get(entry.phaseIndex) ?? [];
    list.push({ index, week: entry.week });
    byPhase.set(entry.phaseIndex, list);
  });

  const phases: LongPlanPhase[] = [];
  for (const [phaseIndex, phaseWeeks] of [...byPhase.entries()].sort(
    (a, b) => a[0] - b[0]
  )) {
    const rawPhase = groups[phaseIndex];
    if (rawPhase === undefined || phaseWeeks.length === 0) continue;
    const phaseId = `ph${phases.length + 1}`;
    const weeks: LongPlanWeek[] = phaseWeeks.map(({ index, week }) => {
      const weekNumber = index + 1;
      const weekId = `w${weekNumber}`;
      const startDate = addDays(input.startDate, (weekNumber - 1) * DAYS_PER_WEEK);
      const endDate = addDays(startDate, DAYS_PER_WEEK - 1);
      const goal = week.goal || `推进「${input.goal}」`;
      return {
        id: weekId,
        number: weekNumber,
        title: week.title || `第 ${weekNumber} 周`,
        goal,
        startDate,
        endDate,
        days: Array.from({ length: DAYS_PER_WEEK }, (_value, dayIndex) =>
          normalizeDay(week.days[dayIndex], weekId, addDays(startDate, dayIndex), dayIndex, goal)
        ),
        checks: normalizeChecks(week.checks, weekId, goal)
      };
    });
    phases.push({
      id: phaseId,
      title: rawPhase.title || `阶段${chineseNumber(phases.length + 1)}：${input.goal}`,
      subtitle: rawPhase.subtitle,
      goal: rawPhase.goal || `推进「${input.goal}」`,
      weeks
    });
  }

  return phases;
}

export function buildTemplatePlan(input: LongPlanGenerationInput): GeneratedLongPlan {
  const phases = normalizeLongPlanPhases(buildTemplatePhases(input), input);
  return {
    phases:
      phases.length > 0
        ? phases
        : normalizeLongPlanPhases(
            [{ title: '', subtitle: '', goal: input.goal, weeks: [fillerWeek(input.goal)] }],
            input
          ),
    generatedBy: 'template'
  };
}

function chineseNumber(value: number): string {
  return ['零', '一', '二', '三', '四', '五', '六'][value] ?? String(value);
}

interface PhaseShape {
  title: string;
  subtitle: string;
  goal: string;
  stacks: RawDay[][];
  checks: string[];
}

function foundationDays(goal: string, hours: number): RawDay[][] {
  return [
    [
      { tasks: ['明确本周目标，列出 3 个要解决的问题', '整理本周要用的资料'], output: '本周问题清单' },
      { tasks: ['学习核心概念并做一页笔记', '标记仍然不懂的地方'], output: '一页概念笔记' },
      { tasks: ['完成基础练习', '对照答案订正'], output: '练习与订正记录' },
      { tasks: ['用自己的话复述核心概念', '补齐昨天没懂的内容'], output: '能讲清一个概念' },
      { tasks: ['做一个小实验或最小 demo', '记录运行结果'], output: '可运行的最小产出' },
      { tasks: ['做一组综合练习', '整理错题或卡点'], output: '综合练习记录' },
      {
        tasks: ['复盘本周、补进度', '列出下周的 3 个重点'],
        output: `「${goal}」本周复盘 + 下周清单（约 ${hours} 小时）`
      }
    ]
  ];
}

function practiceDays(): RawDay[][] {
  return [
    [
      { tasks: ['选定本周要完成的练习或功能', '把它拆成能一天做完的小步'], output: '本周任务拆解' },
      { tasks: ['动手完成第一版', '记录卡住的地方'], output: '第一版可运行' },
      { tasks: ['继续实现，补齐主要路径', '写一条使用说明'], output: '主要功能可用' },
      { tasks: ['调试边界情况', '记录问题与解决方法'], output: '问题清单 + 修复记录' },
      { tasks: ['完成一个可展示的版本', '截图或录屏'], output: '可展示的产出' },
      { tasks: ['对照验收标准自检', '整理本周笔记'], output: '验收记录' },
      { tasks: ['补进度、整理归档', '安排下周练习'], output: '本周归档 + 下周计划' }
    ]
  ];
}

function projectDays(goal: string): RawDay[][] {
  return [
    [
      { tasks: ['明确本周交付物和验收标准', '列出风险点'], output: '本周交付清单' },
      { tasks: ['完成核心功能的第一部分', '保持可运行'], output: '可运行的新增功能' },
      { tasks: ['完成核心功能的第二部分', '补必要的测试'], output: '功能完成 + 测试记录' },
      { tasks: ['修 bug、补边界与文档', '记录一个技术难点'], output: '修复记录 + 难点说明' },
      { tasks: ['做一次完整演示/验收', '按验收标准逐条勾选'], output: `「${goal}」本周验收结果` },
      { tasks: ['整理 README 或作品说明', '准备能讲 2 分钟的总结'], output: '可展示的作品说明' },
      { tasks: ['复盘本周、补进度', '确认下周冲刺目标'], output: '复盘 + 下周目标' }
    ]
  ];
}

function buildTemplatePhases(input: LongPlanGenerationInput): RawPhase[] {
  const total = Math.max(1, Math.min(MAX_WEEKS, input.weeks));
  const shapes: PhaseShape[] = [];
  if (total <= 2) {
    shapes.push({
      title: '阶段一：快速建立基础',
      subtitle: '理解核心概念 → 完成一个最小产出',
      goal: `围绕「${input.goal}」完成入门`,
      stacks: foundationDays(input.goal, input.weeklyHours),
      checks: [
        '能用自己的话解释本周的核心概念',
        '完成本周练习并留下记录',
        '有一个可以运行或展示的最小产出'
      ]
    });
  } else if (total <= 4) {
    shapes.push(
      {
        title: '阶段一：建立基础',
        subtitle: '理解核心概念 → 完成基础练习',
        goal: `围绕「${input.goal}」打基础`,
        stacks: foundationDays(input.goal, input.weeklyHours),
        checks: [
          '能用自己的话解释本周的核心概念',
          '完成本周练习并留下记录',
          '本周笔记已经归档'
        ]
      },
      {
        title: '阶段二：动手实践',
        subtitle: '把知识变成可展示的产出',
        goal: `围绕「${input.goal}」完成实践`,
        stacks: practiceDays(),
        checks: [
          '完成一个可运行或可展示的练习',
          '记录遇到的问题和解决方法',
          '本周产出已经归档'
        ]
      }
    );
  } else {
    shapes.push(
      {
        title: '阶段一：建立基础',
        subtitle: '理解核心概念 → 完成基础练习',
        goal: `围绕「${input.goal}」打基础`,
        stacks: foundationDays(input.goal, input.weeklyHours),
        checks: [
          '能用自己的话解释本周的核心概念',
          '完成本周练习并留下记录',
          '本周笔记已经归档'
        ]
      },
      {
        title: '阶段二：动手实践',
        subtitle: '把知识变成可复用的练习',
        goal: `围绕「${input.goal}」积累实践`,
        stacks: practiceDays(),
        checks: [
          '完成一个可运行或可展示的练习',
          '记录遇到的问题和解决方法',
          '本周产出已经归档'
        ]
      },
      {
        title: '阶段三：项目冲刺',
        subtitle: '做一个能讲清楚的完整产出',
        goal: `围绕「${input.goal}」完成项目交付`,
        stacks: projectDays(input.goal),
        checks: [
          '项目本周部分可运行',
          '按验收标准逐条检查并留下记录',
          '已经准备好下周的冲刺目标'
        ]
      }
    );
  }

  const weights =
    shapes.length === 1 ? [1] : shapes.length === 2 ? [0.5, 0.5] : [0.4, 0.35, 0.25];
  const counts = weights.map((weight) => Math.max(1, Math.floor(total * weight)));
  let assigned = counts.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  while (assigned > total) {
    const index = counts.length - 1 - (cursor % counts.length);
    if (counts[index]! > 1) {
      counts[index] = counts[index]! - 1;
      assigned -= 1;
    }
    cursor += 1;
  }
  while (assigned < total) {
    counts[counts.length - 1] = counts[counts.length - 1]! + 1;
    assigned += 1;
  }

  let weekNumber = 0;
  return shapes.map((shape, phaseIndex) => ({
    title: shape.title,
    subtitle: shape.subtitle,
    goal: shape.goal,
    weeks: Array.from({ length: counts[phaseIndex]! }, (_value, index) => {
      weekNumber += 1;
      const stack = shape.stacks[index % shape.stacks.length]!;
      return {
        title: `第 ${weekNumber} 周：${shape.title.replace(/^阶段[一二三四五]：/, '')} ${index + 1}`,
        goal: `${shape.goal}（第 ${index + 1} 周，约 ${input.weeklyHours} 小时）`,
        days: stack,
        checks: shape.checks
      };
    })
  }));
}
