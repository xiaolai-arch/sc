import type { NoteMeta } from '../../shared/types';
import { parseNote, serializeNote } from '../vault/note';
import { isLocalDate } from '../../shared/date';
import {
  normalizePracticeDurationMs,
  type PracticeAttempt,
  type PracticeConfidence,
  type PracticeMistake,
  type PracticeMistakeStatus,
  type PracticeQuestion,
  type PracticeSet,
  type PracticeSetSource
} from '../../shared/practice';
import { asBoolean, asFiniteNumber, asRecord, asString, asStringArray } from '../workspace/records/coerce';

function asInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/** Positive finite number, or undefined — keeps garbage out of the schedule. */
function asPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Number within `[min, max]`, or undefined. */
function asRangedNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

/**
 * Tolerant read of the optional pre-answer confidence. Anything else in the
 * field is dropped rather than failing the whole attempt, so a hand-edited file
 * never loses an answer over one stray value.
 */
export function asConfidence(value: unknown): PracticeConfidence | undefined {
  return value === 'sure' || value === 'unsure' ? value : undefined;
}

/** Validates one question object from frontmatter (or a create request). */
export function coerceQuestion(value: unknown): PracticeQuestion | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = asString(record.id);
  const prompt = asString(record.prompt);
  if (!id || !prompt || prompt.trim() === '') return null;
  const kind = record.kind === 'short' ? 'short' : undefined;
  const explanation = asString(record.explanation) ?? '';
  if (kind === 'short') {
    const referenceAnswer = asString(record.referenceAnswer);
    if (!referenceAnswer || referenceAnswer.trim() === '') return null;
    // The shape keeps `options`/`answer` for compatibility; they are unused.
    return { id, kind, prompt, options: [], answer: 0, referenceAnswer, explanation };
  }
  const options = asStringArray(record.options);
  if (options.length < 2) return null;
  const answer = asInt(record.answer);
  if (answer === undefined || answer < 0 || answer >= options.length) return null;
  return {
    id,
    prompt,
    options,
    answer,
    explanation
  };
}

/**
 * Tolerant read of the optional set provenance. Anything other than `model` is
 * treated as hand-made: legacy files carry `source: user` and hand-edited
 * values must not fail the whole set.
 */
export function asPracticeSetSource(value: unknown): PracticeSetSource | undefined {
  return value === 'model' ? 'model' : undefined;
}

/** A usable ISO timestamp, or undefined — stray values are dropped on read. */
function asIsoTimestamp(value: unknown): string | undefined {
  const text = asString(value);
  if (text === undefined || text.trim() === '') return undefined;
  return Number.isNaN(new Date(text).getTime()) ? undefined : text;
}

export function parsePracticeSetFile(
  raw: string,
  workspaceId: string,
  fallbackId: string
): PracticeSet | null {
  const { meta } = parseNote(raw);
  if (meta.kind !== 'practice-set' || !Array.isArray(meta.questions)) return null;
  const id = asString(meta.id) ?? fallbackId;
  const questions = meta.questions
    .map(coerceQuestion)
    .filter((question): question is PracticeQuestion => question !== null);
  if (questions.length === 0) return null;
  const source = asPracticeSetSource(meta.source);
  const reviewedAt = asIsoTimestamp(meta.reviewedAt);
  return {
    id,
    workspaceId,
    title: asString(meta.title) ?? id,
    subject: asString(meta.subject) ?? '',
    questions,
    // Both provenance fields are omitted when they carry no meaning, so files
    // written before this feature parse to exactly the records they hold.
    ...(source !== undefined ? { source } : {}),
    ...(reviewedAt !== undefined ? { reviewedAt } : {}),
    createdAt: asString(meta.created),
    updatedAt: asString(meta.updated)
  };
}

function answerLetter(answer: number): string {
  return String.fromCharCode(65 + answer);
}

/** A typed answer may span lines; the attempt log keeps one line per answer. */
function singleLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

export function serializePracticeSetFile(set: PracticeSet): string {
  const meta: NoteMeta = {
    type: 'qa',
    // Hand-made sets keep the historical `source: user` line so every set file
    // written before provenance existed round-trips byte-identically; a model
    // set is marked so the learner sees 待核对 until they review it.
    source: set.source === 'model' ? 'model' : 'user',
    kind: 'practice-set',
    id: set.id,
    workspaceId: set.workspaceId,
    title: set.title,
    subject: set.subject,
    // Absent until the learner confirms; omitted entirely while unset so an
    // unreviewed set has no extra line.
    ...(set.reviewedAt !== undefined ? { reviewedAt: set.reviewedAt } : {}),
    created: set.createdAt,
    updated: set.updatedAt,
    questions: set.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      // Both fields are written only when present, so a file holding only
      // choice questions round-trips byte-identically to before this feature.
      ...(question.kind === 'short' ? { kind: 'short' } : {}),
      options: [...question.options],
      answer: question.answer,
      ...(question.referenceAnswer !== undefined
        ? { referenceAnswer: question.referenceAnswer }
        : {}),
      explanation: question.explanation
    }))
  };
  const context = [set.workspaceId, set.subject, `${set.questions.length} 题`].filter(Boolean).join(' · ');
  const sections = set.questions.map((question, index) => {
    if (question.kind === 'short') {
      const explanation = question.explanation ? `\n\n**解析**：${question.explanation}` : '';
      return [
        `## ${index + 1}. ${question.prompt}`,
        '',
        `**参考答案**：${question.referenceAnswer ?? ''}${explanation}`
      ].join('\n');
    }
    const options = question.options
      .map((option, optionIndex) => `- ${String.fromCharCode(65 + optionIndex)}. ${option}`)
      .join('\n');
    const explanation = question.explanation ? `\n\n**解析**：${question.explanation}` : '';
    return [
      `## ${index + 1}. ${question.prompt}`,
      '',
      options,
      '',
      `**答案**：${answerLetter(question.answer)}${explanation}`
    ].join('\n');
  });
  const body = [`# ${set.title}`, '', context, '', ...sections, ''].join('\n');
  return serializeNote(meta, body);
}

export function parseAttemptFile(raw: string): PracticeAttempt[] {
  const { meta } = parseNote(raw);
  if (meta.kind !== 'practice-attempts' || !Array.isArray(meta.entries)) return [];
  const attempts: PracticeAttempt[] = [];
  for (const value of meta.entries) {
    const record = asRecord(value);
    if (record === null) continue;
    const id = asString(record.id);
    const workspaceId = asString(record.workspaceId);
    const setId = asString(record.setId);
    const questionId = asString(record.questionId);
    const choice = asInt(record.choice);
    const answeredAt = asString(record.answeredAt);
    if (!id || !workspaceId || !setId || !questionId || choice === undefined || !answeredAt) {
      continue;
    }
    const response = asString(record.response);
    const confidence = asConfidence(record.confidence);
    // Tolerant read with the same normalization the submit path applies, so a
    // hand-edited or legacy entry can never poison the fluent stats; a record
    // without the field simply stays without it.
    const durationMs = normalizePracticeDurationMs(record.durationMs);
    attempts.push({
      id,
      workspaceId,
      setId,
      questionId,
      choice,
      ...(response !== undefined ? { response } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      correct: asBoolean(record.correct, false),
      answeredAt
    });
  }
  return attempts;
}

export function serializeAttemptFile(date: string, attempts: readonly PracticeAttempt[]): string {
  const meta: NoteMeta = {
    type: 'log',
    source: 'user',
    kind: 'practice-attempts',
    date,
    entries: attempts.map((attempt) => ({ ...attempt }))
  };
  const lines = attempts.map((attempt) => {
    const time = attempt.answeredAt.slice(11, 16);
    const verdict = attempt.correct ? '✅' : '❌';
    // Confidence is written only when the learner marked one, so logs that
    // predate the feature keep their exact previous text.
    const confidence =
      attempt.confidence === 'sure' ? ' · 有把握' : attempt.confidence === 'unsure' ? ' · 不确定' : '';
    // 用时 likewise appears only when it was measured (rounded to seconds for
    // the human-readable line; the exact ms stays in the frontmatter entry).
    const duration = attempt.durationMs !== undefined ? ` · ${Math.round(attempt.durationMs / 1000)} 秒` : '';
    if (attempt.response !== undefined) {
      // Free recall: show what was typed, not an option index.
      return `- ${time || '--:--'} · ${attempt.questionId} · 简答「${singleLine(attempt.response)}」${confidence} · ${verdict}${duration}`;
    }
    return `- ${time || '--:--'} · ${attempt.questionId} · 选择 ${attempt.choice}${confidence} · ${verdict}${duration}`;
  });
  const body = [`# ${date} 练习记录`, '', ...lines, ''].join('\n');
  return serializeNote(meta, body);
}

function coerceMistake(value: unknown): PracticeMistake | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = asString(record.id);
  const workspaceId = asString(record.workspaceId);
  const setId = asString(record.setId);
  const questionId = asString(record.questionId);
  const prompt = asString(record.prompt);
  const kind = record.kind === 'short' ? 'short' : undefined;
  const referenceAnswer = asString(record.referenceAnswer);
  const options = asStringArray(record.options);
  const answer = asInt(record.answer);
  const due = asString(record.due);
  const createdAt = asString(record.createdAt);
  const updatedAt = asString(record.updatedAt);
  const lastAnsweredAt = asString(record.lastAnsweredAt);
  const short = kind === 'short';
  if (
    !id ||
    !workspaceId ||
    !setId ||
    !questionId ||
    !prompt ||
    (!short && options.length < 2) ||
    answer === undefined ||
    answer < 0 ||
    (!short && answer >= options.length) ||
    (short && (referenceAnswer === undefined || referenceAnswer.trim() === '')) ||
    !due ||
    !isLocalDate(due) ||
    !createdAt ||
    !updatedAt ||
    !lastAnsweredAt
  ) {
    return null;
  }
  const status: PracticeMistakeStatus = record.status === 'resolved' ? 'resolved' : 'active';
  // `stability` is the stored name; the record exposes it as `stabilityDays`.
  // The in-memory spelling is also accepted so a round-trip never depends on it.
  const stabilityDays =
    asPositiveNumber(record.stability) ?? asPositiveNumber(record.stabilityDays);
  const difficulty = asRangedNumber(record.difficulty, 0, 1);
  return {
    id,
    workspaceId,
    setId,
    questionId,
    prompt,
    // Both fields are omitted when absent so legacy records stay unchanged.
    ...(short ? { kind, referenceAnswer } : {}),
    options,
    answer,
    explanation: asString(record.explanation) ?? '',
    wrongCount: Math.max(0, asInt(record.wrongCount) ?? 0),
    correctStreak: Math.max(0, asInt(record.correctStreak) ?? 0),
    priority: Math.min(3, Math.max(0, asInt(record.priority) ?? 0)),
    intervalDays: Math.max(1, asInt(record.intervalDays) ?? 1),
    ...(stabilityDays !== undefined ? { stabilityDays } : {}),
    ...(difficulty !== undefined ? { difficulty } : {}),
    due,
    status,
    createdAt,
    updatedAt,
    lastAnsweredAt
  };
}

export function parseMistakesFile(raw: string): PracticeMistake[] {
  const { meta } = parseNote(raw);
  if (meta.kind !== 'practice-mistakes' || !Array.isArray(meta.entries)) return [];
  return meta.entries
    .map(coerceMistake)
    .filter((mistake): mistake is PracticeMistake => mistake !== null);
}

export function serializeMistakesFile(
  workspaceId: string,
  mistakes: readonly PracticeMistake[],
  updated: string
): string {
  const meta: NoteMeta = {
    type: 'qa',
    source: 'user',
    kind: 'practice-mistakes',
    workspaceId,
    updated,
    entries: mistakes.map((mistake) => {
      // Stored as `stability` for readability. Both fields are omitted entirely
      // while the record has no evidence-based schedule yet, so files written
      // before this feature existed round-trip byte-identically.
      const { stabilityDays, ...rest } = mistake;
      return {
        ...rest,
        ...(stabilityDays !== undefined ? { stability: stabilityDays } : {}),
        options: [...mistake.options]
      };
    })
  };
  const sections = mistakes.map((mistake) => {
    const state = mistake.status === 'resolved' ? '已掌握' : `下次复习 ${mistake.due}`;
    const answer = mistake.kind === 'short' ? `- 参考答案：${singleLine(mistake.referenceAnswer ?? '')}` : '';
    return [
      `## ${mistake.questionId} · ${mistake.prompt}`,
      '',
      ...(answer ? [answer] : []),
      `- 错误次数：${mistake.wrongCount}`,
      `- 优先级：${mistake.priority}`,
      `- 间隔：${mistake.intervalDays} 天`,
      `- ${state}`
    ].join('\n');
  });
  const body = [`# ${workspaceId} 错题本`, '', ...sections, ''].join('\n');
  return serializeNote(meta, body);
}
