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
export type LocalCliEffort = 'low' | 'medium' | 'high';

export type ProviderConfig =
  | { kind: 'anthropic'; model: string }
  | { kind: 'openai-compatible'; baseURL: string; model: string }
  | { kind: 'ollama'; baseURL: string; model: string }
  | {
      kind: 'local-cli';
      agent: LocalCliAgent;
      command?: string;
      model?: string;
      /** codex defaults to medium when unset; claude then uses the CLI default. */
      effort?: LocalCliEffort;
      /** Claude Code only: run with --bare to skip global hooks/CLAUDE.md. */
      isolate?: boolean;
      /**
       * Let the CLI use its own native tools inside the vault (file edits,
       * search, shell, web) instead of treating it as a one-shot text model.
       */
      nativeTools?: boolean;
    };

export interface NotificationSettings {
  enabled: boolean;
  morning: string;
  evening: string;
  /** Sunday recap time (HH:MM). */
  weekly: string;
  weeklyEnabled: boolean;
  /** Local date (YYYY-MM-DD) that pauses proactive check-ins; '' clears it. */
  snoozedUntil?: string;
  dndStart: string;
  dndEnd: string;
}

export interface BudgetSettings {
  proactiveSessionsPerDay: number;
  dailyTokens: number;
  /** Yuan per million input tokens; absent/0 means no cost estimate. */
  inputPricePerMillion?: number;
  /** Yuan per million output tokens; absent/0 means no cost estimate. */
  outputPricePerMillion?: number;
}

export interface AppSettings {
  /** How the butler addresses the user in greetings and the sidebar. */
  displayName?: string;
  vaultPath: string;
  provider: ProviderConfig;
  notifications: NotificationSettings;
  budget: BudgetSettings;
  launchAtLogin: boolean;
}

export interface ReviewAnswers { completed: string; stuck: string; tomorrow: string; skipped?: boolean; }
