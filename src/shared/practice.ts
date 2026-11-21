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

/**
 * `choice` questions are answered by picking an option; `short` questions are
 * answered by free recall, which the learning-science evidence favours over
 * recognition (Bisra 2018). Absent means `choice`, so existing files and
 * callers keep their meaning without a migration.
 */
export type PracticeQuestionKind = 'choice' | 'short';

export interface PracticeQuestion {
  id: string;
  prompt: string;
  /** Absent means `choice`. */
  kind?: PracticeQuestionKind;
  options: string[];
  /** Index into `options`. Unused (0) for short questions. */
  answer: number;
  /** Short questions only: the model answer shown after recall. */
  referenceAnswer?: string;
  explanation: string;
}

/**
 * Who wrote the questions: absent or `user` means the learner made the set;
 * `model` means the butler generated it. A model set stays 待核对 until the
 * learner confirms they read it (`reviewedAt`), because generated questions
 * are not trusted wholesale.
 */
export type PracticeSetSource = 'user' | 'model';

export interface PracticeSet {
  id: string;
  workspaceId: string;
  title: string;
  subject: string;
  questions: PracticeQuestion[];
  /** Absent/`user` = hand-made (the default); `model` = AI-generated. */
  source?: PracticeSetSource;
  /** ISO timestamp of the learner's 我看过了 confirmation. */
  reviewedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PracticeAttempt {
  id: string;
  workspaceId: string;
  setId: string;
  questionId: string;
  /** Index into the question's `options`. Unused (0) for short questions. */
  choice: number;
  /** Short questions: what the learner typed. Absent for choice attempts. */
  response?: string;
  /** Pre-answer confidence; absent when the learner did not pick one. */
  confidence?: PracticeConfidence;
  correct: boolean;
  answeredAt: string;
}

export type PracticeMistakeStatus = 'active' | 'resolved';

/**
 * The learner's own confidence *before* seeing the verdict: `有把握` or
 * `不确定`. Optional everywhere so an answer without a choice stays valid and
 * older records keep their meaning. It exists because illusions of competence
 * are the norm (Kornell & Bjork 2009): a confidently wrong answer is the one
 * worth drilling, and the scheduler treats it as a harder item.
 */
export type PracticeConfidence = 'sure' | 'unsure';

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
  /** Absent means `choice`; kept on the snapshot so the book can show it. */
  kind?: PracticeQuestionKind;
  options: string[];
  answer: number;
  /** Short mistakes only: the model answer, shown in the book and the sheet. */
  referenceAnswer?: string;
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
  /** Optional self-assessment recorded with the attempt. */
  confidence?: PracticeConfidence;
}

/**
 * A short question has no grader locally, so the learner assesses their own
 * recall after seeing the reference answer. `selfCorrect` is that verdict and
 * drives the same scheduler a choice answer does.
 */
export interface SubmitShortAnswerInput {
  questionId: string;
  /** What the learner typed; non-empty after trimming. */
  response: string;
  /** Self-assessment: true = 答对了, false = 没答对. */
  selfCorrect: boolean;
  /** Optional pre-answer confidence, recorded with the attempt. */
  confidence?: PracticeConfidence;
}

export interface SubmitAnswerResult {
  questionId: string;
  setId: string;
  workspaceId: string;
  /** Unused (0) for short questions; `response` carries what was typed. */
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
  /** Absent means `choice`. */
  kind?: PracticeQuestionKind;
  /** Choice questions: two or more options. Short questions: empty/omitted. */
  options?: string[];
  /** Choice questions: index into `options`. Short questions: omit. */
  answer?: number;
  /** Short questions only, required and non-empty for them. */
  referenceAnswer?: string;
  explanation?: string;
}

export interface CreatePracticeSetInput {
  workspaceId: string;
  title: string;
  subject?: string;
  /** `model` marks an AI-generated set, which stays 待核对 until reviewed. */
  source?: PracticeSetSource;
  questions: CreatePracticeQuestionInput[];
}

export interface UpdatePracticeSetInput {
  setId: string;
  title?: string;
  subject?: string;
  /**
   * ISO timestamp marking the learner's review (the 我看过了 button). Once set,
   * a model set no longer shows the 待核对 chip.
   */
  reviewedAt?: string;
  /** Replaces the whole question list; provided question ids are preserved. */
  questions?: CreatePracticeQuestionInput[];
}

export interface DeletePracticeSetInput {
  setId: string;
}

export interface ReviewMistakeInput {
  mistakeId: string;
  /** Index into the mistake's stored options. Choice mistakes only. */
  choice?: number;
  /** Short mistakes only: what the learner typed. */
  response?: string;
  /** Short mistakes only: self-assessment (`答对了` = true). */
  selfCorrect?: boolean;
  /** Optional pre-answer confidence, recorded with the attempt. */
  confidence?: PracticeConfidence;
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
   * Records a free-recall answer. Local-first has no grader, so the learner's
   * self-assessment is the correctness signal handed to the scheduler.
   */
  submitShortAnswer(input: SubmitShortAnswerInput): Promise<SubmitAnswerResult>;
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
