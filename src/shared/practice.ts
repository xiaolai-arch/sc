/**
 * Practice sets, attempts and mistakes.
 *
 * The vault is the source of truth: sets live in
 * `workspaces/<id>/practice/sets/<setId>.md`, attempts in
 * `workspaces/<id>/practice/attempts/YYYY-MM-DD.md` and mistakes in
 * `workspaces/<id>/practice/mistakes.md`. All three are markdown files with
 * YAML frontmatter so they stay readable and editable in Obsidian.
 */

/**
 * Legacy fixed intervals (days). The main-process scheduler no longer uses
 * these — it grows the interval on success and resets on failure
 * (`src/main/practice/schedule.ts`). Kept for the browser mock API until it
 * moves to the same schedule.
 */
export const PRACTICE_INTERVALS = [1, 3, 7] as const;

export interface PracticeQuestion {
  id: string;
  prompt: string;
  options: string[];
  /** Index into `options`. */
  answer: number;
  explanation: string;
}

export interface PracticeSet {
  id: string;
  workspaceId: string;
  title: string;
  subject: string;
  questions: PracticeQuestion[];
  createdAt?: string;
  updatedAt?: string;
}

export interface PracticeAttempt {
  id: string;
  workspaceId: string;
  setId: string;
  questionId: string;
  /** Index into the question's `options`. */
  choice: number;
  correct: boolean;
  answeredAt: string;
}

export type PracticeMistakeStatus = 'active' | 'resolved';

/**
 * A wrong answer enters the mistake book. `priority` rises with each wrong
 * answer (0–3) and falls when the same question is answered correctly again.
 * Scheduling follows the evidence on spaced practice: a correct answer grows
 * the interval and moves `due` forward, a wrong answer resets it to one day,
 * and a mistake is only resolved by a correct answer after an interval of at
 * least three days has elapsed on a later day (never by two same-day answers).
 * Resolved records stay in the vault for history but are excluded from
 * `getMistakes` and `getDue`.
 */
export interface PracticeMistake {
  id: string;
  workspaceId: string;
  setId: string;
  questionId: string;
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
  wrongCount: number;
  correctStreak: number;
  priority: number;
  intervalDays: number;
  /**
   * Current memory stability in days — what `intervalDays` grows from on a
   * successful review. Optional: records written before evidence-based
   * scheduling carry no value and are migrated on the fly
   * (`src/main/practice/schedule.ts`).
   */
  stabilityDays?: number;
  /** Memory difficulty, 0 (easy) – 1 (hard). Optional, as above. */
  difficulty?: number;
  /** Local calendar date (`YYYY-MM-DD`) the mistake should be reviewed. */
  due: string;
  status: PracticeMistakeStatus;
  createdAt: string;
  updatedAt: string;
  lastAnsweredAt: string;
}

export interface SubmitAnswerInput {
  questionId: string;
  choice: number;
}

export interface SubmitAnswerResult {
  questionId: string;
  setId: string;
  workspaceId: string;
  choice: number;
  correct: boolean;
  answer: number;
  explanation: string;
  attempt: PracticeAttempt;
  /** Updated mistake record, or null when a correct answer had no mistake. */
  mistake: PracticeMistake | null;
  /** Present when this answer (re)scheduled a mistake review. */
  due?: string;
}

export interface CreatePracticeQuestionInput {
  /** Optional; a path-safe id is generated when omitted. */
  id?: string;
  prompt: string;
  options: string[];
  answer: number;
  explanation?: string;
}

export interface CreatePracticeSetInput {
  workspaceId: string;
  title: string;
  subject?: string;
  questions: CreatePracticeQuestionInput[];
}

export interface UpdatePracticeSetInput {
  setId: string;
  title?: string;
  subject?: string;
  /** Replaces the whole question list; provided question ids are preserved. */
  questions?: CreatePracticeQuestionInput[];
}

export interface DeletePracticeSetInput {
  setId: string;
}

export interface ReviewMistakeInput {
  mistakeId: string;
  /** Index into the mistake's stored options. */
  choice: number;
}

export interface SetMistakeResolvedInput {
  mistakeId: string;
  resolved: boolean;
}

/** Writes a printable review sheet for the workspace's active mistakes. */
export interface ExportMistakeSheetInput {
  workspaceId: string;
  /** Keep only mistakes due today (or overdue). Defaults to false. */
  dueOnly?: boolean;
}

export interface ExportMistakeSheetResult {
  /** Vault-relative POSIX path of the written sheet. */
  path: string;
  count: number;
  date: string;
}

/** Main-process contract: vault-backed or test implementation. */
export interface PracticeService {
  listSets(workspaceId: string): Promise<PracticeSet[]>;
  getSet(id: string): Promise<PracticeSet | null>;
  createSet(input: CreatePracticeSetInput): Promise<PracticeSet>;
  updateSet?(input: UpdatePracticeSetInput): Promise<PracticeSet>;
  deleteSet?(input: DeletePracticeSetInput): Promise<void>;
  submitAnswer(input: SubmitAnswerInput): Promise<SubmitAnswerResult>;
  /**
   * Reviews a mistake using its stored question snapshot, so a review still
   * works after the source practice set was renamed or deleted.
   */
  reviewMistake?(input: ReviewMistakeInput): Promise<SubmitAnswerResult>;
  /** Marks a mistake resolved (mastered) or active again without answering. */
  setMistakeResolved?(input: SetMistakeResolvedInput): Promise<PracticeMistake>;
  getMistakes(workspaceId: string): Promise<PracticeMistake[]>;
  getDue(workspaceId: string, date: string): Promise<PracticeMistake[]>;
  /** Attempt history, oldest first. Useful for review/analytics. */
  listAttempts(workspaceId: string): Promise<PracticeAttempt[]>;
  /**
   * Writes a printable markdown sheet of the active mistakes to
   * `workspaces/<id>/practice/review-sheets/<YYYY-MM-DD>.md`. Regenerating on
   * the same day overwrites; the sheet is never read back as mistakes.
   */
  exportMistakeSheet?(input: ExportMistakeSheetInput): Promise<ExportMistakeSheetResult>;
}
