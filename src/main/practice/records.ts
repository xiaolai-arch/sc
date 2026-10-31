import type { NoteMeta } from '../../shared/types';
import type {
  PracticeAttempt,
  PracticeMistake,
  PracticeMistakeStatus,
  PracticeQuestion,
  PracticeSet
} from '../../shared/practice';
import { parseNote, serializeNote } from '../vault/note';
import { asBoolean, asFiniteNumber, asRecord, asString, asStringArray } from '../workspace/records/coerce';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function asInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/** Validates one question object from frontmatter (or a create request). */
export function coerceQuestion(value: unknown): PracticeQuestion | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = asString(record.id);
  const prompt = asString(record.prompt);
  if (!id || !prompt || prompt.trim() === '') return null;
  const options = asStringArray(record.options);
  if (options.length < 2) return null;
  const answer = asInt(record.answer);
  if (answer === undefined || answer < 0 || answer >= options.length) return null;
  return {
    id,
    prompt,
    options,
    answer,
    explanation: asString(record.explanation) ?? ''
  };
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
  return {
    id,
    workspaceId,
    title: asString(meta.title) ?? id,
    subject: asString(meta.subject) ?? '',
    questions,
    createdAt: asString(meta.created),
    updatedAt: asString(meta.updated)
  };
}

function answerLetter(answer: number): string {
  return String.fromCharCode(65 + answer);
}

export function serializePracticeSetFile(set: PracticeSet): string {
  const meta: NoteMeta = {
    type: 'qa',
    source: 'user',
    kind: 'practice-set',
    id: set.id,
    workspaceId: set.workspaceId,
    title: set.title,
    subject: set.subject,
    created: set.createdAt,
    updated: set.updatedAt,
    questions: set.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      options: [...question.options],
      answer: question.answer,
      explanation: question.explanation
    }))
  };
  const context = [set.workspaceId, set.subject, `${set.questions.length} 题`].filter(Boolean).join(' · ');
  const sections = set.questions.map((question, index) => {
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
    attempts.push({
      id,
      workspaceId,
      setId,
      questionId,
      choice,
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
    return `- ${time || '--:--'} · ${attempt.questionId} · 选择 ${attempt.choice} · ${verdict}`;
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
  const options = asStringArray(record.options);
  const answer = asInt(record.answer);
  const due = asString(record.due);
  const createdAt = asString(record.createdAt);
  const updatedAt = asString(record.updatedAt);
  const lastAnsweredAt = asString(record.lastAnsweredAt);
  if (
    !id ||
    !workspaceId ||
    !setId ||
    !questionId ||
    !prompt ||
    options.length < 2 ||
    answer === undefined ||
    answer < 0 ||
    answer >= options.length ||
    !due ||
    !isIsoDate(due) ||
    !createdAt ||
    !updatedAt ||
    !lastAnsweredAt
  ) {
    return null;
  }
  const status: PracticeMistakeStatus = record.status === 'resolved' ? 'resolved' : 'active';
  return {
    id,
    workspaceId,
    setId,
    questionId,
    prompt,
    options,
    answer,
    explanation: asString(record.explanation) ?? '',
    wrongCount: Math.max(0, asInt(record.wrongCount) ?? 0),
    correctStreak: Math.max(0, asInt(record.correctStreak) ?? 0),
    priority: Math.min(3, Math.max(0, asInt(record.priority) ?? 0)),
    intervalDays: Math.max(1, asInt(record.intervalDays) ?? 1),
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
    entries: mistakes.map((mistake) => ({
      ...mistake,
      options: [...mistake.options]
    }))
  };
  const sections = mistakes.map((mistake) => {
    const state = mistake.status === 'resolved' ? '已掌握' : `下次复习 ${mistake.due}`;
    return [
      `## ${mistake.questionId} · ${mistake.prompt}`,
      '',
      `- 错误次数：${mistake.wrongCount}`,
      `- 优先级：${mistake.priority}`,
      `- 间隔：${mistake.intervalDays} 天`,
      `- ${state}`
    ].join('\n');
  });
  const body = [`# ${workspaceId} 错题本`, '', ...sections, ''].join('\n');
  return serializeNote(meta, body);
}
