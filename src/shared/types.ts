export type NoteType = 'note' | 'mistake' | 'plan' | 'log' | 'qa' | 'profile' | 'material';
export type TaskStatus = 'pending' | 'in-progress' | 'done' | 'skipped';

export interface NoteMeta {
  type: NoteType;
  subject?: string;
  status?: string;
  created?: string;
  updated?: string;
  source?: 'user' | 'agent' | 'imported';
  userTouched?: boolean;
  tags?: string[];
  review?: { next: string; interval_days: number; ease: number };
  tasks?: StudyTask[];
  [key: string]: unknown;
}

export interface Note { path: string; meta: NoteMeta; body: string; mtimeMs: number; }

export interface StudyTask {
  id: string;
  title: string;
  subject: string;
  durationMin: number;
  materialRefs: string[];
  acceptance: string;
  status: TaskStatus;
  actualMin?: number;
}

export type LocalCliAgent = 'codex' | 'claude' | 'zcode' | 'opencode';

export type ProviderConfig =
  | { kind: 'anthropic'; model: string }
  | { kind: 'openai-compatible'; baseURL: string; model: string }
  | { kind: 'ollama'; baseURL: string; model: string }
  | {
      kind: 'local-cli';
      agent: LocalCliAgent;
      command?: string;
      model?: string;
      /** Claude Code only: run with --bare to skip global hooks/CLAUDE.md. */
      isolate?: boolean;
    };

export interface NotificationSettings {
  enabled: boolean;
  morning: string;
  evening: string;
  dndStart: string;
  dndEnd: string;
}

export interface BudgetSettings { proactiveSessionsPerDay: number; dailyTokens: number; }

export interface AppSettings {
  vaultPath: string;
  provider: ProviderConfig;
  notifications: NotificationSettings;
  budget: BudgetSettings;
  launchAtLogin: boolean;
}

export interface ReviewAnswers { completed: string; stuck: string; tomorrow: string; skipped?: boolean; }
