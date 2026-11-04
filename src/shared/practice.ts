/**
 * Practice sets, attempts and mistakes.
 *
 * The vault is the source of truth: sets live in
 * `workspaces/<id>/practice/sets/<setId>.md`, attempts in
 * `workspaces/<id>/practice/attempts/YYYY-MM-DD.md` and mistakes in
 * `workspaces/<id>/practice/mistakes.md`. All three are markdown files with
 * YAML frontmatter so they stay readable and editable in Obsidian.
 */

/** Spaced-repetition intervals (days) for consecutive wrong answers. */
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
 * answer (0–3) and falls when the same question is answered correctly again;
 * two consecutive correct answers mark the mistake as resolved. Resolved
 * records stay in the vault for history but are excluded from `getMistakes`
 * and `getDue`.
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
}

export interface DeletePracticeSetInput {
  setId: string;
}

/** Main-process contract: vault-backed or test implementation. */
export interface PracticeService {
  listSets(workspaceId: string): Promise<PracticeSet[]>;
  getSet(id: string): Promise<PracticeSet | null>;
  createSet(input: CreatePracticeSetInput): Promise<PracticeSet>;
  updateSet?(input: UpdatePracticeSetInput): Promise<PracticeSet>;
  deleteSet?(input: DeletePracticeSetInput): Promise<void>;
  submitAnswer(input: SubmitAnswerInput): Promise<SubmitAnswerResult>;
  getMistakes(workspaceId: string): Promise<PracticeMistake[]>;
  getDue(workspaceId: string, date: string): Promise<PracticeMistake[]>;
  /** Attempt history, oldest first. Useful for review/analytics. */
  listAttempts(workspaceId: string): Promise<PracticeAttempt[]>;
}
