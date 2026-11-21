import { daysUntilTarget } from '../../shared/workspace';
import type {
  MemoryItem,
  Workspace,
  WorkspaceKind,
  WorkspaceNote
} from '../../shared/workspace';

const MAX_PROMPT_NOTES = 8;
const MAX_PROMPT_MEMORY = 8;
const MAX_NOTE_EXCERPT = 180;
const MAX_MEMORY_LENGTH = 140;

export interface WorkspacePlanPromptInput {
  workspace: Workspace;
  notes: WorkspaceNote[];
  memory: MemoryItem[];
  date: string;
  availableMinutes: number;
  /** Where the number came from, so the model can mention it honestly. */
  availableMinutesSource?: 'input' | 'workspace' | 'default';
}

export interface WorkspacePlanPrompt {
  system: string;
  user: string;
}

export const WORKSPACE_PLAN_SYSTEM_PROMPT = `你是 阿咲 的规划助手。你要根据工作区目标、最近记录和今天的可用时间，为用户安排今天可执行的任务。
规则：
- 只输出一个 JSON 对象，不要 Markdown、解释或代码围栏。
- 输出 1-5 个任务，按优先级排序。
- 每个任务必须有 title、subject、durationMin、acceptance 四个字段。
- durationMin 是 5-600 之间的整数分钟；所有任务总时长应接近今天的可用时间。
- acceptance 是可验证的完成标准，例如“完成 10 道题并订正错题”。
- 使用中文，任务具体、可执行；不要编造用户记录中没有的信息。
格式：{"tasks":[{"title":"任务标题","subject":"科目或领域","durationMin":30,"acceptance":"完成标准"}]}`;

/** Builds the JSON-only planning request for the injected model client. */
export function buildWorkspacePlanPrompt(input: WorkspacePlanPromptInput): WorkspacePlanPrompt {
  const lines: string[] = [
    `今天：${input.date}`,
    `今日可用时间：约 ${input.availableMinutes} 分钟（${availableSourceLabel(
      input.availableMinutesSource
    )}）`,
    `工作区：${input.workspace.name}（${input.workspace.kind}）`
  ];

  if (input.workspace.goal.trim()) {
    lines.push(`工作区目标：${input.workspace.goal.trim()}`);
  }
  if (input.workspace.description.trim()) {
    lines.push(`工作区说明：${input.workspace.description.trim()}`);
  }
  // A target date turns planning into countdown-driven planning. Absent or
  // unreadable, nothing is added, so the prompt stays byte-identical.
  const countdown = targetCountdownLines(
    input.workspace.targetDate,
    input.date,
    input.workspace.kind
  );
  if (countdown !== null) lines.push(...countdown);

  const notes = input.notes.slice(0, MAX_PROMPT_NOTES);
  if (notes.length > 0) {
    lines.push('最近记录：');
    for (const note of notes) {
      const excerpt = clip(note.summary.trim() || note.body.trim(), MAX_NOTE_EXCERPT);
      const suffix = excerpt ? `：${excerpt}` : '';
      lines.push(`- ${note.title}${note.subject ? `（${note.subject}）` : ''}${suffix}`);
    }
  } else {
    lines.push('最近记录：暂无。');
  }

  const memory = input.memory.slice(0, MAX_PROMPT_MEMORY);
  if (memory.length > 0) {
    lines.push('相关记忆：');
    for (const item of memory) {
      lines.push(`- ${clip(item.text.trim(), MAX_MEMORY_LENGTH)}（来源：${item.source}）`);
    }
  } else {
    lines.push('相关记忆：暂无。');
  }

  lines.push(
    `请结合以上信息，为 ${input.date} 安排 1-5 个任务，总时长接近 ${input.availableMinutes} 分钟。只输出 JSON。`
  );

  return { system: WORKSPACE_PLAN_SYSTEM_PROMPT, user: lines.join('\n') };
}

function clip(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

/**
 * The countdown section of the planning prompt: the deadline, how many whole
 * days remain on the plan's own date, and how to stage the work towards it.
 * The staging instruction follows the workspace kind, so an exam gets review
 * rounds while a course, a project or a life goal gets its own shape.
 * Returns null when there is no usable target date, so the prompt is unchanged
 * for projects without one.
 */
export function targetCountdownLines(
  targetDate: string | undefined,
  date: string,
  kind?: WorkspaceKind
): string[] | null {
  if (!targetDate) return null;
  const days = daysUntilTarget(targetDate, date);
  if (days === null) return null;
  if (days < 0) {
    return [
      `目标日期：${targetDate}（已过去 ${-days} 天）`,
      passedTargetInstruction(kind)
    ];
  }
  return [
    `目标日期：${targetDate}（距离 ${date} 还有 ${days} 天）`,
    stagingInstruction(kind, days)
  ];
}

/** Missing or unrecognised kinds plan like an exam, the original wording. */
function normaliseKind(kind: WorkspaceKind | undefined): WorkspaceKind {
  return kind === 'study' || kind === 'project' || kind === 'life' ? kind : 'exam';
}

/** How to spread the remaining days when the deadline is still ahead. */
function stagingInstruction(kind: WorkspaceKind | undefined, days: number): string {
  switch (normaliseKind(kind)) {
    case 'study':
      return `请把计划组织成学习阶段（阶段：入门 → 进阶 → 巩固），并按剩余的 ${days} 天为每一阶段分配时间；不要用考试轮次的说法。`;
    case 'project':
    case 'life':
      return `请把计划组织成里程碑式：先列出可验收的里程碑（每步做完能看到什么成果），按剩余的 ${days} 天排先后，而不是按考试轮次。`;
    default:
      return `请把计划组织成复习轮次（轮次：基础 → 强化 → 冲刺），并按剩余的 ${days} 天为每一轮分配时间。`;
  }
}

/** How to compress the plan once the deadline has already passed. */
function passedTargetInstruction(kind: WorkspaceKind | undefined): string {
  if (normaliseKind(kind) === 'exam') {
    return '请按复习轮次重新压缩安排（轮次：基础 → 强化 → 冲刺），优先补齐薄弱环节。';
  }
  return '请重新压缩剩余安排：收尾未完成的部分，优先里程碑。';
}

function availableSourceLabel(source: 'input' | 'workspace' | 'default' | undefined): string {
  if (source === 'input') return '用户本次说明';
  if (source === 'workspace') return '来自项目设置的每天可用时间';
  return '未设置时使用的默认值';
}
