import type { SendMessageInput } from '../../shared/workspace';
import type { ButlerContext } from './context';

export type TemplateReason =
  | 'no-key'
  | 'model-error'
  | 'tool-error'
  | 'tool-limit'
  | 'empty-message';

export interface TemplateOptions {
  reason: TemplateReason;
  toolName?: string;
  /** Only changes the model-error header when the call was retried. */
  retried?: boolean;
}

const MAX_LISTED_TASKS = 3;

/**
 * Deterministic Chinese reply used when no model is available or a model/tool
 * failure would otherwise escape to the UI. It only uses local context.
 */
export function buildTemplateReply(
  context: ButlerContext,
  input: SendMessageInput,
  options: TemplateOptions
): string {
  const lines: string[] = [headerFor(options)];

  if (input.message.trim()) {
    lines.push(`你刚才说：「${truncate(input.message.trim(), 60)}」。`);
  }

  if (context.workspace) {
    const goal = context.workspace.goal ? `，目标：${context.workspace.goal}` : '';
    lines.push(`当前工作区：${context.workspace.name}${goal}。`);
  } else if (context.workspaces.length > 0) {
    const names = context.workspaces
      .slice(0, 4)
      .map((workspace) => workspace.name)
      .join('、');
    lines.push(`我看到你有 ${context.workspaces.length} 个工作区：${names}。`);
  }

  const activeTasks = context.tasks.filter(
    (task) => task.status === 'pending' || task.status === 'in-progress'
  );
  if (activeTasks.length > 0) {
    lines.push(`今天还有 ${activeTasks.length} 项未完成：`);
    for (const task of activeTasks.slice(0, MAX_LISTED_TASKS)) {
      lines.push(`- ${task.title}（${task.subject}，${task.durationMin} 分钟）`);
    }
    const first = activeTasks[0];
    if (first) {
      lines.push(`建议先做「${first.title}」，预计 ${first.durationMin} 分钟。`);
    }
  } else if (context.tasks.length > 0) {
    lines.push('今天的任务都完成了，可以花几分钟做一次复盘。');
  } else {
    lines.push('我还没有看到今天的任务记录。可以告诉我你今天想推进什么，或者先建一个任务。');
  }

  if (context.memory.length > 0) {
    const firstMemory = context.memory[0];
    if (firstMemory) {
      lines.push(`我记得：${firstMemory.text}。`);
    }
  }

  if (context.contextError) {
    lines.push('（这次读取本地记录不完整，以上内容可能不是最新状态。）');
  }

  lines.push(...closingFor(options));
  return lines.join('\n');
}

function headerFor(options: TemplateOptions): string {
  switch (options.reason) {
    case 'no-key':
      return '（还没有配置模型 API Key，我先根据本地记录给你一个简要回复。）';
    case 'model-error':
      return options.retried
        ? '（模型连接失败，已自动重试 1 次；我先根据本地记录给你一个简要回复。）'
        : '（模型暂时不可用，我先根据本地记录给你一个简要回复。）';
    case 'tool-error':
      return `（我尝试使用「${options.toolName ?? '工具'}」但没有成功，这次没有完成写入或修改。）`;
    case 'tool-limit':
      return '（我连续调用了多次工具，先停在这里，避免做出未经确认的修改。）';
    case 'empty-message':
      return '（我没有收到具体内容。）';
  }
}

function closingFor(options: TemplateOptions): string[] {
  switch (options.reason) {
    case 'no-key':
      return ['在设置里填入模型 API Key 后，我就能当老师讲解、帮你规划、记录和督促。'];
    case 'model-error':
      return ['模型恢复后我会继续；你也可以先在计划和记录里手动更新。'];
    case 'tool-error':
      return ['如果这项数据很重要，请在界面里手动确认或让我再试一次。'];
    case 'tool-limit':
      return ['需要我继续操作时，请再明确告诉我一次。'];
    case 'empty-message':
      return ['你想聊点什么？可以让我讲题、排今天的任务、记一条笔记，或者提醒你该做什么。'];
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}
