import { randomUUID } from 'node:crypto';
import type { AppSettings } from '../../shared/types';
import type { WorkspaceService } from '../../shared/workspace';
import type { ModelClient } from '../agent/model-client';
import { gatherContext, type ButlerContext } from '../butler/context';
import type { Conversation } from '../../shared/conversations';
import type { ConversationStore } from '../conversations/conversation-store';
import type { SchedulerNotification } from '../scheduler/scheduler';
import {
  buildCheckInNotificationBody,
  buildCheckInPrompt,
  buildCheckInTemplate,
  type CheckInTrigger
} from './prompt';

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
  now?: () => Date;
}

const CHECK_IN_TITLE_PREFIX = '今天的检查';
const WEEKLY_TITLE_PREFIX = '每周复盘';

function checkInTitle(trigger: CheckInTrigger, date: string): string {
  const prefix = trigger === 'weekly' ? WEEKLY_TITLE_PREFIX : CHECK_IN_TITLE_PREFIX;
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
    knowledge: context.knowledge.filter(
      (topic) => topic.workspaceId === undefined || !off.has(topic.workspaceId)
    ),
    contextError: context.contextError
  };
}

export class ProactiveCheckInService {
  private readonly conversationStore: ConversationStore;
  private readonly workspaceService: WorkspaceService | null;
  private readonly modelClient: ModelClient | null;
  private readonly getSettings: () => Promise<AppSettings>;
  private readonly getDailyTokensUsed: (() => Promise<number>) | undefined;
  private readonly now: () => Date;

  constructor(options: ProactiveCheckInOptions) {
    this.conversationStore = options.conversationStore;
    this.workspaceService = options.workspaceService;
    this.modelClient = options.modelClient;
    this.getSettings = options.getSettings;
    this.getDailyTokensUsed = options.getDailyTokensUsed;
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

    const conversation = await this.findOrCreateConversation(date, trigger);
    const checkIns = conversation.messages.filter((message) => message.trigger);
    if (checkIns.some((message) => message.trigger === trigger)) return null;
    if (checkIns.length >= settings.budget.proactiveSessionsPerDay) return null;

    const rawContext = await gatherContext(this.workspaceService, { message: '' }, this.now());
    const context = excludeCheckInOff(rawContext);
    if (rawContext.workspaces.length > 0 && context.workspaces.length === 0) return null;
    const text = await this.generate(trigger, date, context);
    const createdAt = this.now().toISOString();
    await this.conversationStore.appendMessage(conversation.id, {
      id: randomUUID(),
      role: 'assistant',
      text,
      createdAt,
      source: 'check-in',
      trigger
    });

    return {
      key: `${date}:check-in:${trigger}`,
      kind:
        trigger === 'morning'
          ? 'morning-plan'
          : trigger === 'evening'
            ? 'evening-review'
            : 'weekly-review',
      date,
      scheduledTime:
        trigger === 'morning'
          ? settings.notifications.morning
          : trigger === 'evening'
            ? settings.notifications.evening
            : settings.notifications.weekly,
      title:
        trigger === 'weekly' ? '阿咲想和你回顾这一周' : '阿咲想和你聊聊今天的进度',
      body: buildCheckInNotificationBody(context, trigger),
      conversationId: conversation.id
    };
  }

  private async findOrCreateConversation(
    date: string,
    trigger: CheckInTrigger
  ): Promise<Conversation> {
    const title = checkInTitle(trigger, date);
    const summaries = await this.conversationStore.list();
    const existing = summaries.find(
      (summary) => summary.kind === 'check-in' && summary.title === title
    );
    if (existing) {
      const conversation = await this.conversationStore.get(existing.id);
      if (conversation) return conversation;
    }
    return this.conversationStore.create({ kind: 'check-in', title });
  }

  private async generate(
    trigger: CheckInTrigger,
    date: string,
    context: Awaited<ReturnType<typeof gatherContext>>
  ): Promise<string> {
    const template = buildCheckInTemplate(context, trigger);
    if (!this.modelClient) return template;
    try {
      const response = await this.modelClient.complete({
        messages: [
          {
            role: 'system',
            content: buildCheckInPrompt(context, trigger, date)
          }
        ]
      });
      return response.text.trim() || template;
    } catch {
      return template;
    }
  }
}
