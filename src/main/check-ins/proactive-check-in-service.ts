import { randomUUID } from 'node:crypto';
import { formatLocalDate, parseLocalDate } from '../../shared/date';
import type { PracticeService } from '../../shared/practice';
import type { AppSettings } from '../../shared/types';
import type { WorkspaceService } from '../../shared/workspace';
import type { ModelClient } from '../agent/model-client';
import { gatherContext, type ButlerContext } from '../butler/context';
import type { Conversation } from '../../shared/conversations';
import type { ConversationStore } from '../conversations/conversation-store';
import type { SchedulerNotification } from '../scheduler/scheduler';
import {
  BEHIND_SCHEDULE_TITLE,
  behindScheduleSummary,
  isTaskForDate
} from '../scheduler/behind-schedule';
import {
  buildCheckInNotificationBody,
  buildCheckInPrompt,
  buildCheckInTemplate,
  weeklyHonestLines,
  type CheckInTrigger,
  type WeeklyHonestLike,
  type WeeklyOverviewLike
} from './prompt';
import type { WeeklyHonest } from './weekly-honest';

export interface ProactiveCheckInOptions {
  conversationStore: ConversationStore;
  workspaceService: WorkspaceService | null;
  modelClient: ModelClient | null;
  getSettings: () => Promise<AppSettings>;
  /**
   * Tokens already recorded for the current local day. Used to honor the
   * "每日 token 上限" budget before spending another proactive model call.
   */
  getDailyTokensUsed?: () => Promise<number>;
  /**
   * Read-only source for the due-mistake digest on the morning check-in. When
   * absent or failing, the message stays exactly as it was without it.
   */
  practiceService?: PracticeService | null;
  /**
   * Read-only weekly numbers for the Sunday review. Absent, null or failing
   * leaves the weekly message byte-identical to the version without stats.
   */
  getWeeklyOverview?: (today: Date) => Promise<WeeklyOverviewLike | null>;
  /**
   * Read-only honest receipt for the Sunday review: the confidence mismatch
   * line and one concrete next subject. Absent, null or failing leaves the
   * weekly message byte-identical to the version without it.
   */
  getWeeklyHonest?: (today: Date) => Promise<WeeklyHonest | null>;
  now?: () => Date;
}

const CHECK_IN_TITLE_PREFIX = '今天的检查';
const WEEKLY_TITLE_PREFIX = '每周复盘';
const BEHIND_TITLE_PREFIX = '落后提醒';

/** One deterministic line appended to the morning message; never model-written. */
function dueMistakeLine(count: number): string {
  return `今天有 ${count} 道到期错题，抽 10 分钟过一遍。`;
}

function checkInTitle(trigger: CheckInTrigger, date: string): string {
  const prefix =
    trigger === 'weekly'
      ? WEEKLY_TITLE_PREFIX
      : trigger === 'behind'
        ? BEHIND_TITLE_PREFIX
        : CHECK_IN_TITLE_PREFIX;
  return `${prefix} · ${date.slice(5)}`;
}

/** Drops projects the user excluded from check-ins, including their tasks/memory. */
function excludeCheckInOff(context: ButlerContext): ButlerContext {
  const off = new Set(
    context.workspaces
      .filter((workspace) => workspace.checkIn === 'off')
      .map((workspace) => workspace.id)
  );
  if (off.size === 0) return context;

  const workspace =
    context.workspace && !off.has(context.workspace.id) ? context.workspace : undefined;
  const focusTask =
    context.focusTask && !off.has(context.focusTask.workspaceId)
      ? context.focusTask
      : undefined;

  return {
    now: context.now,
    workspaces: context.workspaces.filter((entry) => !off.has(entry.id)),
    ...(workspace ? { workspace, workspaceId: workspace.id } : {}),
    ...(focusTask ? { focusTask } : {}),
    tasks: context.tasks.filter((task) => !off.has(task.workspaceId)),
    memory: context.memory.filter((item) => !off.has(item.workspaceId)),
    // Profile facts are vault-wide, not tied to a project; they stay.
    profile: context.profile,
    knowledge: context.knowledge.filter(
      (topic) => topic.workspaceId === undefined || !off.has(topic.workspaceId)
    ),
    contextError: context.contextError
  };
}

/** True when today's plan exists and fewer than half of its tasks are done. */
function isBehindSchedule(context: ButlerContext, date: string): boolean {
  const tasks = context.tasks.filter((task) => isTaskForDate(task, date));
  return behindScheduleSummary(tasks) !== null;
}

export class ProactiveCheckInService {
  private readonly conversationStore: ConversationStore;
  private readonly workspaceService: WorkspaceService | null;
  private readonly modelClient: ModelClient | null;
  private readonly getSettings: () => Promise<AppSettings>;
  private readonly getDailyTokensUsed: (() => Promise<number>) | undefined;
  private readonly practiceService: PracticeService | null;
  private readonly getWeeklyOverview:
    | ((today: Date) => Promise<WeeklyOverviewLike | null>)
    | undefined;
  private readonly getWeeklyHonest:
    | ((today: Date) => Promise<WeeklyHonest | null>)
    | undefined;
  private readonly now: () => Date;

  constructor(options: ProactiveCheckInOptions) {
    this.conversationStore = options.conversationStore;
    this.workspaceService = options.workspaceService;
    this.modelClient = options.modelClient;
    this.getSettings = options.getSettings;
    this.getDailyTokensUsed = options.getDailyTokensUsed;
    this.practiceService = options.practiceService ?? null;
    this.getWeeklyOverview = options.getWeeklyOverview;
    this.getWeeklyHonest = options.getWeeklyHonest;
    this.now = options.now ?? (() => new Date());
  }

  async check(
    trigger: CheckInTrigger,
    date: string
  ): Promise<SchedulerNotification | null> {
    const settings = await this.getSettings();
    if (!settings.notifications.enabled) return null;
    if (settings.notifications.snoozedUntil === date) return null;

    // The limit includes manual usage, matching the global daily budget. A
    // failed usage read must not block the check; zero disables proactive calls.
    if (this.getDailyTokensUsed) {
      const used = await this.getDailyTokensUsed().catch(() => 0);
      if (used >= settings.budget.dailyTokens) return null;
    }

    const existing = await this.findConversation(date, trigger);
    if (existing?.messages.some((message) => message.trigger === trigger)) return null;
    const checkInsToday = await this.countCheckInsForDate(date);
    if (checkInsToday >= settings.budget.proactiveSessionsPerDay) return null;

    const rawContext = await gatherContext(this.workspaceService, { message: '' }, this.now());
    const context = excludeCheckInOff(rawContext);
    if (rawContext.workspaces.length > 0 && context.workspaces.length === 0) return null;
    // 落后提醒 is silent unless today's plan exists and is more than half
    // undone. Checked before a conversation is created, so an on-track day
    // leaves no trace at all.
    if (trigger === 'behind' && !isBehindSchedule(context, date)) return null;
    // Only create the conversation once the check is certain to happen, so a
    // skipped check does not leave an empty "今天的检查" behind.
    const conversation =
      existing ??
      (await this.conversationStore.create({
        kind: 'check-in',
        title: checkInTitle(trigger, date)
      }));
    // Weekly numbers are read once and shared by the model prompt and the
    // deterministic template, so both quote the same figures.
    const weeklyStats = trigger === 'weekly' ? await this.weeklyStats(date) : null;
    // The honest receipt is read next to the numbers, keyed to the same date.
    const weeklyHonest = trigger === 'weekly' ? await this.weeklyHonestFor(date) : null;
    const text = await this.generate(trigger, date, context, weeklyStats, weeklyHonest);
    // The due-mistake digest is a deterministic line on the morning message
    // only; it is computed once here so text and the surfaced body agree.
    const digest = trigger === 'morning' ? await this.dueMistakeDigest(context, date) : '';
    const createdAt = this.now().toISOString();
    await this.conversationStore.appendMessage(conversation.id, {
      id: randomUUID(),
      role: 'assistant',
      text: digest === '' ? text : `${text}\n${digest}`,
      createdAt,
      source: 'check-in',
      trigger
    });

    const behind = trigger === 'behind';
    const body = buildCheckInNotificationBody(context, trigger, date);
    return {
      key: `${date}:check-in:${trigger}`,
      kind: behind
        ? 'behind-schedule'
        : trigger === 'morning'
          ? 'morning-plan'
          : trigger === 'evening'
            ? 'evening-review'
            : 'weekly-review',
      date,
      scheduledTime: behind
        ? settings.notifications.behindSchedule
        : trigger === 'morning'
          ? settings.notifications.morning
          : trigger === 'evening'
            ? settings.notifications.evening
            : settings.notifications.weekly,
      title: behind
        ? BEHIND_SCHEDULE_TITLE
        : trigger === 'weekly'
          ? '阿咲想和你回顾这一周'
          : '阿咲想和你聊聊今天的进度',
      // Only the morning message carries a deterministic digest line; the
      // behind-schedule body is already the deterministic text itself.
      body: digest === '' ? body : `${body}\n${digest}`,
      conversationId: conversation.id
    };
  }

  /**
   * Counts check-ins across every check-in conversation for the date. Morning,
   * evening and weekly reviews use separate conversations, so counting one
   * conversation would let the weekly check bypass the daily cap.
   */
  private async countCheckInsForDate(date: string): Promise<number> {
    const summaries = await this.conversationStore.list();
    const ids = summaries
      .filter((summary) => summary.kind === 'check-in')
      .map((summary) => summary.id);
    let count = 0;
    for (const id of ids) {
      const conversation = await this.conversationStore.get(id);
      if (!conversation) continue;
      count += conversation.messages.filter(
        (message) =>
          message.trigger && formatLocalDate(new Date(message.createdAt)) === date
      ).length;
    }
    return count;
  }

  private async findConversation(
    date: string,
    trigger: CheckInTrigger
  ): Promise<Conversation | null> {
    const title = checkInTitle(trigger, date);
    const summaries = await this.conversationStore.list();
    const existing = summaries.find(
      (summary) => summary.kind === 'check-in' && summary.title === title
    );
    if (!existing) return null;
    return this.conversationStore.get(existing.id);
  }

  private async generate(
    trigger: CheckInTrigger,
    date: string,
    context: Awaited<ReturnType<typeof gatherContext>>,
    weeklyStats: WeeklyOverviewLike | null = null,
    weeklyHonest: WeeklyHonest | null = null
  ): Promise<string> {
    const template = buildCheckInTemplate(
      context,
      trigger,
      date,
      weeklyStats,
      weeklyHonest
    );
    if (!this.modelClient) return template;
    try {
      const composed = await this.composeWithModel(
        trigger,
        date,
        context,
        template,
        weeklyStats,
        weeklyHonest
      );
      // A model-written weekly review still ends with the deterministic honest
      // lines; the template path already carries them, so only append when the
      // model actually replaced it. This keeps the two facts out of the model's
      // hands while avoiding a duplicate paragraph on the fallback path.
      if (trigger === 'weekly' && composed !== template) {
        const lines = weeklyHonestLines(weeklyHonest);
        return lines.length === 0 ? composed : `${composed}\n${lines.join('\n')}`;
      }
      return composed;
    } catch {
      return template;
    }
  }

  private async composeWithModel(
    trigger: CheckInTrigger,
    date: string,
    context: Awaited<ReturnType<typeof gatherContext>>,
    template: string,
    weeklyStats: WeeklyOverviewLike | null = null,
    weeklyHonest: WeeklyHonestLike | null = null
  ): Promise<string> {
    const response = await this.modelClient!.complete({
      messages: [
        {
          role: 'system',
          content: buildCheckInPrompt(context, trigger, date, weeklyStats, weeklyHonest)
        }
      ]
    });
    return response.text.trim() || template;
  }

  /**
   * The week's numbers for the Sunday review, keyed to the check-in's own date
   * rather than the wall clock so a late/early tick still reports the right
   * week. Any provider failure yields null and the check-in proceeds unchanged.
   */
  private async weeklyStats(date: string): Promise<WeeklyOverviewLike | null> {
    const provider = this.getWeeklyOverview;
    if (!provider) return null;
    try {
      return await provider(parseLocalDate(date));
    } catch {
      return null;
    }
  }

  /**
   * The calibration and next-step facts for the Sunday review, keyed to the
   * check-in's own date like `weeklyStats`. Any provider failure yields null
   * and the check-in proceeds with its previous message.
   */
  private async weeklyHonestFor(date: string): Promise<WeeklyHonest | null> {
    const provider = this.getWeeklyHonest;
    if (!provider) return null;
    try {
      return await provider(parseLocalDate(date));
    } catch {
      return null;
    }
  }

  /**
   * `今天有 N 道到期错题，抽 10 分钟过一遍。` for active mistakes due by
   * `date` across the check-in projects; '' when zero or unreadable, so the
   * message stays byte-identical without mistakes.
   */
  private async dueMistakeDigest(
    context: Awaited<ReturnType<typeof gatherContext>>,
    date: string
  ): Promise<string> {
    const practice = this.practiceService;
    if (practice === null) return '';
    const workspaceIds = context.workspaces.map((workspace) => workspace.id);
    if (workspaceIds.length === 0) return '';
    try {
      const due = await Promise.all(
        workspaceIds.map((id) => practice.getDue(id, date))
      );
      const count = due.reduce((sum, mistakes) => sum + mistakes.length, 0);
      return count > 0 ? dueMistakeLine(count) : '';
    } catch {
      return '';
    }
  }
}
