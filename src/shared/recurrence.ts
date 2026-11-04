import { formatLocalDate, parseLocalDate } from './date';

export const TASK_REPEATS = ['daily', 'weekdays', 'weekly'] as const;

/** How a completed task schedules its next occurrence. */
export type TaskRepeat = (typeof TASK_REPEATS)[number];

export const TASK_REPEAT_LABELS: Record<TaskRepeat, string> = {
  daily: '每天',
  weekdays: '工作日',
  weekly: '每周'
};

export function isTaskRepeat(value: unknown): value is TaskRepeat {
  return typeof value === 'string' && (TASK_REPEATS as readonly string[]).includes(value);
}

/** The next due date after `due`, skipping weekends for weekday repeats. */
export function nextRepeatDate(due: string, repeat: TaskRepeat): string {
  const date = parseLocalDate(due);
  const step = repeat === 'weekly' ? 7 : 1;
  do {
    date.setDate(date.getDate() + step);
  } while (repeat === 'weekdays' && (date.getDay() === 0 || date.getDay() === 6));
  return formatLocalDate(date);
}
