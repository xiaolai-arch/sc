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
  /**
   * Short questions only: 2-3 sentence-level self-check points the learner
   * ticks against their own recall BEFORE seeing the reference answer. The
   * checkpoints are a mirror, not a judge — they never score, never schedule
   * and never call a model. Absent means the question has none, which keeps
   * its answering flow identical to the two-step baseline.
   */
  checkpoints?: string[];
  explanation: string;
}

/** Upper bound for `PracticeQuestion.checkpoints`; more are dropped on read. */
export const MAX_CHECKPOINTS = 3;

/**
 * Tolerant read/write shape for `checkpoints`: drops empty and whitespace-only
 * entries, keeps at most 2-3 verbatim strings, and treats fewer than 2 as no
 * checkpoints at all (the whole field is then absent). One definition so the
 * butler tool, the vault reader and the answer flow cannot drift apart.
 */
export function normalizeCheckpoints(value: unknown): string[] | undefined {
  const list = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : [];
  const kept = list.slice(0, MAX_CHECKPOINTS);
  return kept.length >= 2 ? kept : undefined;
}

/**
 * Aligns a `checkpointHits` value with a question's checkpoints: indexes beyond
 * the input count as unchecked (缺失视为未勾), a longer input is truncated, and
 * a question without checkpoints yields undefined so no field is ever written.
 * Non-boolean entries read as unchecked rather than failing the attempt.
 */
export function alignCheckpointHits(
  hits: unknown,
  checkpoints: readonly string[] | undefined
): boolean[] | undefined {
  if (checkpoints === undefined || checkpoints.length === 0) return undefined;
  const values = Array.isArray(hits) ? hits : [];
  return checkpoints.map((_, index) => values[index] === true);
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

/**
 * Client answer-time ceiling, the Anki `cap_answer_time_to_secs: 60` 口径:
 * the pane measures 呈现→提交 and clamps at one minute before submitting, and
 * the service re-applies the same clamp as a fallback so a misbehaving caller
 * cannot inflate a stored duration. Unrelated to 整卷模拟's whole-paper
 * `durationMs` (a session budget in LearningPane's `WholePaperSession`), which
 * shares nothing with this per-attempt field.
 */
export const PRACTICE_DURATION_CAP_MS = 60_000;

/**
 * The 自动召回 threshold: a correct answer inside 10 s counts as automated
 * recall, one at or beyond it counts as 对了但慢. Spec-filling default
 * (iter33 P1, item 67), a constant — deliberately not a settings entry.
 */
export const AUTO_RECALL_MS = 10_000;

/**
 * The one normalization for a submitted or stored `durationMs`. Out-of-range
 * values are clamped to the cap; anything that is not a positive integer
 * (including NaN) means the field carries no measurement and is omitted —
 * never an error, so old callers and hand-edited files keep working.
 */
export function normalizePracticeDurationMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return undefined;
  return value > PRACTICE_DURATION_CAP_MS ? PRACTICE_DURATION_CAP_MS : value;
}

export interface PracticeAttempt {
  id: string;
  workspaceId: string;
  setId: string;
  questionId: string;
  /** Index into the question's `options`. Unused (0) for short attempts. */
  choice: number;
  /** Short attempts: what the learner typed. Absent for choice attempts. */
  response?: string;
  /** Pre-answer confidence; absent when the learner did not pick one. */
  confidence?: PracticeConfidence;
  /**
   * 呈现→提交 answer time in milliseconds, measured by the pane and capped at
   * `PRACTICE_DURATION_CAP_MS` (the service re-clamps as a fallback). Absent
   * when the caller did not measure (legacy records, mistake reviews), so old
   * files and callers need no migration. Fluent stats count it; scheduling
   * ignores it — 用时不影响调度 (Anki 口径).
   */
  durationMs?: number;
  /**
   * Short questions with checkpoints only: the learner's per-checkpoint self
   * ticks, aligned with the question's `checkpoints` at stats time by
   * `alignCheckpointHits` (truncated/extended, missing = unchecked). Absent on
   * every other attempt, so files written before this field keep their shape.
   */
  checkpointHits?: boolean[];
  correct: boolean;
  answeredAt: string;
}

export type PracticeMistakeStatus = 'active' | 'resolved';

/**
 * Upper bound for `PracticeMistake.cause`, counted in Unicode code points (so a
 * surrogate pair is one character). A longer cause is truncated, never marked
 * with an ellipsis: the cause is the learner's own sentence about a concept,
 * and a clipped word is less misleading than a trailing symbol the learner did
 * not write (iter34 P0 default decision 1).
 */
export const MAX_CAUSE_CODE_POINTS = 40;

/**
 * The one normalization for a stored or submitted `cause`: trim, drop an empty
 * or whitespace-only value (absent means 未填), and cut to
 * `MAX_CAUSE_CODE_POINTS` code points. Shared by the answer path, the butler
 * tool and the vault reader so the three cannot drift apart.
 */
export function normalizeCause(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const codePoints = Array.from(trimmed);
  return codePoints.length > MAX_CAUSE_CODE_POINTS
    ? codePoints.slice(0, MAX_CAUSE_CODE_POINTS).join('')
    : trimmed;
}

/**
 * 顽疾 (a stubborn item) is a *property of the question*, never of the person:
 * it has been wrong at least twice and has not been answered correctly twice in
 * a row since. `priority` deliberately takes no part — it moves in lockstep
 * with `correctStreak` (`practice-service.ts`), so an `priority===3`-based rule
 * could never be washed out. Display only: nothing about this function changes
 * what is stored.
 */
export function isStubbornMistake(
  mistake: Pick<PracticeMistake, 'wrongCount' | 'correctStreak'>
): boolean {
  return mistake.wrongCount >= 2 && mistake.correctStreak < 2;
}

/**
 * The one clause a strict-mode surface states, verbatim, so the setting reads
 * the same wherever the mastery rule is printed. It is never shown when the
 * setting is off.
 */
export const STRICT_MASTERY_NOTE = '更严判定生效中：需要简答题复证';

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
   * The learner's own one-line 错因 — which concept, and why it went wrong
   * (iter34 P0). Optional: absent means 未填 and renders nothing. The vault
   * stores it trimmed and cut to `MAX_CAUSE_CODE_POINTS` code points
   * (`normalizeCause`). Never model-generated and never preset.
   */
  cause?: string;
  /**
   * Local date (`YYYY-MM-DD`) a resolved mistake was moved to
   * `practice/mistakes-archive.md`. Absent on every record in `mistakes.md`;
   * the archive file uses the same schema plus this field, so the two files can
   * be read by the same parser (iter34 P0 ④).
   */
  archivedAt?: string;
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
  /**
   * Client-measured 呈现→提交 time in ms; the service normalizes it
   * (`normalizePracticeDurationMs`) before anything is stored.
   */
  durationMs?: number;
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
  /**
   * The checkpoint self-ticks from the 对照检查点自查 step, aligned with the
   * question's checkpoints by the service (`alignCheckpointHits`). Absent for
   * questions without checkpoints.
   */
  checkpointHits?: boolean[];
  /** Optional pre-answer confidence, recorded with the attempt. */
  confidence?: PracticeConfidence;
  /**
   * 呈现→提交 time in ms. 口径 B (item 67, sc-lead 2026-11-27): the clock runs
   * to the self-assessment click — the same moment the attempt is recorded —
   * so choice and short answers share one timing path.
   */
  durationMs?: number;
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
  /**
   * Short questions only: 2-3 sentence-level checkpoints. Anything fewer than
   * 2 (after dropping empties) is treated as no checkpoints and omitted; more
   * than 3 keeps the first 3. Hand-made sets may leave it out entirely.
   */
  checkpoints?: string[];
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

/**
 * Writes the learner's own one-line 错因 on a mistake (iter34 P0 ①). The value
 * is trimmed and cut to 40 code points (`normalizeCause`); an empty or
 * whitespace-only value clears the field instead of storing a blank line.
 */
export interface SetMistakeCauseInput {
  mistakeId: string;
  cause: string;
}

/** Moves this workspace's resolved mistakes to `practice/mistakes-archive.md`. */
export interface ArchiveResolvedMistakesInput {
  workspaceId: string;
}

export interface ArchiveResolvedMistakesResult {
  /** Records newly appended to the archive (0 when everything was already there). */
  archived: number;
  /** Vault-relative POSIX path of the archive file. */
  path: string;
}

/** One archived record back into `mistakes.md`; it stays `resolved`. */
export interface RestoreArchivedMistakeInput {
  mistakeId: string;
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

/** Anki TSV export of one practice set (iter34 P2). */
export interface ExportAnkiSetInput {
  workspaceId: string;
  setId: string;
}

/** Anki TSV export of the whole mistake book (iter34 P2). */
export interface ExportAnkiMistakesInput {
  workspaceId: string;
}

export interface ExportAnkiResult {
  /** Vault-relative POSIX path of the written file. */
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
  /** Writes (or, with a blank value, clears) the learner's own one-line 错因. */
  setMistakeCause?(input: SetMistakeCauseInput): Promise<PracticeMistake>;
  /** Explicit 清空已掌握: moves each resolved mistake to the archive file. */
  archiveResolvedMistakes?(
    input: ArchiveResolvedMistakesInput
  ): Promise<ArchiveResolvedMistakesResult>;
  /** Records currently in `practice/mistakes-archive.md`, newest first. */
  listArchivedMistakes?(workspaceId: string): Promise<PracticeMistake[]>;
  /** Moves one archived record back into `mistakes.md` (status stays resolved). */
  restoreArchivedMistake?(input: RestoreArchivedMistakeInput): Promise<PracticeMistake>;
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
  /** Anki-compatible TSV of one practice set (iter34 P2). */
  exportAnkiSet?(input: ExportAnkiSetInput): Promise<ExportAnkiResult>;
  /** Anki-compatible TSV of every active mistake (iter34 P2). */
  exportAnkiMistakes?(input: ExportAnkiMistakesInput): Promise<ExportAnkiResult>;
}
