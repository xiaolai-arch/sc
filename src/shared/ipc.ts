import type { AppSettings, DailyPlan, ExamProfile, ReviewAnswers, TaskStatus } from './types';

export interface Bootstrap {
  needsOnboarding: boolean;
  today: string;
  hasApiKey: boolean;
}

export interface UpdateTaskInput {
  taskId: string;
  status: TaskStatus;
  actualMin?: number;
}

export interface StudyCoachApi {
  getBootstrap(): Promise<Bootstrap>;
  completeOnboarding(profile: ExamProfile): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  setApiKey(key: string): Promise<void>;
  getTodayPlan(): Promise<DailyPlan | null>;
  generateTodayPlan(): Promise<DailyPlan>;
  updateTask(input: UpdateTaskInput): Promise<DailyPlan>;
  submitReview(input: { date: string; answers: ReviewAnswers }): Promise<void>;
}
