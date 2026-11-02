import type { NoteMeta } from '../../shared/types';
import type {
  LongPlan,
  LongPlanCheck,
  LongPlanDay,
  LongPlanGeneratedBy,
  LongPlanKnowledge,
  LongPlanPhase,
  LongPlanSource,
  LongPlanWeek
} from '../../shared/plans';
import { planBasis, planMonthDay, planWeekday } from '../../shared/plans';
import { isKnowledgeStatus } from '../knowledge/records';
import { parseNote, serializeNote } from '../vault/note';
import { asBoolean, asFiniteNumber, asRecord, asString, asStringArray } from '../workspace/records/coerce';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    ISO_DATE.test(value) &&
    !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
  );
}

function asInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function httpUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function coerceSources(value: unknown): LongPlanSource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sources: LongPlanSource[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (record === null) continue;
    const url = httpUrl(record.url);
    if (url === null || seen.has(url.href)) continue;
    seen.add(url.href);
    const title = asString(record.title)?.trim();
    sources.push({ title: title || url.hostname, url: url.href });
    if (sources.length >= 8) break;
  }
  return sources;
}

function coerceKnowledge(value: unknown): LongPlanKnowledge[] {
  if (!Array.isArray(value)) return [];
  const topics: LongPlanKnowledge[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (record === null) continue;
    const name = asString(record.name)?.trim();
    if (!name || !isKnowledgeStatus(record.status)) continue;
    topics.push({ name, status: record.status });
    if (topics.length >= 20) break;
  }
  return topics;
}

function coerceDay(value: unknown, weekId: string, index: number): LongPlanDay | null {
  const record = asRecord(value);
  if (record === null) return null;
  const date = asString(record.date);
  if (!isIsoDate(date)) return null;
  const tasks = asStringArray(record.tasks).filter((task) => task.trim() !== '');
  return {
    id: asString(record.id) ?? `${weekId}d${index + 1}`,
    date,
    weekday: asString(record.weekday) ?? planWeekday(date),
    tasks,
    output: asString(record.output) ?? '',
    done: asBoolean(record.done, false)
  };
}

function coerceCheck(value: unknown, weekId: string, index: number): LongPlanCheck | null {
  const record = asRecord(value);
  if (record === null) return null;
  const text = asString(record.text)?.trim();
  if (!text) return null;
  return {
    id: asString(record.id) ?? `${weekId}c${index + 1}`,
    text,
    done: asBoolean(record.done, false)
  };
}

function coerceWeek(value: unknown, index: number): LongPlanWeek | null {
  const record = asRecord(value);
  if (record === null) return null;
  const startDate = asString(record.startDate);
  const endDate = asString(record.endDate);
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return null;
  const id = asString(record.id) ?? `w${index + 1}`;
  const days = Array.isArray(record.days)
    ? record.days
        .map((entry, dayIndex) => coerceDay(entry, id, dayIndex))
        .filter((day): day is LongPlanDay => day !== null)
    : [];
  const checks = Array.isArray(record.checks)
    ? record.checks
        .map((entry, checkIndex) => coerceCheck(entry, id, checkIndex))
        .filter((check): check is LongPlanCheck => check !== null)
    : [];
  return {
    id,
    number: asInt(record.number) ?? index + 1,
    title: asString(record.title) ?? `第 ${index + 1} 周`,
    goal: asString(record.goal) ?? '',
    startDate,
    endDate,
    days,
    checks
  };
}

function coercePhase(value: unknown, index: number): LongPlanPhase | null {
  const record = asRecord(value);
  if (record === null) return null;
  const weeks = Array.isArray(record.weeks)
    ? record.weeks
        .map((entry, weekIndex) => coerceWeek(entry, weekIndex))
        .filter((week): week is LongPlanWeek => week !== null)
    : [];
  if (weeks.length === 0) return null;
  return {
    id: asString(record.id) ?? `ph${index + 1}`,
    title: asString(record.title) ?? `阶段 ${index + 1}`,
    subtitle: asString(record.subtitle) ?? '',
    goal: asString(record.goal) ?? '',
    weeks
  };
}

/** Reads a `kind: long-plan` markdown file; returns null for anything else. */
export function parseLongPlanFile(raw: string, fallbackId: string): LongPlan | null {
  const { meta } = parseNote(raw);
  if (meta.kind !== 'long-plan') return null;
  const id = asString(meta.id) ?? fallbackId;
  const workspaceId = asString(meta.workspaceId);
  const goal = asString(meta.goal)?.trim();
  const startDate = asString(meta.startDate);
  if (!workspaceId || !goal || !isIsoDate(startDate)) return null;

  const phases = Array.isArray(meta.phases)
    ? meta.phases
        .map((entry, index) => coercePhase(entry, index))
        .filter((phase): phase is LongPlanPhase => phase !== null)
    : [];
  if (phases.length === 0) return null;

  const generatedBy: LongPlanGeneratedBy =
    meta.generatedBy === 'agent' ? 'agent' : 'template';
  const references = asString(meta.references)?.trim();
  const knowledge = coerceKnowledge(meta.knowledge);
  const recalibratedAt = asString(meta.recalibratedAt);
  const recalibratedFrom = asInt(meta.recalibratedFrom);
  return {
    id,
    workspaceId,
    goal,
    startDate,
    weeks:
      asInt(meta.weeks) ??
      phases.reduce((total, phase) => total + phase.weeks.length, 0),
    weeklyHours: asFiniteNumber(meta.weeklyHours) ?? 10,
    generatedBy,
    ...(references ? { references } : {}),
    sources: coerceSources(meta.sources),
    ...(knowledge.length ? { knowledge } : {}),
    ...(recalibratedAt ? { recalibratedAt } : {}),
    ...(recalibratedFrom !== undefined && recalibratedFrom > 0
      ? { recalibratedFrom }
      : {}),
    createdAt: asString(meta.created) ?? '',
    updatedAt: asString(meta.updated) ?? '',
    phases
  };
}

export function serializeLongPlanFile(plan: LongPlan): string {
  const meta: NoteMeta = {
    type: 'plan',
    source: plan.generatedBy === 'agent' ? 'agent' : 'user',
    kind: 'long-plan',
    id: plan.id,
    workspaceId: plan.workspaceId,
    goal: plan.goal,
    startDate: plan.startDate,
    weeks: plan.weeks,
    weeklyHours: plan.weeklyHours,
    generatedBy: plan.generatedBy,
    ...(plan.references ? { references: plan.references } : {}),
    ...(plan.sources?.length
      ? { sources: plan.sources.map((source) => ({ title: source.title, url: source.url })) }
      : {}),
    ...(plan.knowledge?.length
      ? {
          knowledge: plan.knowledge.map((topic) => ({
            name: topic.name,
            status: topic.status
          }))
        }
      : {}),
    ...(plan.recalibratedAt ? { recalibratedAt: plan.recalibratedAt } : {}),
    ...(plan.recalibratedFrom !== undefined
      ? { recalibratedFrom: plan.recalibratedFrom }
      : {}),
    created: plan.createdAt,
    updated: plan.updatedAt,
    phases: plan.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      subtitle: phase.subtitle,
      goal: phase.goal,
      weeks: phase.weeks.map((week) => ({
        id: week.id,
        number: week.number,
        title: week.title,
        goal: week.goal,
        startDate: week.startDate,
        endDate: week.endDate,
        days: week.days.map((day) => ({
          id: day.id,
          date: day.date,
          weekday: day.weekday,
          tasks: [...day.tasks],
          output: day.output,
          done: day.done
        })),
        checks: week.checks.map((check) => ({
          id: check.id,
          text: check.text,
          done: check.done
        }))
      }))
    }))
  };

  const lines: string[] = [
    `# ${plan.goal} · 长期计划`,
    '',
    `- 周期：${plan.weeks} 周 · 每周约 ${plan.weeklyHours} 小时`,
    `- 开始：${plan.startDate}`,
    `- 生成方式：${plan.generatedBy === 'agent' ? '阿咲' : '通用模板'}`,
    `- 依据：${basisLabel(plan)}`,
    ''
  ];
  for (const phase of plan.phases) {
    lines.push(`## ${phase.title}`);
    if (phase.subtitle) lines.push(`> ${phase.subtitle}`);
    if (phase.goal) lines.push(`阶段目标：${phase.goal}`);
    lines.push('');
    for (const week of phase.weeks) {
      lines.push(
        `### ${week.title}（${planMonthDay(week.startDate)} — ${planMonthDay(week.endDate)}）`
      );
      if (week.goal) lines.push(`本周目标：${week.goal}`);
      lines.push('');
      for (const day of week.days) {
        const checked = day.done ? 'x' : ' ';
        const tasks = day.tasks.join('；') || '—';
        lines.push(`- [${checked}] ${day.weekday} ${planMonthDay(day.date)}：${tasks}`);
        if (day.output) lines.push(`  - 产出：${day.output}`);
      }
      lines.push('', '**本周验收**');
      for (const check of week.checks) {
        lines.push(`- [${check.done ? 'x' : ' '}] ${check.text}`);
      }
      lines.push('');
    }
  }
  if (plan.sources?.length) {
    lines.push('## 依据来源');
    for (const source of plan.sources) {
      lines.push(`- [${source.title}](${source.url})`);
    }
    lines.push('');
  }
  if (plan.references) {
    lines.push('## 参考资料');
    for (const line of plan.references.split('\n')) lines.push(`> ${line}`);
    lines.push('');
  }
  return serializeNote(meta, lines.join('\n'));
}

function basisLabel(plan: LongPlan): string {
  if (plan.generatedBy === 'template') return '通用模板';
  switch (planBasis(plan)) {
    case 'web':
      return `联网调研（${plan.sources?.length ?? 0} 个来源）`;
    case 'references':
      return '你提供的参考资料';
    default:
      return '模型知识（未联网核实）';
  }
}
