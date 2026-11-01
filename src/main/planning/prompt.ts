import type { MemoryItem, Workspace, WorkspaceNote } from '../../shared/workspace';

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
    `今日可用时间：约 ${input.availableMinutes} 分钟`,
    `工作区：${input.workspace.name}（${input.workspace.kind}）`
  ];

  if (input.workspace.goal.trim()) {
    lines.push(`工作区目标：${input.workspace.goal.trim()}`);
  }
  if (input.workspace.description.trim()) {
    lines.push(`工作区说明：${input.workspace.description.trim()}`);
  }

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
