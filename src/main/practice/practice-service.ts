import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatLocalDate } from '../../shared/date';
import {
  type CreatePracticeSetInput,
  type DeletePracticeSetInput,
  type ExportMistakeSheetInput,
  type ExportMistakeSheetResult,
  normalizePracticeDurationMs,
  type PracticeAttempt,
  type PracticeConfidence,
  type PracticeMistake,
  type PracticeQuestion,
  type PracticeService,
  type PracticeSet,
  type ReviewMistakeInput,
  type SetMistakeResolvedInput,
  type SubmitAnswerInput,
  type SubmitAnswerResult,
  type SubmitShortAnswerInput,
  type UpdatePracticeSetInput
} from '../../shared/practice';
import {
  createMutex,
  listDirectories,
  listMarkdownFiles,
  pathExists,
  readFileOrNull,
  writeFileAtomic
} from '../workspace/fs-utils';
import { newId } from '../workspace/ids';
import { assertIsoDate, assertSafeSegment, workspaceDir, workspacesDir } from '../workspace/paths';
import { buildMistakeSheet } from '../../shared/practice-sheet';
import {
  parseAttemptFile,
  parseMistakesFile,
  parsePracticeSetFile,
  serializeAttemptFile,
  serializeMistakesFile,
  serializePracticeSetFile
} from './records';
import { nextSchedule } from './schedule';
import { buildSeedSets } from './seed';

export interface PracticeServiceOptions {
  /** Injectable clock for deterministic spaced-repetition tests. */
  now?: () => Date;
  /**
   * The opt-in stricter-mastery setting, read for each answered attempt so a
   * settings change applies without rebuilding the service. Absent or false is
   * today's behaviour; a read failure falls back to the default.
   */
  strictMastery?: () => boolean | Promise<boolean>;
}

function practiceDir(root: string, workspaceId: string): string {
  return join(workspaceDir(root, workspaceId), 'practice');
}

function setsDir(root: string, workspaceId: string): string {
  return join(practiceDir(root, workspaceId), 'sets');
}

function setFile(root: string, workspaceId: string, setId: string): string {
  return join(setsDir(root, workspaceId), `${setId}.md`);
}

function attemptsDir(root: string, workspaceId: string): string {
  return join(practiceDir(root, workspaceId), 'attempts');
}

function attemptFile(root: string, workspaceId: string, date: string): string {
  return join(attemptsDir(root, workspaceId), `${date}.md`);
}

function mistakesFile(root: string, workspaceId: string): string {
  return join(practiceDir(root, workspaceId), 'mistakes.md');
}

function reviewSheetsDir(root: string, workspaceId: string): string {
  return join(practiceDir(root, workspaceId), 'review-sheets');
}

function reviewSheetFile(root: string, workspaceId: string, date: string): string {
  return join(reviewSheetsDir(root, workspaceId), `${date}.md`);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`);
  return value;
}

/** The optional confidence enum; anything else is a caller bug, not data. */
function optionalConfidence(value: unknown): PracticeConfidence | undefined {
  if (value === undefined || value === null) return undefined;
  if (value !== 'sure' && value !== 'unsure') throw new Error('Invalid confidence');
  return value;
}

/** Only `model` carries provenance; `user` and absent both mean hand-made. */
function optionalSetSource(value: unknown): 'model' | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === 'user') return undefined;
  if (value !== 'model') throw new Error('Invalid practice set source');
  return 'model';
}

/** A caller-supplied review timestamp; the stored value is always an ISO date. */
function optionalReviewTimestamp(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw new Error('Invalid practice set reviewedAt');
  }
  return value;
}

function normalizeQuestions(input: unknown): PracticeQuestion[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('Practice set needs at least one question');
  }
  const used = new Set<string>();
  return input.map((value, index) => {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`Question ${index + 1} is invalid`);
    }
    const record = value as Record<string, unknown>;
    const prompt = requireString(record.prompt, `Question ${index + 1} prompt`);
    const id =
      record.id === undefined
        ? newId('q')
        : assertSafeSegment(requireString(record.id, `Question ${index + 1} id`), 'question id');
    if (used.has(id)) throw new Error(`Duplicate question id: ${id}`);
    used.add(id);
    const explanation = typeof record.explanation === 'string' ? record.explanation : '';
    const kind = record.kind === undefined ? undefined : record.kind;
    if (kind !== undefined && kind !== 'choice' && kind !== 'short') {
      throw new Error(`Question ${index + 1} kind is invalid`);
    }
    if (kind === 'short') {
      // Free recall: no options; the reference answer is the model answer.
      const referenceAnswer = requireString(
        record.referenceAnswer,
        `Question ${index + 1} referenceAnswer`
      );
      return { id, kind: 'short', prompt, options: [], answer: 0, referenceAnswer, explanation };
    }
    const options = Array.isArray(record.options)
      ? record.options.filter((option): option is string => typeof option === 'string' && option.trim() !== '')
      : [];
    if (options.length < 2) throw new Error(`Question ${index + 1} needs at least two options`);
    const answer = record.answer;
    if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      throw new Error(`Question ${index + 1} answer is out of range`);
    }
    return {
      id,
      prompt,
      options,
      answer,
      explanation
    };
  });
}

interface MistakeSource {
  workspaceId: string;
  setId: string;
  questionId: string;
  prompt: string;
  kind?: 'short';
  options: string[];
  answer: number;
  referenceAnswer?: string;
  explanation: string;
}

/**
 * Applies one answer to the spaced-repetition record via the pure scheduler
 * (`schedule.ts`): a wrong answer resets the interval to one day and raises
 * difficulty; a correct answer grows the interval, moves `due` forward and may
 * resolve the mistake once a spaced interval has elapsed. `correctStreak` is
 * bookkeeping only — it no longer resolves a record by itself. A wrong answer
 * the learner marked `有把握` raises difficulty by one extra step; `不确定` and
 * an unmarked answer behave exactly as before, and a correct answer is never
 * affected by confidence.
 *
 * `strict` is the opt-in stricter-mastery setting: it only withholds
 * `resolved` for a correct proof that was not free recall. Scheduling and the
 * wrong-answer path are identical either way.
 */
function applyMistakeAnswer(
  existing: PracticeMistake | undefined,
  source: MistakeSource,
  correct: boolean,
  confidence: PracticeConfidence | undefined,
  answeredAt: string,
  today: string,
  strict = false
): PracticeMistake | null {
  const kind = source.kind === 'short' ? 'short' : 'choice';
  if (!correct) {
    const schedule = nextSchedule(
      existing === undefined ? { intervalDays: 1, due: today } : existing,
      { correct: false, ...(confidence !== undefined ? { confidence } : {}), today }
    );
    const wrongCount = (existing?.wrongCount ?? 0) + 1;
    return {
      id: existing?.id ?? newId('pm'),
      workspaceId: source.workspaceId,
      setId: source.setId,
      questionId: source.questionId,
      prompt: source.prompt,
      ...(source.kind === 'short' ? { kind: 'short' as const } : {}),
      options: [...source.options],
      answer: source.answer,
      ...(source.referenceAnswer !== undefined ? { referenceAnswer: source.referenceAnswer } : {}),
      explanation: source.explanation,
      wrongCount,
      correctStreak: 0,
      priority: Math.min(3, (existing?.priority ?? 0) + 1),
      intervalDays: schedule.intervalDays,
      stabilityDays: schedule.stabilityDays,
      difficulty: schedule.difficulty,
      due: schedule.due,
      status: schedule.status,
      createdAt: existing?.createdAt ?? answeredAt,
      updatedAt: answeredAt,
      lastAnsweredAt: answeredAt
    };
  }
  if (existing === undefined) return null;
  const schedule = nextSchedule(existing, {
    correct: true,
    kind,
    ...(strict ? { strict: true } : {}),
    today
  });
  return {
    ...existing,
    priority: Math.max(0, existing.priority - 1),
    correctStreak: existing.correctStreak + 1,
    intervalDays: schedule.intervalDays,
    stabilityDays: schedule.stabilityDays,
    difficulty: schedule.difficulty,
    due: schedule.due,
    status: schedule.status,
    updatedAt: answeredAt,
    lastAnsweredAt: answeredAt
  };
}

/**
 * Vault-backed practice service. Every public call re-reads the vault, so edits
 * made in Obsidian (or by another process) are picked up immediately. Writes
 * are serialized per service instance and land via temp file + atomic rename.
 *
 * Seed sets are written only when a workspace has no `practice/sets/` directory
 * yet, so a user's own sets and deletions are never silently recreated.
 */
export function createPracticeService(root: string, options: PracticeServiceOptions = {}): PracticeService {
  const vaultRoot = resolve(root);
  const now = options.now ?? (() => new Date());
  const runExclusively = createMutex();
  let seedChecked = false;

  /**
   * The opt-in stricter-mastery flag for this answer. Absent option, a false
   * value or a failed lookup all mean today's behaviour.
   */
  async function strictMasteryEnabled(): Promise<boolean> {
    if (options.strictMastery === undefined) return false;
    try {
      return (await options.strictMastery()) === true;
    } catch {
      return false;
    }
  }

  async function ensureSeeded(): Promise<void> {
    if (seedChecked) return;
    await runExclusively(async () => {
      if (seedChecked) return;
      const timestamp = now().toISOString();
      const byWorkspace = new Map<string, PracticeSet[]>();
      for (const set of buildSeedSets(timestamp)) {
        const bucket = byWorkspace.get(set.workspaceId) ?? [];
        bucket.push(set);
        byWorkspace.set(set.workspaceId, bucket);
      }
      for (const [workspaceId, sets] of byWorkspace) {
        // Practice seeds only augment an existing workspace; creating the
        // workspace itself belongs to WorkspaceService (and its vault seeding).
        // This ordering also keeps a stray practice call from making
        // WorkspaceService believe the vault is already initialized.
        if (!(await pathExists(workspaceDir(vaultRoot, workspaceId)))) continue;
        // A pre-existing directory means the user has practice data (or
        // deliberately removed the seeds); do not overwrite it.
        if (await pathExists(setsDir(vaultRoot, workspaceId))) continue;
        for (const set of sets) {
          await writeFileAtomic(setFile(vaultRoot, workspaceId, set.id), serializePracticeSetFile(set));
        }
      }
      seedChecked = true;
    });
  }

  function assertWorkspaceId(workspaceId: string): string {
    return assertSafeSegment(workspaceId, 'workspace id');
  }

  async function readSets(workspaceId: string): Promise<PracticeSet[]> {
    const dir = setsDir(vaultRoot, workspaceId);
    const sets: PracticeSet[] = [];
    for (const fileName of await listMarkdownFiles(dir)) {
      const raw = await readFileOrNull(join(dir, fileName));
      if (raw === null) continue;
      const set = parsePracticeSetFile(raw, workspaceId, fileName.replace(/\.md$/, ''));
      if (set !== null) sets.push(set);
    }
    sets.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    return sets;
  }

  async function readMistakes(workspaceId: string): Promise<PracticeMistake[]> {
    const raw = await readFileOrNull(mistakesFile(vaultRoot, workspaceId));
    return raw === null ? [] : parseMistakesFile(raw);
  }

  async function findMistake(
    mistakeId: string
  ): Promise<{ workspaceId: string; mistake: PracticeMistake } | null> {
    for (const directory of await listDirectories(workspacesDir(vaultRoot))) {
      let workspaceId: string;
      try {
        workspaceId = assertWorkspaceId(directory);
      } catch {
        continue;
      }
      const mistake = (await readMistakes(workspaceId)).find((entry) => entry.id === mistakeId);
      if (mistake !== undefined) return { workspaceId, mistake };
    }
    return null;
  }

  async function findSet(
    setId: string
  ): Promise<{ workspaceId: string; set: PracticeSet } | null> {
    for (const directory of await listDirectories(workspacesDir(vaultRoot))) {
      let workspaceId: string;
      try {
        workspaceId = assertWorkspaceId(directory);
      } catch {
        continue;
      }
      const raw = await readFileOrNull(setFile(vaultRoot, workspaceId, setId));
      if (raw === null) continue;
      const set = parsePracticeSetFile(raw, workspaceId, setId);
      if (set !== null && set.id === setId) return { workspaceId, set };
    }
    return null;
  }

  async function findQuestion(
    questionId: string
  ): Promise<{ workspaceId: string; set: PracticeSet; question: PracticeQuestion } | null> {
    for (const directory of await listDirectories(workspacesDir(vaultRoot))) {
      let workspaceId: string;
      try {
        workspaceId = assertWorkspaceId(directory);
      } catch {
        continue;
      }
      for (const set of await readSets(workspaceId)) {
        const question = set.questions.find((entry) => entry.id === questionId);
        if (question !== undefined) return { workspaceId, set, question };
      }
    }
    return null;
  }

  async function listAttemptsFor(workspaceId: string): Promise<PracticeAttempt[]> {
    const dir = attemptsDir(vaultRoot, workspaceId);
    const attempts: PracticeAttempt[] = [];
    for (const fileName of await listMarkdownFiles(dir)) {
      const raw = await readFileOrNull(join(dir, fileName));
      if (raw === null) continue;
      attempts.push(...parseAttemptFile(raw));
    }
    return attempts.sort(
      (a, b) => a.answeredAt.localeCompare(b.answeredAt) || a.id.localeCompare(b.id)
    );
  }

  return {
    async listSets(workspaceId: string): Promise<PracticeSet[]> {
      const id = assertWorkspaceId(requireString(workspaceId, 'workspace id'));
      await ensureSeeded();
      return readSets(id);
    },

    async getSet(id: string): Promise<PracticeSet | null> {
      const setId = assertSafeSegment(requireString(id, 'practice set id'), 'practice set id');
      await ensureSeeded();
      return (await findSet(setId))?.set ?? null;
    },

    async createSet(input: CreatePracticeSetInput): Promise<PracticeSet> {
      if (typeof input !== 'object' || input === null) throw new Error('Practice set is required');
      const workspaceId = assertWorkspaceId(requireString(input.workspaceId, 'workspace id'));
      const title = requireString(input.title, 'Practice set title');
      const subject = typeof input.subject === 'string' ? input.subject : '';
      const source = optionalSetSource(input.source);
      const questions = normalizeQuestions(input.questions);
      const timestamp = now().toISOString();
      const set: PracticeSet = {
        id: newId('ps'),
        workspaceId,
        title,
        subject,
        questions,
        // Only a model set carries provenance; a hand-made set stays absent so
        // its file is byte-identical to sets written before this field existed.
        ...(source !== undefined ? { source } : {}),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      await ensureSeeded();
      await runExclusively(async () => {
        await writeFileAtomic(
          setFile(vaultRoot, workspaceId, set.id),
          serializePracticeSetFile(set)
        );
      });
      return set;
    },

    async updateSet(input: UpdatePracticeSetInput): Promise<PracticeSet> {
      if (typeof input !== 'object' || input === null) throw new Error('Practice set is required');
      const setId = assertSafeSegment(
        requireString(input.setId, 'practice set id'),
        'practice set id'
      );
      const hasTitle = input.title !== undefined;
      const hasSubject = input.subject !== undefined;
      const hasQuestions = input.questions !== undefined;
      const hasReviewedAt = input.reviewedAt !== undefined;
      if (!hasTitle && !hasSubject && !hasQuestions && !hasReviewedAt) {
        throw new Error('No practice set fields to update');
      }
      const title = hasTitle ? requireString(input.title, 'Practice set title') : undefined;
      const subject = hasSubject ? (typeof input.subject === 'string' ? input.subject : '') : undefined;
      const questions = hasQuestions ? normalizeQuestions(input.questions) : undefined;
      // 我看过了 records the learner's own verdict; the timestamp comes from
      // the renderer, so a hand-edited vault value can never claim a review
      // that did not happen.
      const reviewedAt = hasReviewedAt
        ? optionalReviewTimestamp(input.reviewedAt)
        : undefined;
      await ensureSeeded();
      return runExclusively(async () => {
        const found = await findSet(setId);
        if (found === null) throw new Error(`Practice set not found: ${setId}`);
        const next: PracticeSet = {
          ...found.set,
          ...(title !== undefined ? { title } : {}),
          ...(subject !== undefined ? { subject } : {}),
          ...(questions !== undefined ? { questions } : {}),
          ...(reviewedAt !== undefined ? { reviewedAt } : {}),
          updatedAt: now().toISOString()
        };
        await writeFileAtomic(
          setFile(vaultRoot, found.workspaceId, setId),
          serializePracticeSetFile(next)
        );
        return next;
      });
    },

    async deleteSet(input: DeletePracticeSetInput): Promise<void> {
      if (typeof input !== 'object' || input === null) throw new Error('Practice set is required');
      const setId = assertSafeSegment(
        requireString(input.setId, 'practice set id'),
        'practice set id'
      );
      await ensureSeeded();
      await runExclusively(async () => {
        const found = await findSet(setId);
        if (found === null) throw new Error(`Practice set not found: ${setId}`);
        // Only the set file goes away; mistakes and attempts stay as history.
        await fs.rm(setFile(vaultRoot, found.workspaceId, setId), { force: true });
      });
    },

    async submitAnswer(input: SubmitAnswerInput): Promise<SubmitAnswerResult> {
      if (typeof input !== 'object' || input === null) throw new Error('Answer is required');
      const questionId = assertSafeSegment(
        requireString(input.questionId, 'question id'),
        'question id'
      );
      const choice = input.choice;
      if (typeof choice !== 'number' || !Number.isInteger(choice) || choice < 0) {
        throw new Error('Invalid answer choice');
      }
      const confidence = optionalConfidence(input.confidence);
      // 服务端归一化兜底: the pane already caps at 60 s, but a bad client value
      // is clamped or dropped here rather than stored (never an error).
      const durationMs = normalizePracticeDurationMs(input.durationMs);
      await ensureSeeded();
      const found = await findQuestion(questionId);
      if (found === null) throw new Error(`Question not found: ${questionId}`);
      if (choice >= found.question.options.length) throw new Error('Invalid answer choice');

      const answeredAtDate = now();
      const answeredAt = answeredAtDate.toISOString();
      const today = formatLocalDate(answeredAtDate);
      const correct = choice === found.question.answer;
      const { workspaceId, set, question } = found;
      const strict = await strictMasteryEnabled();

      return runExclusively(async () => {
        const attempt: PracticeAttempt = {
          id: newId('pa'),
          workspaceId,
          setId: set.id,
          questionId,
          choice,
          ...(confidence !== undefined ? { confidence } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          correct,
          answeredAt
        };

        const dayFile = attemptFile(vaultRoot, workspaceId, today);
        const existingAttemptsRaw = await readFileOrNull(dayFile);
        const attempts = existingAttemptsRaw === null ? [] : parseAttemptFile(existingAttemptsRaw);
        await writeFileAtomic(dayFile, serializeAttemptFile(today, [...attempts, attempt]));

        const mistakes = await readMistakes(workspaceId);
        const index = mistakes.findIndex((entry) => entry.questionId === questionId);
        const existing = index >= 0 ? mistakes[index] : undefined;
        const mistake = applyMistakeAnswer(
          existing,
          {
            workspaceId,
            setId: set.id,
            questionId,
            prompt: question.prompt,
            options: question.options,
            answer: question.answer,
            explanation: question.explanation
          },
          correct,
          confidence,
          answeredAt,
          today,
          strict
        );

        if (mistake !== null) {
          if (index >= 0) mistakes[index] = mistake;
          else mistakes.push(mistake);
          await writeFileAtomic(
            mistakesFile(vaultRoot, workspaceId),
            serializeMistakesFile(workspaceId, mistakes, answeredAt)
          );
        }

        return {
          questionId,
          setId: set.id,
          workspaceId,
          choice,
          correct,
          answer: question.answer,
          explanation: question.explanation,
          attempt,
          mistake,
          due: mistake?.status === 'active' ? mistake.due : undefined
        };
      });
    },

    async submitShortAnswer(input: SubmitShortAnswerInput): Promise<SubmitAnswerResult> {
      if (typeof input !== 'object' || input === null) throw new Error('Answer is required');
      const questionId = assertSafeSegment(
        requireString(input.questionId, 'question id'),
        'question id'
      );
      const response = requireString(input.response, 'response');
      if (typeof input.selfCorrect !== 'boolean') throw new Error('selfCorrect is required');
      const correct = input.selfCorrect;
      const confidence = optionalConfidence(input.confidence);
      // Same 服务端归一化兜底 as the choice path: clamp to the cap, drop junk.
      const durationMs = normalizePracticeDurationMs(input.durationMs);
      await ensureSeeded();
      const found = await findQuestion(questionId);
      if (found === null) throw new Error(`Question not found: ${questionId}`);
      if (found.question.kind !== 'short') throw new Error('Question is not a short question');

      const answeredAtDate = now();
      const answeredAt = answeredAtDate.toISOString();
      const today = formatLocalDate(answeredAtDate);
      const { workspaceId, set, question } = found;
      const strict = await strictMasteryEnabled();

      return runExclusively(async () => {
        // `choice` stays 0: a free-recall attempt has no option index, and the
        // field is kept so every attempt record has the same shape.
        const attempt: PracticeAttempt = {
          id: newId('pa'),
          workspaceId,
          setId: set.id,
          questionId,
          choice: 0,
          response,
          ...(confidence !== undefined ? { confidence } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          correct,
          answeredAt
        };

        const dayFile = attemptFile(vaultRoot, workspaceId, today);
        const existingAttemptsRaw = await readFileOrNull(dayFile);
        const attempts = existingAttemptsRaw === null ? [] : parseAttemptFile(existingAttemptsRaw);
        await writeFileAtomic(dayFile, serializeAttemptFile(today, [...attempts, attempt]));

        const mistakes = await readMistakes(workspaceId);
        const index = mistakes.findIndex((entry) => entry.questionId === questionId);
        const existing = index >= 0 ? mistakes[index] : undefined;
        const mistake = applyMistakeAnswer(
          existing,
          {
            workspaceId,
            setId: set.id,
            questionId,
            prompt: question.prompt,
            kind: 'short',
            options: [],
            answer: 0,
            referenceAnswer: question.referenceAnswer,
            explanation: question.explanation
          },
          correct,
          confidence,
          answeredAt,
          today,
          strict
        );

        if (mistake !== null) {
          if (index >= 0) mistakes[index] = mistake;
          else mistakes.push(mistake);
          await writeFileAtomic(
            mistakesFile(vaultRoot, workspaceId),
            serializeMistakesFile(workspaceId, mistakes, answeredAt)
          );
        }

        return {
          questionId,
          setId: set.id,
          workspaceId,
          choice: 0,
          correct,
          answer: 0,
          explanation: question.explanation,
          attempt,
          mistake,
          due: mistake?.status === 'active' ? mistake.due : undefined
        };
      });
    },

    async reviewMistake(input: ReviewMistakeInput): Promise<SubmitAnswerResult> {
      if (typeof input !== 'object' || input === null) throw new Error('Review is required');
      const mistakeId = assertSafeSegment(
        requireString(input.mistakeId, 'mistake id'),
        'mistake id'
      );
      if (input.choice !== undefined) {
        const choice = input.choice;
        if (typeof choice !== 'number' || !Number.isInteger(choice) || choice < 0) {
          throw new Error('Invalid answer choice');
        }
      }
      const confidence = optionalConfidence(input.confidence);
      await ensureSeeded();
      const found = await findMistake(mistakeId);
      if (found === null) throw new Error(`Mistake not found: ${mistakeId}`);
      if (found.mistake.status === 'resolved') throw new Error('Mistake is already resolved');
      const { workspaceId, mistake: snapshot } = found;
      const short = snapshot.kind === 'short';
      let choice = 0;
      let response: string | undefined;
      let correct: boolean;
      if (short) {
        response = requireString(input.response, 'response');
        if (typeof input.selfCorrect !== 'boolean') throw new Error('selfCorrect is required');
        correct = input.selfCorrect;
      } else {
        const picked = input.choice;
        if (typeof picked !== 'number' || !Number.isInteger(picked) || picked < 0) {
          throw new Error('Invalid answer choice');
        }
        if (picked >= snapshot.options.length) throw new Error('Invalid answer choice');
        choice = picked;
        correct = picked === snapshot.answer;
      }

      const answeredAtDate = now();
      const answeredAt = answeredAtDate.toISOString();
      const today = formatLocalDate(answeredAtDate);
      const strict = await strictMasteryEnabled();

      return runExclusively(async () => {
        const attempt: PracticeAttempt = {
          id: newId('pa'),
          workspaceId,
          setId: snapshot.setId,
          questionId: snapshot.questionId,
          choice,
          ...(response !== undefined ? { response } : {}),
          ...(confidence !== undefined ? { confidence } : {}),
          correct,
          answeredAt
        };
        const dayFile = attemptFile(vaultRoot, workspaceId, today);
        const existingAttemptsRaw = await readFileOrNull(dayFile);
        const attempts =
          existingAttemptsRaw === null ? [] : parseAttemptFile(existingAttemptsRaw);
        await writeFileAtomic(dayFile, serializeAttemptFile(today, [...attempts, attempt]));

        const mistakes = await readMistakes(workspaceId);
        const index = mistakes.findIndex((entry) => entry.id === mistakeId);
        if (index < 0) throw new Error(`Mistake not found: ${mistakeId}`);
        const current = mistakes[index];
        const updated = applyMistakeAnswer(
          current,
          {
            workspaceId,
            setId: current.setId,
            questionId: current.questionId,
            prompt: current.prompt,
            ...(current.kind === 'short' ? { kind: 'short' as const } : {}),
            options: current.options,
            answer: current.answer,
            ...(current.referenceAnswer !== undefined
              ? { referenceAnswer: current.referenceAnswer }
              : {}),
            explanation: current.explanation
          },
          correct,
          confidence,
          answeredAt,
          today,
          strict
        );
        if (updated === null) throw new Error(`Mistake not found: ${mistakeId}`);
        mistakes[index] = updated;
        await writeFileAtomic(
          mistakesFile(vaultRoot, workspaceId),
          serializeMistakesFile(workspaceId, mistakes, answeredAt)
        );

        return {
          questionId: current.questionId,
          setId: current.setId,
          workspaceId,
          choice,
          correct,
          answer: current.answer,
          explanation: current.explanation,
          attempt,
          mistake: updated,
          ...(updated.status === 'active' ? { due: updated.due } : {})
        };
      });
    },

    async setMistakeResolved(input: SetMistakeResolvedInput): Promise<PracticeMistake> {
      if (typeof input !== 'object' || input === null) {
        throw new Error('Mistake update is required');
      }
      const mistakeId = assertSafeSegment(
        requireString(input.mistakeId, 'mistake id'),
        'mistake id'
      );
      if (typeof input.resolved !== 'boolean') throw new Error('resolved is required');
      await ensureSeeded();
      return runExclusively(async () => {
        const found = await findMistake(mistakeId);
        if (found === null) throw new Error(`Mistake not found: ${mistakeId}`);
        const mistakes = await readMistakes(found.workspaceId);
        const index = mistakes.findIndex((entry) => entry.id === mistakeId);
        if (index < 0) throw new Error(`Mistake not found: ${mistakeId}`);
        const updatedAt = now().toISOString();
        const updated: PracticeMistake = {
          ...mistakes[index],
          status: input.resolved ? 'resolved' : 'active',
          updatedAt
        };
        mistakes[index] = updated;
        await writeFileAtomic(
          mistakesFile(vaultRoot, found.workspaceId),
          serializeMistakesFile(found.workspaceId, mistakes, updatedAt)
        );
        return updated;
      });
    },

    async getMistakes(workspaceId: string): Promise<PracticeMistake[]> {
      const id = assertWorkspaceId(requireString(workspaceId, 'workspace id'));
      await ensureSeeded();
      const mistakes = (await readMistakes(id)).filter((entry) => entry.status === 'active');
      return mistakes.sort(
        (a, b) =>
          b.priority - a.priority ||
          a.due.localeCompare(b.due) ||
          a.questionId.localeCompare(b.questionId)
      );
    },

    async getDue(workspaceId: string, date: string): Promise<PracticeMistake[]> {
      const id = assertWorkspaceId(requireString(workspaceId, 'workspace id'));
      const dueDate = assertIsoDate(date, 'due date');
      await ensureSeeded();
      const mistakes = (await readMistakes(id)).filter(
        (entry) => entry.status === 'active' && entry.due <= dueDate
      );
      return mistakes.sort(
        (a, b) =>
          a.due.localeCompare(b.due) ||
          b.priority - a.priority ||
          a.questionId.localeCompare(b.questionId)
      );
    },

    async exportMistakeSheet(
      input: ExportMistakeSheetInput
    ): Promise<ExportMistakeSheetResult> {
      if (typeof input !== 'object' || input === null) {
        throw new Error('Review sheet is required');
      }
      const workspaceId = assertWorkspaceId(requireString(input.workspaceId, 'workspace id'));
      const dueOnly = input.dueOnly ?? false;
      if (typeof dueOnly !== 'boolean') throw new Error('dueOnly must be a boolean');
      await ensureSeeded();
      const today = formatLocalDate(now());
      const strict = await strictMasteryEnabled();
      const target = reviewSheetFile(vaultRoot, workspaceId, today);
      return runExclusively(async () => {
        // Read under the same lock so an answer landing mid-export cannot leave
        // the sheet describing a mistake list that never existed on disk.
        const mistakes = (await readMistakes(workspaceId))
          .filter((entry) => entry.status === 'active')
          .filter((entry) => !dueOnly || entry.due <= today)
          .sort(
            (a, b) =>
              b.priority - a.priority ||
              a.due.localeCompare(b.due) ||
              a.questionId.localeCompare(b.questionId)
          );
        await writeFileAtomic(
          target,
          buildMistakeSheet({ workspaceId, date: today, mistakes, strict })
        );
        return {
          path: `workspaces/${workspaceId}/practice/review-sheets/${today}.md`,
          count: mistakes.length,
          date: today
        };
      });
    },

    async listAttempts(workspaceId: string): Promise<PracticeAttempt[]> {
      const id = assertWorkspaceId(requireString(workspaceId, 'workspace id'));
      await ensureSeeded();
      return listAttemptsFor(id);
    }
  };
}
