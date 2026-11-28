import { randomUUID } from 'node:crypto';
import { formatLocalDate, isMutedOn, parseLocalDate } from '../../shared/date';
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
  backupAgeLine,
  backupFailureLines,
  buildCheckInNotificationBody,
  buildCheckInPrompt,
  buildCheckInTemplate,
  activeTasks,
  commitmentCheckInLine,
  freshStartCheckInLine,
  morningRecoveryLine,
  pendingPhaseAsk,
  phaseAcceptanceQuestion,
  resumeCheckInLine,
  tomorrowCheckInLine,
  weekAvailabilityQuestion,
  weeklyHonestLines,
  weeklyScopeNoteFor,
  type BackupStatusLike,
  type CheckInTrigger,
  type CommitmentLike,
  type PendingPhaseAsk,
  type ResumeFacts,
  type ReviewRecoveryLike,
  type TomorrowBridgeLike,
  type WeeklyHonestLike,
  type WeeklyOverviewLike
} from './prompt';
import type { AutoBackupRunner } from '../backup-auto';
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
  /**
   * The oldest promise due yesterday, today or earlier, for the morning line.
   * Absent, null or failing leaves the morning message byte-identical.
   */
  getDueCommitment?: (today: Date) => Promise<CommitmentLike | null>;
  /**
   * The review fresh-start fact for the morning after a missed review day.
   * Read fresh on every allowed check (no cache), so backfilling yesterday's
   * review removes the line on the same day. Absent, null or failing leaves
   * the morning message byte-identical.
   */
  getReviewRecovery?: (today: Date) => Promise<ReviewRecoveryLike | null>;
  /**
   * The newest pre-today review `tomorrow`, for the morning bridge line.
   * Read live on every allowed check; absent, null or failing leaves the
   * morning message byte-identical.
   */
  getTomorrowBridge?: (today: Date) => Promise<TomorrowBridgeLike | null>;
  /**
   * The pending mute resume, when this is the first check allowed to run after
   * it. Absent or null keeps every message byte-identical.
   */
  getResume?: () => Promise<ResumeFacts | null>;
  /**
   * Consumes the pending resume once its one sentence has been generated, so
   * the sentence is appended exactly once across all later checks.
   */
  consumeResume?: () => Promise<void>;
  /**
   * The weekly auto backup. Fired in the background after the Sunday review's
   * message has landed — the message never waits for it, and a failure never
   * reaches the renderer (the runner records it for the next review instead).
   * Absent keeps the review byte-identical and runs nothing.
   */
  autoBackup?: AutoBackupRunner | null;
  /**
   * Records that the one-time scope sentence (iter34 P1) has been spoken, so
   * the next Sunday review does not repeat it. Called only after the message
   * carrying the sentence has durably landed; absent leaves settings alone.
   */
  markWeeklyScopeNoted?: () => Promise<void>;
  /**
   * Clears the pending auto-backup failure reason after the review that spoke
   * it has landed, so the three-layer copy is said exactly once.
   */
  consumeBackupError?: () => Promise<void>;
  /**
   * The first exam stage that has not had its acceptance question yet, plus
   * the workspace it belongs to (iter34 P3 ②). Read-only: absent, null or
   * failing leaves every message byte-identical.
   */
  getPendingPhaseAsk?: () => Promise<PendingPhaseAsk | null>;
  /**
   * Records `phaseAskedAt` on the workspace whose stage question just went
   * out, so that stage is asked about once. Called only after the message has
   * durably landed; absent leaves the workspace file alone (the question then
   * repeats next Sunday — the honest failure mode of an unrecorded write).
   */
  markPhaseAsked?: (workspaceId: string, date: string) => Promise<void>;
  /**
   * Fires after a check-in message has durably landed in a conversation the
   * main process created (or appended to), so the renderer's sidebar can
   * refresh without waiting for the user to touch anything (item 66 P2-6).
   * Must not throw into the check; the default wiring sends to open windows
   * and never rejects.
   */
  onConversationChanged?: (conversationId: string) => void;
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
  private readonly getDueCommitment:
    | ((today: Date) => Promise<CommitmentLike | null>)
    | undefined;
  private readonly getReviewRecovery:
    | ((today: Date) => Promise<ReviewRecoveryLike | null>)
    | undefined;
  private readonly getTomorrowBridge:
    | ((today: Date) => Promise<TomorrowBridgeLike | null>)
    | undefined;
  private readonly getResume: (() => Promise<ResumeFacts | null>) | undefined;
  private readonly consumeResume: (() => Promise<void>) | undefined;
  private readonly autoBackup: AutoBackupRunner | null;
  private readonly markWeeklyScopeNoted: (() => Promise<void>) | undefined;
  private readonly consumeBackupError: (() => Promise<void>) | undefined;
  private readonly getPendingPhaseAsk: (() => Promise<PendingPhaseAsk | null>) | undefined;
  private readonly markPhaseAsked:
    | ((workspaceId: string, date: string) => Promise<void>)
    | undefined;
  private readonly onConversationChanged: ((conversationId: string) => void) | undefined;
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
    this.getDueCommitment = options.getDueCommitment;
    this.getReviewRecovery = options.getReviewRecovery;
    this.getTomorrowBridge = options.getTomorrowBridge;
    this.getResume = options.getResume;
    this.consumeResume = options.consumeResume;
    this.autoBackup = options.autoBackup ?? null;
    this.markWeeklyScopeNoted = options.markWeeklyScopeNoted;
    this.consumeBackupError = options.consumeBackupError;
    this.getPendingPhaseAsk = options.getPendingPhaseAsk;
    this.markPhaseAsked = options.markPhaseAsked;
    this.onConversationChanged = options.onConversationChanged;
    this.now = options.now ?? (() => new Date());
  }

  async check(
    trigger: CheckInTrigger,
    date: string
  ): Promise<SchedulerNotification | null> {
    const settings = await this.getSettings();
    if (!settings.notifications.enabled) return null;
    // The stored date is the last muted day, so one click can cover a trip.
    // An empty, junk or past date mutes nothing.
    if (isMutedOn(settings.notifications.snoozedUntil, date)) return null;

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
    // Peek before composing: only a check that will actually run may speak the
    // resume sentence. A peek failure skips the sentence but leaves the flag,
    // so the next allowed check can still say it.
    const resume = this.getResume
      ? await this.getResume().catch(() => null)
      : null;
    // Only create the conversation once the check is certain to happen, so a
    // skipped check does not leave an empty "今天的检查" behind.
    const conversation =
      existing ??
      (await this.conversationStore.create({
        kind: 'check-in',
        title: checkInTitle(trigger, date)
      }));
    // The weekly numbers are read once and shared by the model prompt and the
    // deterministic template, so both quote the same figures.
    const weeklyStats = trigger === 'weekly' ? await this.weeklyStats(date) : null;
    // The one-time scope sentence (iter34 P1) rides on the first review that
    // actually quotes numbers, and is recorded only after the message lands.
    const scopeNote =
      trigger === 'weekly'
        ? weeklyScopeNoteFor(weeklyStats, settings.weeklyScopeNoted)
        : '';
    // The stage acceptance question (iter34 P3 ②) rides the Sunday review at
    // most once per stage. Peeked here, before composing; recorded only after
    // the message lands, so a stage is never marked asked without its question.
    const phaseAsk = trigger === 'weekly' ? await this.pendingPhaseAskFor() : null;
    // The honest receipt is read next to the numbers, keyed to the same date.
    const weeklyHonest = trigger === 'weekly' ? await this.weeklyHonestFor(date) : null;
    // The promise revisit belongs to the morning only; a day without one keeps
    // the prompt and template at their previous bytes.
    const commitment =
      trigger === 'morning' ? await this.dueCommitmentFor(date) : null;
    // The fresh-start fact is the morning's own datum, read live next to the
    // promise so a backfill that just landed is honored on this very check.
    const reviewRecovery =
      trigger === 'morning' ? await this.reviewRecoveryFor(date) : null;
    // The tomorrow bridge is the morning's other datum, read live the same
    // way so a review submitted overnight is handed back on this very check.
    const tomorrowBridgeFacts =
      trigger === 'morning' ? await this.tomorrowBridgeFor(date) : null;
    const text = await this.generate(
      trigger,
      date,
      context,
      weeklyStats,
      weeklyHonest,
      commitment,
      resume,
      settings.backup ?? null,
      reviewRecovery,
      tomorrowBridgeFacts,
      scopeNote,
      phaseAsk ? phaseAcceptanceQuestion(phaseAsk.phase, undefined) : ''
    );
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
    // The message landed: tell the renderer the sidebar changed. Covers both
    // a freshly created check-in conversation and an append into an existing
    // one; a listener failure must never fail the check that already wrote.
    if (this.onConversationChanged) {
      try {
        this.onConversationChanged(conversation.id);
      } catch {
        // The notification channels stay best-effort, like the open channel.
      }
    }
    // The message landed: spend the pending resume so no later check repeats
    // the sentence. A failed consume keeps the flag and would repeat it once —
    // the honest failure mode for a write that could not be recorded.
    if (resume && this.consumeResume) {
      await this.consumeResume().catch(() => undefined);
    }
    if (scopeNote !== '' && this.markWeeklyScopeNoted) {
      // The sentence landed: record it so no later review repeats it. A failed
      // write would say it once more — the honest failure mode, like resume.
      await this.markWeeklyScopeNoted().catch(() => undefined);
    }
    if (phaseAsk && this.markPhaseAsked) {
      // The question landed: record the day on its workspace so that stage is
      // asked about once. A failed write repeats it next Sunday — the honest
      // failure mode for a write that could not be recorded.
      await this.markPhaseAsked(phaseAsk.workspaceId, date).catch(() => undefined);
    }
    if (trigger === 'weekly') {
      // The failure copy landed: clear the pending reason so the next review
      // stays quiet (验收 10). Cleared before the auto backup fires, so a fresh
      // failure written by this week's run can never be cleared by this week's
      // consume.
      if (this.consumeBackupError) {
        await this.consumeBackupError().catch(() => undefined);
      }
      // The auto backup rides the Sunday review: fired after the message is
      // durably appended, deliberately not awaited (验收 8), and it reports
      // through settings, never by throwing (验收 10).
      void this.autoBackup?.runIfDue(date).catch(() => undefined);
    }

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
    weeklyHonest: WeeklyHonest | null = null,
    commitment: CommitmentLike | null = null,
    resume: ResumeFacts | null = null,
    backup: BackupStatusLike | null = null,
    reviewRecovery: ReviewRecoveryLike | null = null,
    tomorrowBridge: TomorrowBridgeLike | null = null,
    scopeNote: string = '',
    phaseAsk: string = ''
  ): Promise<string> {
    const composed = await this.composeBase(
      trigger,
      date,
      context,
      weeklyStats,
      weeklyHonest,
      commitment,
      backup,
      reviewRecovery,
      tomorrowBridge,
      scopeNote,
      phaseAsk
    );
    // The mute-resume sentence is deterministic and never handed to the model,
    // so it appears exactly once by construction: appended here, to whichever
    // path produced the text, and only while the pending flag exists.
    const resumeLine = resumeCheckInLine(resume, date);
    return resumeLine ? `${composed}\n${resumeLine}` : composed;
  }

  /** The message text without the resume tail; the pre-iter30 shape. */
  private async composeBase(
    trigger: CheckInTrigger,
    date: string,
    context: Awaited<ReturnType<typeof gatherContext>>,
    weeklyStats: WeeklyOverviewLike | null = null,
    weeklyHonest: WeeklyHonest | null = null,
    commitment: CommitmentLike | null = null,
    backup: BackupStatusLike | null = null,
    reviewRecovery: ReviewRecoveryLike | null = null,
    tomorrowBridge: TomorrowBridgeLike | null = null,
    scopeNote: string = '',
    phaseAsk: string = ''
  ): Promise<string> {
    const template = buildCheckInTemplate({
      context,
      trigger,
      date,
      stats: weeklyStats,
      honest: weeklyHonest,
      commitment,
      backup,
      reviewRecovery,
      tomorrowBridge,
      weeklyScopeNote: scopeNote,
      phaseAsk
    });
    if (!this.modelClient) return template;
    try {
      const composed = await this.composeWithModel(
        trigger,
        date,
        context,
        template,
        weeklyStats,
        weeklyHonest,
        commitment
      );
      // A model-written weekly review still ends with the deterministic honest
      // lines, then the opt-in backup age line, then the availability
      // question; the template path already carries all of them, so only
      // append when the model actually replaced it. This keeps the facts out
      // of the model's hands while avoiding a duplicate paragraph on the
      // fallback path.
      if (trigger === 'weekly' && composed !== template) {
        const availability = weekAvailabilityQuestion(context);
        // A model text that already mentions the backup keeps its own words:
        // one mention by construction, whichever path wrote it.
        const age = backupAgeLine(backup, date);
        // The failure copy is appended unconditionally when pending: the model
        // never saw it (it is code-owned), and suppressing it would lose the
        // one sentence an unsaid failure is owed.
        const failures = backupFailureLines(backup);
        const tail = [
          ...weeklyHonestLines(weeklyHonest),
          ...(age && !composed.includes('上次备份') ? [age] : []),
          ...failures,
          ...(scopeNote ? [scopeNote] : []),
          // The stage question is code-owned like the rest: the model never
          // saw it, so it is appended after the scope sentence, before the
          // availability question — the same slot the template uses.
          ...(phaseAsk ? [phaseAsk] : []),
          ...(availability ? [availability] : [])
        ];
        return tail.length === 0 ? composed : `${composed}\n${tail.join('\n')}`;
      }
      // A model-written morning reply must still carry the deterministic
      // morning tail, in the template's fixed order: the fresh-start line
      // first (the model never saw it, so it cannot have restated it), then
      // the promise question only when the model did not ask it itself, then
      // the recovery line — the first unfinished task's next-step line when
      // one is recorded (iter33 P2b②), otherwise the tomorrow bridge (also
      // code-owned). At most one line in the slot, either way. With none of
      // the three the reply keeps its previous bytes.
      const promiseLine = trigger === 'morning' ? commitmentCheckInLine(commitment, date) : '';
      const promisePending =
        promiseLine && commitment && !composed.includes(commitment.text)
          ? promiseLine
          : null;
      const freshStartLine =
        trigger === 'morning' ? freshStartCheckInLine(reviewRecovery) : '';
      const recoveryLine =
        trigger === 'morning' ? morningRecoveryLine(activeTasks(context)[0], tomorrowBridge) : '';
      const tail = [freshStartLine, promisePending, recoveryLine].filter(
        (line) => line !== null && line !== ''
      );
      if (composed !== template && tail.length > 0) {
        return `${composed}\n${tail.join('\n')}`;
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
    weeklyHonest: WeeklyHonestLike | null = null,
    commitment: CommitmentLike | null = null
  ): Promise<string> {
    const response = await this.modelClient!.complete({
      messages: [
        {
          role: 'system',
          content: buildCheckInPrompt(
            context,
            trigger,
            date,
            weeklyStats,
            weeklyHonest,
            commitment
          )
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
   * The oldest promise due by the check-in's own date, for the morning line.
   * Keyed to `date` rather than the wall clock so a late tick still asks the
   * right question. Any provider failure yields null and the message is
   * unchanged; only an open promise due yesterday or today produces a line.
   */
  private async dueCommitmentFor(date: string): Promise<CommitmentLike | null> {
    const provider = this.getDueCommitment;
    if (!provider) return null;
    try {
      return await provider(parseLocalDate(date));
    } catch {
      return null;
    }
  }

  /**
   * The fresh-start fact for the morning after a missed review day, keyed to
   * the check-in's own date like `dueCommitmentFor`. Read live on every check
   * with no cache, so a review backfilled for yesterday removes the line on
   * the same day. Any provider failure yields null and the message is
   * unchanged.
   */
  private async reviewRecoveryFor(date: string): Promise<ReviewRecoveryLike | null> {
    const provider = this.getReviewRecovery;
    if (!provider) return null;
    try {
      return await provider(parseLocalDate(date));
    } catch {
      return null;
    }
  }

  /**
   * The newest pre-today review `tomorrow` for the morning bridge line, keyed
   * to the check-in's own date like `dueCommitmentFor`. Read live on every
   * check with no cache, so a review that landed overnight is handed back the
   * same morning. Any provider failure yields null and the message is
   * unchanged.
   */
  private async tomorrowBridgeFor(date: string): Promise<TomorrowBridgeLike | null> {
    const provider = this.getTomorrowBridge;
    if (!provider) return null;
    try {
      return await provider(parseLocalDate(date));
    } catch {
      return null;
    }
  }

  /**
   * The first exam stage whose acceptance question has not gone out yet, for
   * the Sunday review. One ask per review at most: when several projects carry
   * an unasked stage, the first in the provider's order speaks and the rest
   * wait for later weeks. Any provider failure yields null and the review is
   * unchanged.
   */
  private async pendingPhaseAskFor(): Promise<PendingPhaseAsk | null> {
    const provider = this.getPendingPhaseAsk;
    if (!provider) return null;
    try {
      const pending = await provider();
      if (!pending) return null;
      // A stage with no wording (impossible today, kept total) asks nothing.
      return phaseAcceptanceQuestion(pending.phase, undefined) === '' ? null : pending;
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
