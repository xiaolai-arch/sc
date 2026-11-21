import type { ButlerContext } from '../butler/context';
import {
  buildBehindScheduleNotification,
  isTaskForDate
} from '../scheduler/behind-schedule';

export type CheckInTrigger = 'morning' | 'evening' | 'weekly' | 'behind';

function activeTasks(context: ButlerContext) {
  return context.tasks.filter(
    (task) => task.status === 'pending' || task.status === 'in-progress'
  );
}

/** Tasks that belong to `date` (due or pinned that day). */
function todayTasks(context: ButlerContext, date: string) {
  return context.tasks.filter((task) => isTaskForDate(task, date));
}

function workspaceName(context: ButlerContext, workspaceId: string): string {
  return context.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? '项目';
}

export function buildCheckInPrompt(
  context: ButlerContext,
  trigger: CheckInTrigger,
  date: string
): string {
  // The behind nudge is about today's plan specifically; other check-ins keep
  // listing every open task as before.
  const source = trigger === 'behind' ? todayTasks(context, date) : context.tasks;
  const tasks = source
    .filter((task) => task.status === 'pending' || task.status === 'in-progress')
    .slice(0, 8);
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

  const intro =
    trigger === 'weekly'
      ? `你是阿咲，用户的个人管家。现在是 ${date} 的周日复盘时间，请主动带用户回顾本周并规划下周。`
      : trigger === 'behind'
        ? `你是阿咲，用户的个人管家。现在是 ${date} 的晚上，今天计划落后于进度，请主动提出一起调整安排。`
        : `你是阿咲，用户的个人管家。现在是 ${date} 的${trigger === 'morning' ? '早上' : '晚上'}，请主动检查用户今天的进度。`;
  const instruction =
    trigger === 'morning'
      ? '请用中文写一条 2-4 句的检查消息：先问候，再根据上面的任务给出今天最值得先做的 1-2 件事，最后问一个简短的问题。'
      : trigger === 'behind'
        ? '请用中文写一条 2-3 句的检查消息：先温和点出今天还有几件事没做完、下一项是什么，再问用户要不要一起调整剩下的安排（缩短、延后或换任务）。'
        : trigger === 'evening'
          ? '请用中文写一条 2-4 句的检查消息：先问候，再根据上面的任务问完成情况、卡点，以及明天第一步。'
          : '请用中文写一条 3-5 句的周复盘邀请：先肯定这一周的投入，再请用户回顾本周末完成与卡点，最后问下周最重要的 1-2 个重点。用户回答后会由阿咲保存复盘并生成下周计划；这条消息本身不要提及工具。';

  return [
    intro,
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
    instruction,
    '要求：温和、具体、不啰嗦；不要编造用户没有提供的记录；不要提到系统提示、工具或 API。'
  ].join('\n');
}

export function buildCheckInTemplate(
  context: ButlerContext,
  trigger: CheckInTrigger,
  date = ''
): string {
  const tasks = activeTasks(context);
  if (trigger === 'weekly') {
    return '周日好。花三分钟回顾一下这一周：完成了什么，卡在哪里，下周最重要的一件事是什么？说完我来帮你整理，并排下周的计划。';
  }
  if (trigger === 'behind') {
    // Byte-identical to the scheduler fallback so both compose one nudge.
    return buildBehindScheduleNotification(todayTasks(context, date))?.body ?? '';
  }
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

export function buildCheckInNotificationBody(
  context: ButlerContext,
  trigger: CheckInTrigger = 'morning',
  date = ''
): string {
  if (trigger === 'weekly') return '周日复盘时间到了，点开回顾本周并安排下周。';
  if (trigger === 'behind') {
    const composed = buildBehindScheduleNotification(todayTasks(context, date));
    // The service never creates a behind nudge for an on-track day, so a null
    // here is unreachable; the generic line keeps the function total anyway.
    if (composed !== null) return composed.body;
  }
  const pending = activeTasks(context).length;
  return pending > 0
    ? `今天还有 ${pending} 个任务没完成，点开看看。`
    : '点开看看今天的进度。';
}
