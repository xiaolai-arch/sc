import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatLocalDate, parseLocalDate } from '../../shared/date';
import {
  PRACTICE_INTERVALS,
  type CreatePracticeSetInput,
  type DeletePracticeSetInput,
  type PracticeAttempt,
  type PracticeMistake,
  type PracticeQuestion,
  type PracticeService,
  type PracticeSet,
  type SubmitAnswerInput,
  type SubmitAnswerResult,
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
import {
  parseAttemptFile,
  parseMistakesFile,
  parsePracticeSetFile,
  serializeAttemptFile,
  serializeMistakesFile,
  serializePracticeSetFile
} from './records';
import { buildSeedSets } from './seed';

export interface PracticeServiceOptions {
  /** Injectable clock for deterministic spaced-repetition tests. */
  now?: () => Date;
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

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`);
  return value;
}

function addDays(date: string, days: number): string {
  const next = parseLocalDate(date);
  next.setDate(next.getDate() + days);
  return formatLocalDate(next);
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
    const options = Array.isArray(record.options)
      ? record.options.filter((option): option is string => typeof option === 'string' && option.trim() !== '')
      : [];
    if (options.length < 2) throw new Error(`Question ${index + 1} needs at least two options`);
    const answer = record.answer;
    if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      throw new Error(`Question ${index + 1} answer is out of range`);
    }
    const id =
      record.id === undefined
        ? newId('q')
        : assertSafeSegment(requireString(record.id, `Question ${index + 1} id`), 'question id');
    if (used.has(id)) throw new Error(`Duplicate question id: ${id}`);
    used.add(id);
    return {
      id,
      prompt,
      options,
      answer,
      explanation: typeof record.explanation === 'string' ? record.explanation : ''
    };
  });
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
      const questions = normalizeQuestions(input.questions);
      const timestamp = now().toISOString();
      const set: PracticeSet = {
        id: newId('ps'),
        workspaceId,
        title,
        subject,
        questions,
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
      if (!hasTitle && !hasSubject && !hasQuestions) {
        throw new Error('No practice set fields to update');
      }
      const title = hasTitle ? requireString(input.title, 'Practice set title') : undefined;
      const subject = hasSubject ? (typeof input.subject === 'string' ? input.subject : '') : undefined;
      const questions = hasQuestions ? normalizeQuestions(input.questions) : undefined;
      await ensureSeeded();
      return runExclusively(async () => {
        const found = await findSet(setId);
        if (found === null) throw new Error(`Practice set not found: ${setId}`);
        const next: PracticeSet = {
          ...found.set,
          ...(title !== undefined ? { title } : {}),
          ...(subject !== undefined ? { subject } : {}),
          ...(questions !== undefined ? { questions } : {}),
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
      await ensureSeeded();
      const found = await findQuestion(questionId);
      if (found === null) throw new Error(`Question not found: ${questionId}`);
      if (choice >= found.question.options.length) throw new Error('Invalid answer choice');

      const answeredAtDate = now();
      const answeredAt = answeredAtDate.toISOString();
      const today = formatLocalDate(answeredAtDate);
      const correct = choice === found.question.answer;
      const { workspaceId, set, question } = found;

      return runExclusively(async () => {
        const attempt: PracticeAttempt = {
          id: newId('pa'),
          workspaceId,
          setId: set.id,
          questionId,
          choice,
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
        let changed = false;
        let mistake: PracticeMistake | null = existing ?? null;

        if (!correct) {
          const wrongCount = (existing?.wrongCount ?? 0) + 1;
          const intervalDays = PRACTICE_INTERVALS[Math.min(wrongCount - 1, PRACTICE_INTERVALS.length - 1)];
          const updated: PracticeMistake = {
            id: existing?.id ?? newId('pm'),
            workspaceId,
            setId: set.id,
            questionId,
            prompt: question.prompt,
            options: [...question.options],
            answer: question.answer,
            explanation: question.explanation,
            wrongCount,
            correctStreak: 0,
            priority: Math.min(3, (existing?.priority ?? 0) + 1),
            intervalDays,
            due: addDays(today, intervalDays),
            status: 'active',
            createdAt: existing?.createdAt ?? answeredAt,
            updatedAt: answeredAt,
            lastAnsweredAt: answeredAt
          };
          if (index >= 0) mistakes[index] = updated;
          else mistakes.push(updated);
          mistake = updated;
          changed = true;
        } else if (existing !== undefined) {
          // A correct answer lowers the priority (and eventually resolves the
          // mistake) without deleting the history.
          const correctStreak = existing.correctStreak + 1;
          const priority = Math.max(0, existing.priority - 1);
          const updated: PracticeMistake = {
            ...existing,
            priority,
            correctStreak,
            status: correctStreak >= 2 ? 'resolved' : 'active',
            updatedAt: answeredAt,
            lastAnsweredAt: answeredAt
          };
          mistakes[index] = updated;
          mistake = updated;
          changed = true;
        }

        if (changed) {
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

    async listAttempts(workspaceId: string): Promise<PracticeAttempt[]> {
      const id = assertWorkspaceId(requireString(workspaceId, 'workspace id'));
      await ensureSeeded();
      return listAttemptsFor(id);
    }
  };
}
