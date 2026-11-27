import { formatLocalDate, isLocalDate } from '../../shared/date';
import { ToolInputError, type ButlerToolContext } from '../butler/tools';
import type { GatewayToolEntry } from './tool-gateway';

/**
 * 场景三：只读跨项目周复盘工具（spec P4，验收 20–22）。
 *
 * 设计要点（对应验收逐条）：
 * - 验收 20「每条结论附来源记录标识」：工具返回的每条事实都带
 *   `source: { recordId, kind, path? }`，另附一份 `references` 数组——网关在
 *   工具成功后把合法的 references 发成 `references` 事件（缝④），UI 与
 *   引擎两条路径都能拿到同一份来源。工具描述同时要求模型：写结论必须引用
 *   recordId，无记录支撑的结论必须明示「推断」。
 * - 验收 21「某项目无记录明说没有」：每个项目段都有 `hasRecords`；为 false
 *   时附 `noRecordNotice`（「本周没有记录」），模型照实转述，不编补。
 * - 验收 22「全程只读」：本工具只读（查询级）；配合 `RunRequest.readOnly`
 *   时网关拒绝一切写入类调用并记 `tool.failed`。
 *
 * 工具只负责取事实与标注来源，不替模型写结论；「区分记录与推断」是模型在
 * 复盘措辞层的义务，由工具描述约束、场景测试锁定。
 */

/** 本地日期 YYYY-MM-DD 加 N 天（跨月跨年精确；与 commitments/records 同法）。 */
function addLocalDays(date: Date, days: number): string {
  const shifted = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return formatLocalDate(shifted);
}

/** 本周的周一（与练习总览同一口径：周一开周）。 */
function mondayOf(date: Date): string {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return formatLocalDate(start);
}

/** ISO 时间戳（或日期串）的本地日期前缀；读不出来返回 null。 */
function dayOf(timestamp: string | undefined): string | null {
  if (typeof timestamp !== 'string') return null;
  const day = timestamp.slice(0, 10);
  return isLocalDate(day) ? day : null;
}

/** 事实行：一条可引用的记录摘要 + 来源标识。 */
interface WeeklyFact {
  source: { recordId: string; kind: string; path?: string };
  summary: string;
}

/** 一个项目段；无记录时 hasRecords=false 且带明示文案（验收 21）。 */
interface WeeklyWorkspaceSection {
  workspaceId: string;
  name: string;
  kind: string;
  hasRecords: boolean;
  noRecordNotice?: string;
  facts: WeeklyFact[];
}

export function buildWeeklyReviewTool(): GatewayToolEntry {
  return {
    name: 'weekly_review',
    level: 'query',
    description:
      '只读汇总某一周各项目的全部记录（任务、笔记、记忆、承诺），每条事实都带来源记录标识。用户要「总结这一周」时调用。写周复盘时必须遵守：每条结论都标注来源记录 ID（source.recordId）；没有记录支撑的结论必须明示「推断」；某个项目 facts 为空（hasRecords=false）时必须明说该项目本周没有记录，绝不编造记录。',
    parameters: {
      type: 'object',
      properties: {
        weekStart: {
          type: 'string',
          description: '那周的周一（YYYY-MM-DD）；省略为本周'
        }
      },
      additionalProperties: false
    },
    async execute(input: Record<string, unknown>, context: ButlerToolContext): Promise<unknown> {
      const rawWeekStart = input['weekStart'];
      if (rawWeekStart !== undefined && rawWeekStart !== null && rawWeekStart !== '') {
        if (typeof rawWeekStart !== 'string' || !isLocalDate(rawWeekStart)) {
          throw new ToolInputError('参数 weekStart 必须是 YYYY-MM-DD。');
        }
      }
      const weekStart =
        typeof rawWeekStart === 'string' && rawWeekStart !== '' ? rawWeekStart : mondayOf(context.now());
      return assembleWeek(context, weekStart);
    }
  };
}

/** 窗口内判断：本地日期落在 [weekStart, weekStart+6]。 */
function inWindow(day: string | null, weekStart: string, weekEnd: string): boolean {
  return day !== null && day >= weekStart && day <= weekEnd;
}

async function assembleWeek(context: ButlerToolContext, weekStart: string): Promise<unknown> {
  const now = context.now();
  const windowEnd = addLocalDays(
    new Date(
      Number(weekStart.slice(0, 4)),
      Number(weekStart.slice(5, 7)) - 1,
      Number(weekStart.slice(8, 10))
    ),
    6
  );
  const workspaces = await context.workspace.listWorkspaces();
  const sections: WeeklyWorkspaceSection[] = [];
  const references: Array<{
    id: string;
    kind: string;
    title: string;
    detail?: string;
    workspaceId?: string;
    path?: string;
  }> = [];

  for (const workspace of workspaces) {
    const facts: WeeklyFact[] = [];
    const snapshot = await context.workspace.getWorkspaceSnapshot(workspace.id);
    for (const task of snapshot.tasks) {
      const dueDay = dayOf(task.due);
      const updatedDay = dayOf(task.updatedAt);
      const doneInWindow = task.status === 'done' && inWindow(updatedDay, weekStart, windowEnd);
      const dueInWindow = inWindow(dueDay, weekStart, windowEnd);
      if (!doneInWindow && !dueInWindow) continue;
      const statusLabel =
        task.status === 'done' ? '已完成' : task.status === 'in-progress' ? '进行中' : task.status;
      facts.push({
        source: { recordId: task.id, kind: 'task' },
        summary: `任务「${task.title}」（${statusLabel}${task.due ? `，到期 ${task.due}` : ''}）`
      });
      references.push({
        id: task.id,
        kind: 'task',
        title: task.title,
        workspaceId: workspace.id
      });
    }
    for (const note of snapshot.notes) {
      if (!inWindow(dayOf(note.updated), weekStart, windowEnd)) continue;
      facts.push({
        source: {
          recordId: note.id,
          kind: 'note',
          ...(note.path ? { path: note.path } : {})
        },
        summary: `笔记「${note.title}」有更新`
      });
      references.push({
        id: note.id,
        kind: 'note',
        title: note.title,
        workspaceId: workspace.id,
        ...(note.path ? { path: note.path } : {})
      });
    }
    for (const memory of snapshot.memory) {
      if (!inWindow(dayOf(memory.createdAt), weekStart, windowEnd)) continue;
      facts.push({
        source: { recordId: memory.id, kind: 'memory' },
        summary: `记忆：${memory.text}`
      });
      references.push({
        id: memory.id,
        kind: 'memory',
        title: memory.text,
        workspaceId: workspace.id
      });
    }
    if (context.commitments) {
      const commitments = await context.commitments.list();
      for (const commitment of commitments) {
        if (commitment.workspaceId !== workspace.id) continue;
        const dueDay = dayOf(commitment.due);
        const createdDay = dayOf(commitment.createdAt);
        const resolvedDay = dayOf(commitment.resolvedAt);
        const inWeek =
          inWindow(dueDay, weekStart, windowEnd) ||
          inWindow(createdDay, weekStart, windowEnd) ||
          inWindow(resolvedDay, weekStart, windowEnd);
        if (!inWeek) continue;
        const stateLabel =
          commitment.status === 'open'
            ? '待兑现'
            : commitment.status === 'done'
              ? '已做到'
              : '已放下';
        facts.push({
          source: { recordId: commitment.id, kind: 'commitment' },
          summary: `承诺「${commitment.text}」（到期 ${commitment.due}，${stateLabel}）`
        });
        references.push({
          id: commitment.id,
          kind: 'commitment',
          title: commitment.text,
          detail: `到期 ${commitment.due}`,
          workspaceId: workspace.id
        });
      }
    }
    sections.push({
      workspaceId: workspace.id,
      name: workspace.name,
      kind: workspace.kind,
      hasRecords: facts.length > 0,
      ...(facts.length === 0 ? { noRecordNotice: `${workspace.name}本周没有记录。` } : {}),
      facts
    });
  }

  // 没有归属项目的承诺也要可见：跨项目复盘不丢事实（标 workspaceId 缺省）。
  const unassigned: WeeklyFact[] = [];
  if (context.commitments) {
    const commitments = await context.commitments.list();
    for (const commitment of commitments) {
      if (commitment.workspaceId) continue;
      const dueDay = dayOf(commitment.due);
      const createdDay = dayOf(commitment.createdAt);
      const resolvedDay = dayOf(commitment.resolvedAt);
      const inWeek =
        inWindow(dueDay, weekStart, windowEnd) ||
        inWindow(createdDay, weekStart, windowEnd) ||
        inWindow(resolvedDay, weekStart, windowEnd);
      if (!inWeek) continue;
      unassigned.push({
        source: { recordId: commitment.id, kind: 'commitment' },
        summary: `承诺「${commitment.text}」（到期 ${commitment.due}，未归属项目）`
      });
      references.push({
        id: commitment.id,
        kind: 'commitment',
        title: commitment.text,
        detail: `到期 ${commitment.due}`
      });
    }
  }

  return {
    weekStart,
    weekEnd: windowEnd,
    generatedAt: formatLocalDate(now),
    workspaces: sections,
    ...(unassigned.length > 0
      ? {
          unassignedCommitments: {
            hasRecords: true,
            facts: unassigned
          }
        }
      : {}),
    references
  };
}
