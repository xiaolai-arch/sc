import type { ButlerContext } from '../butler/context';
import {
  formatMonthDay,
  isLocalDate,
  isLocalDateTimeSeconds,
  localDaysBetween
} from '../../shared/date';
import type { TomorrowBridgeFacts } from '../../shared/review-stats';
import {
  buildBehindScheduleNotification,
  isTaskForDate
} from '../scheduler/behind-schedule';

export type CheckInTrigger = 'morning' | 'evening' | 'weekly' | 'behind';

/**
 * The honest facts the Sunday review may append; a subset of `WeeklyHonest`.
 * `accountability` is the optional factual clause naming the user's local
 * accountability person.
 */
export interface WeeklyHonestLike {
  calibration: string | null;
  nextStep: string | null;
  /**
   * Optional factual clause naming the user's local accountability person.
   * Absent keeps the weekly message byte-identical.
   */
  accountability?: string | null;
}

/** The weekly numbers a check-in may quote; a subset of `WeeklyOverview`. */
export interface WeeklyOverviewLike {
  tasksDone: number;
  tasksTotal: number;
  /** Undated tasks still open; shown as a separate line, never in the rate. */
  backlogCount: number;
  focusMinutes: number;
  answered: number;
  correct: number;
  /** `answered >= 5`; below that the recap quotes a count, not a percentage. */
  accuracyReliable: boolean;
  reviewedDays: number;
  dueMistakes: number;
}

/**
 * The task-anchored fact for the morning's recovery line (iter33 P2b②): the
 * first unfinished task of today's list and the next step recorded on it.
 * A subset of `WorkspaceTask`, so callers can pass the task itself.
 */
export interface TaskNextStepLike {
  title: string;
  nextStep?: string;
}

/**
 * The promise a check-in may ask about; the caller only resolves the oldest
 * open promise that is due, so this stays at most one line.
 */
export interface CommitmentLike {
  text: string;
  /** Local date YYYY-MM-DD the promise was due. */
  due: string;
}

/** `YYYY-MM-DD` shifted by `days` on the local calendar. */
function shiftLocalDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(year, month - 1, day + days);
  const nextMonth = String(shifted.getMonth() + 1).padStart(2, '0');
  const nextDay = String(shifted.getDate()).padStart(2, '0');
  return `${shifted.getFullYear()}-${nextMonth}-${nextDay}`;
}

/**
 * The single promise-revisit line for the morning check-in, or '' when there is
 * nothing to ask. Yesterday's and today's promises get the precise wording; an
 * older open promise still due gets one neutral question. Asking once, no debt.
 */
export function commitmentCheckInLine(
  commitment: CommitmentLike | null | undefined,
  date: string
): string {
  if (!commitment) return '';
  if (!isLocalDate(commitment.due) || !isLocalDate(date)) return '';
  if (!commitment.text.trim()) return '';
  if (commitment.due > date) return '';
  if (commitment.due === date) {
    return `你说今天要做「${commitment.text}」，做了吗？`;
  }
  if (commitment.due === shiftLocalDate(date, -1)) {
    return `昨天你说要做「${commitment.text}」，做了吗？没做的话，挪到今天还是先放一放？`;
  }
  // Older promises are not dragged back up as debt; one neutral question only.
  return `你之前说要做「${commitment.text}」，后来做了吗？`;
}

/** The review fact a morning check-in may act on. `freshStart` is true when
 * yesterday has no review but the history before it does — the morning after
 * a missed day.
 */
export interface ReviewRecoveryLike {
  freshStart: boolean;
}

/** The one fresh-start line for the morning after a missed review day. */
export const FRESH_START_CHECK_IN_LINE =
  '昨天没有复盘，新的一天从一件小事开始就行。';

/**
 * The one fresh-start line, or '' when the fact is absent or negative. Like
 * the resume sentence it is deterministic and appended to the composed
 * message, never handed to the model to reword or repeat.
 */
export function freshStartCheckInLine(
  facts: ReviewRecoveryLike | null | undefined
): string {
  return facts?.freshStart ? FRESH_START_CHECK_IN_LINE : '';
}

/**
 * The tomorrow-bridge fact a morning check-in may act on (iter33 P0):
 * yesterday's-or-earlier `tomorrow` as written, plus whether the newest few
 * such reviews all wrote the same step. Produced by `tomorrowBridge` in
 * `shared/review-stats.ts`; one source of truth for the shape.
 */
export type TomorrowBridgeLike = TomorrowBridgeFacts;

/** Upper bound for the embedded `tomorrow` text, counted in code points. */
const MAX_TOMORROW_CODE_POINTS = 60;
/** Head length kept when truncating, so 「…」 lands at exactly 60 code points. */
const TOMORROW_TRUNCATE_HEAD = 57;

/** The staleness variant: a way out, never an evaluation (不羞辱口径). */
const STALE_TOMORROW_LINE =
  '这步写了好几天了——要不要把它切小一点，或者干脆换一步？';

/**
 * The raw text when it fits 60 code points, else its first 57 code points
 * plus 「…」. Code points, not UTF-16 units: an astral character counts as
 * one and can never be cut in half. A deterministic rule, not a smart one —
 * no word-aware trimming.
 */
function truncateTomorrow(tomorrow: string): string {
  const codePoints = [...tomorrow];
  if (codePoints.length <= MAX_TOMORROW_CODE_POINTS) return tomorrow;
  return `${codePoints.slice(0, TOMORROW_TRUNCATE_HEAD).join('')}…`;
}

/**
 * The one tomorrow-bridge line for the morning check-in, or '' when there is
 * nothing to hand back. Line A asks whether today starts with the step the
 * user wrote down, embedding it verbatim after deterministic truncation. The
 * staleness fact swaps in line B — same slot, one line, no line A beside it.
 * The wording never names 「昨天」: the review may be days older, and the
 * line must not lie. Like the fresh-start line it is deterministic, appended
 * to the composed message, never handed to the model to reword or repeat.
 */
export function tomorrowCheckInLine(
  facts: TomorrowBridgeLike | null | undefined
): string {
  if (!facts) return '';
  const tomorrow = typeof facts.tomorrow === 'string' ? facts.tomorrow : '';
  if (tomorrow.trim() === '') return '';
  if (facts.stale) return STALE_TOMORROW_LINE;
  return `你在复盘里写下明天第一步：${truncateTomorrow(tomorrow)}——今天第一件事就是它吗？`;
}

/**
 * The one task-anchored recovery line (iter33 P2b②), or '' when the task has
 * no next step recorded. The morning message may use it in place of the
 * review's tomorrow line — the two never stack.
 */
export function nextStepCheckInLine(task: TaskNextStepLike | null | undefined): string {
  const title = typeof task?.title === 'string' ? task.title : '';
  const nextStep = typeof task?.nextStep === 'string' ? task.nextStep : '';
  if (title.trim() === '' || nextStep.trim() === '') return '';
  return `${title} 的下一步已经记好：${nextStep}——从它开始？`;
}

/**
 * The morning recovery line with the P2b priority rule applied: when the
 * first unfinished task of today's list carries a next step, the task line
 * speaks; otherwise the P0 review-tomorrow line (line A or its staleness
 * variant B) falls through. Always at most one line — the slots are
 * alternatives by construction, never appended side by side. Neither fact →
 * '', which keeps the morning message at its previous bytes.
 */
export function morningRecoveryLine(
  firstTask: TaskNextStepLike | null | undefined,
  tomorrowBridge: TomorrowBridgeLike | null | undefined
): string {
  return nextStepCheckInLine(firstTask) || tomorrowCheckInLine(tomorrowBridge);
}

/** True when the week has at least one number worth telling the user. */
function hasWeeklyNumbers(overview: WeeklyOverviewLike): boolean {
  return (
    overview.tasksDone > 0 ||
    overview.tasksTotal > 0 ||
    overview.focusMinutes > 0 ||
    overview.answered > 0 ||
    overview.reviewedDays > 0 ||
    overview.dueMistakes > 0
  );
}

function accuracyPercent(overview: WeeklyOverviewLike): number {
  return Math.round((overview.correct / overview.answered) * 100);
}

/** True when a percentage would mislead: some answers, but too few to trust. */
function accuracyTooSmall(overview: WeeklyOverviewLike): boolean {
  return overview.answered > 0 && !overview.accuracyReliable;
}

/**
 * The one-time sentence that explains the new completion scope (iter34 P1).
 * Appended to the Sunday review only until `weeklyScopeNoted` is set, so a
 * reader who studies one week's numbers is told once that undated backlog is
 * no longer in the denominator. Deterministic, never model-written.
 */
export const WEEKLY_SCOPE_NOTE = '（从本周起，积压任务不计入完成率分母）';

/**
 * `WEEKLY_SCOPE_NOTE` until it has been spoken once, then ''. `noted` is the
 * stored `AppSettings.weeklyScopeNoted`; only literal `true` suppresses it.
 */
export function weeklyScopeNoteLine(noted: boolean | undefined): string {
  return noted === true ? '' : WEEKLY_SCOPE_NOTE;
}

/**
 * The scope sentence to append to this week's review, or '' when the week has
 * no numbers to explain (an empty week keeps its previous bytes).
 */
export function weeklyScopeNoteFor(
  overview: WeeklyOverviewLike | null | undefined,
  noted: boolean | undefined
): string {
  if (!overview || !hasWeeklyNumbers(overview)) return '';
  return weeklyScopeNoteLine(noted);
}

/**
 * The prompt's weekly recap block, or [] when there is nothing to recap. The
 * section is bounded so it can never crowd out the tasks and memory sections.
 */
function weeklyStatsLines(
  overview: WeeklyOverviewLike | null | undefined
): string[] {
  if (!overview || !hasWeeklyNumbers(overview)) return [];
  const practiceLine =
    overview.answered === 0
      ? '- 练习：本周还没有做题'
      : accuracyTooSmall(overview)
        ? `- 练习：本周目前 ${overview.answered} 题（样本不足暂不计正确率）`
        : `- 练习：${overview.answered} 题，答对 ${overview.correct} 题（正确率 ${accuracyPercent(overview)}%）`;
  // The block's size is its own array length: every optional line is either
  // present or absent here, never trimmed afterwards, so a new line can never
  // silently lose the last one to a stale cap. The size test is the net.
  return [
    '本周数据：',
    `- 任务完成：${overview.tasksDone}/${overview.tasksTotal} 个`,
    ...(overview.backlogCount > 0
      ? [`- 另有积压 ${overview.backlogCount} 件（不计入完成率）`]
      : []),
    `- 专注：${overview.focusMinutes} 分钟`,
    practiceLine,
    `- 复盘：${overview.reviewedDays} 天`,
    `- 到期错题：${overview.dueMistakes} 道`
  ];
}

/**
 * `本周完成 3 个任务 · 专注 135 分钟 · 正确率 83%` for the template message,
 * or null when the week has no numbers so the message stays unchanged. Below
 * five answers the accuracy segment is left out entirely rather than quoted
 * as a fact.
 */
function weeklyRecapLine(
  overview: WeeklyOverviewLike | null | undefined
): string | null {
  if (!overview || !hasWeeklyNumbers(overview)) return null;
  const parts = [
    `本周完成 ${overview.tasksDone} 个任务`,
    `专注 ${overview.focusMinutes} 分钟`
  ];
  if (overview.answered > 0 && overview.accuracyReliable) {
    parts.push(`正确率 ${accuracyPercent(overview)}%`);
  }
  return parts.join(' · ');
}

/**
 * The deterministic tail of the Sunday review: the calibration line followed
 * by `下一步：…`, one line each, in that order, then the optional
 * accountability clause. Empty when the helper found no fact, so the message
 * keeps its previous bytes.
 */
export function weeklyHonestLines(
  honest: WeeklyHonestLike | null | undefined
): string[] {
  if (!honest) return [];
  return [
    ...(honest.calibration ? [honest.calibration] : []),
    ...(honest.nextStep ? [`下一步：${honest.nextStep}`] : []),
    ...(honest.accountability ? [honest.accountability] : [])
  ];
}

/** The backup facts a weekly review may quote; a subset of `BackupSettings`. */
export interface BackupStatusLike {
  /** Opt-in: absent or false appends nothing to any message. */
  ageLineEnabled?: boolean;
  /** Naive local ISO (`YYYY-MM-DDTHH:mm:ss`) of the last successful export. */
  lastBackupAt?: string;
  /**
   * The pending auto-backup failure reason, present only until a review has
   * spoken it once and cleared it.
   */
  lastBackupError?: string;
}

/**
 * The one backup-age line for the Sunday review, or '' when there is nothing
 * to say: the switch is off, the check-in date is unreadable, or the last
 * export was today (an unreadable or future-dated record counts as none, so
 * a bad date can never produce a wrong sentence). With no record at all it
 * says so once; otherwise it names the age in days and the day itself.
 *
 * Like the availability question this line is deterministic and appended to
 * the delivered message, never handed to the model to reword or duplicate.
 */
export function backupAgeLine(
  backup: BackupStatusLike | null | undefined,
  date: string
): string {
  if (!backup?.ageLineEnabled) return '';
  if (!isLocalDate(date)) return '';
  if (!isLocalDateTimeSeconds(backup.lastBackupAt)) return '还没有导出备份。';
  const lastDate = backup.lastBackupAt.slice(0, 10);
  const days = localDaysBetween(lastDate, date);
  // Zero days is not an age; a negative one (clock skew) would be a lie.
  if (days <= 0) return '';
  return `上次导出备份是 ${days} 天前（${formatMonthDay(lastDate)}）。`;
}

/**
 * The three-layer auto-backup failure copy, said exactly once on the next
 * Sunday review after a failed auto backup: what failed, that the data is
 * untouched, and what to do next. One line, deterministic, never handed to
 * the model. Empty unless a reason is pending; the caller clears the reason
 * once the message carrying it has landed.
 */
export function backupFailureLines(
  backup: BackupStatusLike | null | undefined
): string[] {
  if (typeof backup?.lastBackupError !== 'string' || backup.lastBackupError.trim() === '') {
    return [];
  }
  return [
    `自动备份没有成功（${backup.lastBackupError}）。你的数据没有被动过；可以稍后重试，或在「设置 → 数据与备份」手动导出。`
  ];
}

/** The one Sunday-review question about which days next week are packed. */
export const WEEK_AVAILABILITY_QUESTION =
  '下周哪几天会特别满？回我一句就行，那几天我只给你排一件小事。';

/**
 * The pending-resume facts for the first allowed check after a mute.
 *
 * `day` is the local day the resume took effect: the day the user clicked
 * 恢复提醒, or the last day of a mute that ended on its own. `muteEnd` is
 * present only when the user resumed *before* the mute would have ended, and
 * names the original end so the sentence can be truthful about it.
 */
export interface ResumeFacts {
  day: string;
  muteEnd?: string;
}

/**
 * The one sentence that names a resume: `你之前暂停到 11月20日，今天是恢复的
 * 第一天。` for a natural expiry, or `你提前恢复了提醒，原定暂停到 11月27日。`
 * when the user resumed early. Null (and therefore absent) unless the facts are
 * real local dates; the string form keeps its old guard so a `day` still in the
 * future says nothing.
 *
 * This sentence is deliberately *not* handed to the model: it is appended
 * after whatever text (template or model) came out, so it appears exactly once
 * by construction — the code owns both the presence and the count, and no
 * substring test on model output can produce a false duplicate or a miss.
 */
export function resumeCheckInLine(
  facts: string | ResumeFacts | null | undefined,
  date: string
): string {
  if (!facts) return '';
  const day = typeof facts === 'string' ? facts : facts.day;
  const muteEnd = typeof facts === 'string' ? undefined : facts.muteEnd;
  if (!isLocalDate(day) || !isLocalDate(date)) return '';
  // An early manual resume names the original end; the mute is still "原定"
  // because the user ended it before that day arrived. The date is not
  // compared to `date`, so the sentence never claims the mute already ended.
  if (muteEnd !== undefined) {
    if (!isLocalDate(muteEnd)) return '';
    return `你提前恢复了提醒，原定暂停到 ${formatMonthDay(muteEnd)}。`;
  }
  if (day > date) return '';
  return `你之前暂停到 ${formatMonthDay(day)}，今天是恢复的第一天。`;
}

/**
 * The availability question line, or '' when there is no workspace to plan
 * for. Like the accountability clause it is appended to the delivered message
 * and never handed to the model, which could reword or duplicate the ask.
 */
export function weekAvailabilityQuestion(
  context: Pick<ButlerContext, 'workspaces'>
): string {
  return context.workspaces.length > 0 ? WEEK_AVAILABILITY_QUESTION : '';
}

/**
 * The prompt's 诚实数据 block, or [] when there is nothing honest to add. The
 * accountability clause is deliberately left out: it is a deterministic
 * sentence appended after the message, never handed to the model to restate
 * (which would risk two differently-worded mentions).
 */
function honestPromptLines(
  honest: WeeklyHonestLike | null | undefined
): string[] {
  if (!honest) return [];
  const lines = [
    ...(honest.calibration ? [honest.calibration] : []),
    ...(honest.nextStep ? [`下一步：${honest.nextStep}`] : [])
  ];
  if (lines.length === 0) return [];
  return ['本周诚实数据：', ...lines.map((line) => `- ${line}`)];
}

export function activeTasks(context: ButlerContext) {
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
  date: string,
  weeklyOverview?: WeeklyOverviewLike | null,
  weeklyHonest?: WeeklyHonestLike | null,
  commitment?: CommitmentLike | null
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
              `- [${workspaceName(context, task.workspaceId)}] ${task.title}（${task.subject}，${task.durationMin} 分钟；验收：${task.acceptance}${task.cue ? `；触发：${task.cue}` : ''}）`
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
  // The weekly recap only appears when the week actually produced numbers, so
  // an empty week keeps the prompt byte-identical to the pre-recap version.
  const statsLines = trigger === 'weekly' ? weeklyStatsLines(weeklyOverview) : [];
  // The honest block follows the same rule: it appears only for the Sunday
  // review and only when the helper found a fact, so every other case stays
  // byte-identical to the previous prompt.
  const honestLines =
    trigger === 'weekly' ? honestPromptLines(weeklyHonest) : [];
  // The promise revisit is the morning's own line; every other trigger, and a
  // day with no open promise, keeps the prompt byte-identical.
  const promiseLine =
    trigger === 'morning' ? commitmentCheckInLine(commitment, date) : '';
  const instruction =
    trigger === 'morning'
      ? '请用中文写一条 2-4 句的检查消息：先问候，再根据上面的任务给出今天最值得先做的 1-2 件事，最后问一个简短的问题。'
      : trigger === 'behind'
        ? '请用中文写一条 2-3 句的检查消息：先温和点出今天还有几件事没做完、下一项是什么，再问用户要不要一起调整剩下的安排（缩短、延后或换任务）。'
        : trigger === 'evening'
          ? '请用中文写一条 2-4 句的检查消息：先问候，再根据上面的任务问完成情况、卡点，以及明天第一步。'
          : `请用中文写一条 3-5 句的周复盘邀请：${
              statsLines.length > 0
                ? '用上面的本周数据具体肯定进展、点名薄弱处，再'
                : '先肯定这一周的投入，再'
            }请用户回顾本周末完成与卡点，最后问下周最重要的 1-2 个重点。用户回答后会由阿咲保存复盘并生成下周计划；这条消息本身不要提及工具。`;

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
    ...(statsLines.length > 0 ? ['', ...statsLines] : []),
    ...(honestLines.length > 0 ? ['', ...honestLines] : []),
    ...(promiseLine ? ['', `承诺回访：${promiseLine}（只问这一件，不评价、不催促。）`] : []),
    '',
    instruction,
    '要求：温和、具体、不啰嗦；不要编造用户没有提供的记录；不要提到系统提示、工具或 API。'
  ].join('\n');
}

export function buildCheckInTemplate(
  context: ButlerContext,
  trigger: CheckInTrigger,
  date = '',
  weeklyOverview: WeeklyOverviewLike | null = null,
  weeklyHonest: WeeklyHonestLike | null = null,
  commitment: CommitmentLike | null = null,
  backup: BackupStatusLike | null = null,
  reviewRecovery: ReviewRecoveryLike | null = null,
  tomorrowBridge: TomorrowBridgeLike | null = null,
  weeklyScopeNote: string = ''
): string {
  const tasks = activeTasks(context);
  if (trigger === 'weekly') {
    const question =
      '周日好。花三分钟回顾一下这一周：完成了什么，卡在哪里，下周最重要的一件事是什么？说完我来帮你整理，并排下周的计划。';
    // One deterministic recap line, prepended only when the week has numbers.
    // It is never model-written, so the numbers agree with 复盘 exactly.
    const recap = weeklyRecapLine(weeklyOverview);
    const base = recap === null ? question : `${recap}\n${question}`;
    // The honest receipt ends the message, at most two lines. With neither
    // fact the template keeps its previous bytes for every existing fixture.
    const honest = weeklyHonestLines(weeklyHonest);
    const withHonest = honest.length === 0 ? base : `${base}\n${honest.join('\n')}`;
    // The opt-in backup age line follows the honest receipt and precedes the
    // availability question; off, unreadable dates and a same-day export all
    // keep the message at its previous bytes. A pending auto-backup failure
    // rides in the same slot, after the age line, when both are present.
    const age = backupAgeLine(backup, date);
    const failures = backupFailureLines(backup);
    const withAge = age ? `${withHonest}\n${age}` : withHonest;
    const withFailures =
      failures.length === 0 ? withAge : `${withAge}\n${failures.join('\n')}`;
    // The one-time scope sentence (iter34 P1) explains the new completion
    // denominator. Code-owned and spoken once; absent keeps the bytes.
    const withScope = weeklyScopeNote
      ? `${withFailures}\n${weeklyScopeNote}`
      : withFailures;
    // The availability question is the last line, and only when there is at
    // least one workspace; otherwise the message keeps its previous bytes.
    const availability = weekAvailabilityQuestion(context);
    return availability ? `${withScope}\n${availability}` : withScope;
  }
  if (trigger === 'behind') {
    // Byte-identical to the scheduler fallback so both compose one nudge.
    return buildBehindScheduleNotification(todayTasks(context, date))?.body ?? '';
  }
  if (trigger === 'morning') {
    const first = tasks[0];
    const base = first
      ? `早上好。今天有 ${tasks.length} 个任务，先做「${first.title}」怎么样？做完告诉我一声。`
      : '早上好。今天还没有安排任务，想先做点什么？';
    // The morning's deterministic tail: the fresh-start line precedes the
    // promise revisit when both fire (fixed order); each alone, or neither,
    // keeps every existing fixture byte-identical. The recovery line is the
    // newest member and appends last: it is the task's next-step line when
    // today's first unfinished task has one recorded, otherwise the P0
    // tomorrow bridge — at most one line either way.
    const freshStart = freshStartCheckInLine(reviewRecovery);
    const promise = commitmentCheckInLine(commitment, date);
    const recovery = morningRecoveryLine(first, tomorrowBridge);
    const tail = [freshStart, promise, recovery].filter((line) => line !== '');
    return tail.length === 0 ? base : `${base}\n${tail.join('\n')}`;
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
