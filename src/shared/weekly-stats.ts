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
  focusMinutes: number;
  answered: number;
  correct: number;
  /** `correct / answered`, or null before the first answer. */
  accuracy: number | null;
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
 * Tasks without a due date belong to the current week's backlog; dated tasks
 * count when their due date falls inside the week. Focus minutes only sum
 * completed tasks' recorded `actualMin`.
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

  const weekTasks = tasks.filter(
    (task) => task.due === undefined || (task.due >= startKey && task.due <= endKey)
  );
  const doneTasks = weekTasks.filter((task) => task.status === 'done');
  const focusMinutes = doneTasks.reduce(
    (total, task) =>
      typeof task.actualMin === 'number' && task.actualMin > 0
        ? total + task.actualMin
        : total,
    0
  );

  const weekAttempts = attempts.filter((attempt) => {
    const date = localDateOf(attempt.answeredAt);
    return date >= startKey && date <= todayKey;
  });
  const correct = weekAttempts.filter((attempt) => attempt.correct).length;

  const learning = topics.filter((topic) => topic.status === 'learning');
  const weakest = [...learning].sort(
    (a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name)
  )[0];

  return {
    weekStart: startKey,
    weekEnd: endKey,
    tasksDone: doneTasks.length,
    tasksTotal: weekTasks.length,
    focusMinutes,
    answered: weekAttempts.length,
    correct,
    accuracy: weekAttempts.length === 0 ? null : correct / weekAttempts.length,
    reviewedDays: reviewedDaysThisWeek(reviews, today),
    dueMistakes: dueMistakes.filter((mistake) => mistake.status === 'active').length,
    learningTopics: learning.length,
    masteredTopics: topics.filter((topic) => topic.status === 'mastered').length,
    weakestTopic: weakest?.name ?? null
  };
}
