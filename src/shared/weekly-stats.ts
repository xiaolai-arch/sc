import { formatLocalDate } from './date';
import type { KnowledgeTopic } from './knowledge';
import type { PracticeAttempt, PracticeMistake } from './practice';
import type { WorkspaceTask } from './workspace';
import { reviewedDaysThisWeek } from './review-stats';

export interface WeeklyOverview {
  /** Monday and Sunday of the week containing `today`, as local dates. */
  weekStart: string;
  weekEnd: string;
  tasksDone: number;
  tasksTotal: number;
  /**
   * Undated tasks still open (`pending` / `in-progress`). They are excluded
   * from `tasksTotal`, so the completion rate can never be dragged down by a
   * standing backlog; this count keeps them visible in the recap instead.
   */
  backlogCount: number;
  focusMinutes: number;
  answered: number;
  correct: number;
  /** `correct / answered`, or null before the first answer. */
  accuracy: number | null;
  /** `answered >= 5`: below that, no percentage is reported to the user. */
  accuracyReliable: boolean;
  reviewedDays: number;
  dueMistakes: number;
  learningTopics: number;
  masteredTopics: number;
  /** Lowest-rated topic still being learned, or null when none are. */
  weakestTopic: string | null;
}

export type WeeklyOverviewInput = {
  tasks: readonly WorkspaceTask[];
  attempts: readonly PracticeAttempt[];
  reviews: readonly { date: string }[];
  dueMistakes: readonly PracticeMistake[];
  topics: readonly KnowledgeTopic[];
  today: Date;
};

/** Completion facts for the past seven days, fed back into planning. */
export interface Recent7DayCompletion {
  /** Dated tasks in the window that were neither skipped nor undated. */
  planned: number;
  /** How many of those the user marked done. */
  done: number;
  /** `done / planned` rounded to a whole percent. */
  percent: number;
}

function startOfWeek(today: Date): Date {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // getDay(): 0 = Sunday; shift so Monday starts the week.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function localDateOf(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  return Number.isNaN(date.getTime()) ? '' : formatLocalDate(date);
}

/**
 * Summarises the Monday-based week containing `today`.
 *
 * Tasks count only when their due date falls inside the week — undated
 * backlog is not part of the week's plan, the same rule `recent7DayCompletion`
 * uses, so a standing backlog cannot drag the completion rate down forever.
 * `backlogCount` reports those open undated tasks separately. Focus minutes
 * only sum completed tasks' recorded `actualMin`.
 *
 * Answers follow Anki's True Retention rule: each question counts once per
 * local day, by its earliest answer that day, so re-answering the same card
 * neither inflates nor depresses the week's accuracy.
 */
export function weeklyOverview({
  tasks,
  attempts,
  reviews,
  dueMistakes,
  topics,
  today
}: WeeklyOverviewInput): WeeklyOverview {
  const start = startOfWeek(today);
  const startKey = formatLocalDate(start);
  const endKey = formatLocalDate(
    new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  );
  const todayKey = formatLocalDate(today);

  // The completion denominator: dated work only, the same rule
  // `recent7DayCompletion` uses (a standing backlog cannot drag the rate down).
  const weekTasks = tasks.filter(
    (task) => task.due !== undefined && task.due >= startKey && task.due <= endKey
  );
  const backlogCount = tasks.filter(
    (task) =>
      task.due === undefined &&
      (task.status === 'pending' || task.status === 'in-progress')
  ).length;
  const doneTasks = weekTasks.filter((task) => task.status === 'done');
  // Focus minutes keep the 1.3.0 scope: undated completed work still counts
  // (it belongs to the current week, per `studyHeatmap`), so this line stays
  // byte-identical and only the completion rate changes.
  const focusMinutes = tasks
    .filter(
      (task) =>
        task.status === 'done' &&
        (task.due === undefined || (task.due >= startKey && task.due <= endKey))
    )
    .reduce(
      (total, task) =>
        typeof task.actualMin === 'number' && task.actualMin > 0
          ? total + task.actualMin
          : total,
      0
    );

  // One entry per (question, local day), keeping that day's earliest answer.
  // The comparison is explicit so the result never depends on input order.
  const firstByQuestionDay = new Map<string, PracticeAttempt>();
  for (const attempt of attempts) {
    const date = localDateOf(attempt.answeredAt);
    if (date < startKey || date > todayKey) continue;
    const key = `${attempt.questionId}|${date}`;
    const kept = firstByQuestionDay.get(key);
    if (
      kept === undefined ||
      attempt.answeredAt < kept.answeredAt ||
      (attempt.answeredAt === kept.answeredAt && attempt.id < kept.id)
    ) {
      firstByQuestionDay.set(key, attempt);
    }
  }
  const weekAttempts = [...firstByQuestionDay.values()];
  const correct = weekAttempts.filter((attempt) => attempt.correct).length;
  const answered = weekAttempts.length;

  const learning = topics.filter((topic) => topic.status === 'learning');
  const weakest = [...learning].sort(
    (a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name)
  )[0];

  return {
    weekStart: startKey,
    weekEnd: endKey,
    tasksDone: doneTasks.length,
    tasksTotal: weekTasks.length,
    backlogCount,
    focusMinutes,
    answered,
    correct,
    accuracy: answered === 0 ? null : correct / answered,
    accuracyReliable: answered >= 5,
    reviewedDays: reviewedDaysThisWeek(reviews, today),
    dueMistakes: dueMistakes.filter((mistake) => mistake.status === 'active').length,
    learningTopics: learning.length,
    masteredTopics: topics.filter((topic) => topic.status === 'mastered').length,
    weakestTopic: weakest?.name ?? null
  };
}

/**
 * Completion facts for the seven local days ending `today` (the window
 * `[today-6, today]`), counted by due date. A task belongs to the day it was
 * due, and undated backlog is never part of a day's plan — the same rule the
 * behind-schedule nudge uses, so a standing backlog cannot drag the rate down
 * forever. `skipped` counts neither as planned nor as done.
 *
 * Returns null when fewer than five dated tasks fall in the window: a sample
 * that small must not be reported as a fact, and callers (the planning
 * prompt) stay byte-identical without it.
 */
export function recent7DayCompletion(
  tasks: readonly WorkspaceTask[],
  today: Date
): Recent7DayCompletion | null {
  const todayKey = formatLocalDate(today);
  const startKey = formatLocalDate(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)
  );
  let planned = 0;
  let done = 0;
  for (const task of tasks) {
    // A missing/malformed due date never lands inside the window.
    if (task.due === undefined || task.due < startKey || task.due > todayKey) continue;
    if (task.status === 'skipped') continue;
    planned += 1;
    if (task.status === 'done') done += 1;
  }
  if (planned < 5) return null;
  return { planned, done, percent: Math.round((done / planned) * 100) };
}
