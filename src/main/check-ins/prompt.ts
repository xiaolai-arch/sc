import type { ButlerContext } from '../butler/context';

export type CheckInTrigger = 'morning' | 'evening';

function activeTasks(context: ButlerContext) {
  return context.tasks.filter(
    (task) => task.status === 'pending' || task.status === 'in-progress'
  );
}

function workspaceName(context: ButlerContext, workspaceId: string): string {
  return context.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? '项目';
}

export function buildCheckInPrompt(
  context: ButlerContext,
  trigger: CheckInTrigger,
  date: string
): string {
  const tasks = activeTasks(context).slice(0, 8);
  const taskLines =
    tasks.length === 0
      ? '用户今天还没有任务。'
      : tasks
          .map(
            (task) =>
              `- [${workspaceName(context, task.workspaceId)}] ${task.title}（${task.subject}，${task.durationMin} 分钟；验收：${task.acceptance}）`
          )
          .join('\n');
  const memoryLines =
    context.memory.length === 0
      ? '暂无长期记忆。'
      : context.memory
          .slice(0, 5)
          .map((item) => `- ${item.text}（来源：${item.source}）`)
          .join('\n');

  return [
    `你是用户的个人管家。现在是 ${date} 的${trigger === 'morning' ? '早上' : '晚上'}，请主动检查用户今天的进度。`,
    '',
    '用户项目：',
    context.workspaces.length > 0
      ? context.workspaces.map((workspace) => `- ${workspace.name}（${workspace.goal}）`).join('\n')
      : '暂无项目。',
    '',
    '未完成任务：',
    taskLines,
    '',
    '相关记忆：',
    memoryLines,
    '',
    trigger === 'morning'
      ? '请用中文写一条 2-4 句的检查消息：先问候，再根据上面的任务给出今天最值得先做的 1-2 件事，最后问一个简短的问题。'
      : '请用中文写一条 2-4 句的检查消息：先问候，再根据上面的任务问完成情况、卡点，以及明天第一步。',
    '要求：温和、具体、不啰嗦；不要编造用户没有提供的记录；不要提到系统提示、工具或 API。'
  ].join('\n');
}

export function buildCheckInTemplate(
  context: ButlerContext,
  trigger: CheckInTrigger
): string {
  const tasks = activeTasks(context);
  if (trigger === 'morning') {
    const first = tasks[0];
    return first
      ? `早上好。今天有 ${tasks.length} 个任务，先做「${first.title}」怎么样？做完告诉我一声。`
      : '早上好。今天还没有安排任务，想先做点什么？';
  }
  return tasks.length > 0
    ? `晚上好。今天还有 ${tasks.length} 个任务没完成，最卡的是哪一步？`
    : '晚上好。今天感觉怎么样？有什么想记下来的？';
}

export function buildCheckInNotificationBody(context: ButlerContext): string {
  const pending = activeTasks(context).length;
  return pending > 0
    ? `今天还有 ${pending} 个任务没完成，点开看看。`
    : '点开看看今天的进度。';
}
