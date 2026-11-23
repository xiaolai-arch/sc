export type NoteType = 'note' | 'mistake' | 'plan' | 'log' | 'qa' | 'profile' | 'material';
export type TaskStatus = 'pending' | 'in-progress' | 'done' | 'skipped';

export interface NoteMeta {
  type: NoteType;
  subject?: string;
  status?: string;
  created?: string;
  updated?: string;
  source?: 'user' | 'agent' | 'imported' | 'model';
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

/** Longest local accountability name, in characters (trimmed, single line). */
export const MAX_ACCOUNTABILITY_NAME = 20;

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
  /** 落后提醒: checks today's plan in the evening (HH:MM). */
  behindSchedule: string;
  /** 落后提醒 switch; on by default. */
  behindScheduleEnabled: boolean;
  /** Local date (YYYY-MM-DD) that pauses proactive check-ins; '' clears it. */
  snoozedUntil?: string;
  /**
   * The local day the mute was resumed (`YYYY-MM-DD`). The first proactive
   * check-in after the mute appends one factual sentence built from it, then
   * the field is cleared — so the key is only ever serialized while a resume is
   * pending, and a settings file without it round-trips unchanged.
   */
  resumedFrom?: string;
  /**
   * The last muted day the manual resume cut short (`YYYY-MM-DD`), when the
   * user resumed before the mute would have ended. Stored beside
   * `resumedFrom` and cleared with it, so the "原定暂停到 X" sentence can name
   * the real end without the mute still being in force. Absent for a natural
   * expiry, which reads `snoozedUntil` instead.
   */
  resumedFromMuteEnd?: string;
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

/**
 * Last-backup facts the settings card's status line and the Sunday review's
 * opt-in age line quote, plus the weekly auto-backup switches (P1). The block
 * is absent for a fresh install or a legacy settings file and is dropped again
 * when empty, so a file written before this feature round-trips
 * byte-identically. The export flow in the main process writes the
 * `lastBackup*` facts; the settings page toggles the switches.
 */
export interface BackupSettings {
  /**
   * Opt-in: the Sunday review appends one factual line about the last export.
   * Absent/false appends nothing, and only `true` is ever serialized, so
   * turning it off removes the key like `strictMastery`.
   */
  ageLineEnabled?: boolean;
  /**
   * Opt-in weekly auto backup. Absent means off and only `true` is ever
   * serialized (the owner's 默认关 decision), so 「暂不」 on the one-time ask
   * never writes this key.
   */
  autoEnabled?: boolean;
  /**
   * The one-time ask after the first manual export already happened, whatever
   * the user answered. Only `true` is ever serialized; while the key is
   * absent the ask still owes the user an answer after a successful export.
   */
  autoBackupAsked?: boolean;
  /** Days between auto backups; absent means 7. Only 1 | 7 | 30 are valid. */
  autoIntervalDays?: 1 | 7 | 30;
  /**
   * Directory the auto backup copies into (absolute path). Without it the auto
   * backup never runs and never errors; the settings page says so.
   */
  autoDestination?: string;
  /**
   * The human-readable reason of the last *auto* backup failure. It persists
   * until the next Sunday review has spoken it once (the three-layer copy),
   * and only that read clears it — a later success never silences an unsaid
   * failure. Manual export failures stay session-scoped in the renderer.
   */
  lastBackupError?: string;
  /**
   * Local wall clock of the last successful backup, naive ISO
   * `YYYY-MM-DDTHH:mm:ss` (no timezone offset), so the age math can take the
   * local date directly. A failure never touches this key.
   */
  lastBackupAt?: string;
  /** Absolute path of the last successful backup folder. */
  lastBackupPath?: string;
  /** Last export result; `failed` is display-only and never blocks a retry. */
  lastBackupOutcome?: 'ok' | 'failed';
}

export interface AppSettings {
  /** How the butler addresses the user in greetings and the sidebar. */
  displayName?: string;
  vaultPath: string;
  provider: ProviderConfig;
  notifications: NotificationSettings;
  budget: BudgetSettings;
  launchAtLogin: boolean;
  /**
   * Opt-in stricter mastery: an active mistake is only marked 已掌握 by a
   * correct *short* (free-recall) answer across a spaced interval; a correct
   * choice answer still reschedules it but never resolves it. Absent/false is
   * today's behaviour, and only `true` is ever serialized.
   */
  strictMastery?: boolean;
  /**
   * A real person the user names for themselves (friend, colleague, family),
   * stored only on this machine. The app never contacts them; reminders may
   * state one fact such as `你告诉过 A 的时间是 2026-11-20`. Trimmed, at most
   * 20 characters, no newlines. Empty/absent means off and is never
   * serialized, so legacy settings files round-trip byte-identically.
   */
  accountabilityName?: string;
  /**
   * Last-backup state (time, path, outcome) plus the opt-in weekly-review age
   * line. Absent by default and dropped again when empty, so legacy settings
   * files round-trip byte-identically.
   */
  backup?: BackupSettings;
}

export interface ReviewAnswers { completed: string; stuck: string; tomorrow: string; skipped?: boolean; }
