import type { AppSettings, DailyPlan, ExamProfile } from './types';
import type { ButlerService, WorkspaceService } from './workspace';

export interface Bootstrap {
  needsOnboarding: boolean;
  today: string;
  hasApiKey: boolean;
}

export interface UpdateTaskInput {
  taskId: string;
  status: 'pending' | 'in-progress' | 'done' | 'skipped';
  actualMin?: number;
}

export interface StudyCoachApi extends WorkspaceService, ButlerService {
  getBootstrap(): Promise<Bootstrap>;
  completeOnboarding(profile: ExamProfile): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  setApiKey(key: string): Promise<void>;
  getTodayPlan(): Promise<DailyPlan | null>;
  generateTodayPlan(): Promise<DailyPlan>;
  updateTask(input: UpdateTaskInput): Promise<DailyPlan>;
}
