/**
 * Printable mistake review sheet.
 *
 * The mistake book (`workspaces/<id>/practice/mistakes.md`) is a storage
 * format: options and answers live in the YAML frontmatter so the app can read
 * them back. This builder renders the same records as a human-facing sheet —
 * one heading per mistake, the options spelled out (choice) or the reference
 * answer (short), the answer, the explanation and the review state — that can
 * be printed or copied.
 *
 * The output is deterministic (same input, byte-identical text) and stays
 * Obsidian-readable: it uses the same `type: qa` frontmatter with its own
 * `kind`, so `parseMistakesFile` never mistakes a sheet for the mistake book.
 */

// `STRICT_MASTERY_NOTE` lives in `practice.ts` so the strict clause reads the
// same here and in the UI and cannot drift between surfaces.
import { STRICT_MASTERY_NOTE, isStubbornMistake, type PracticeMistake } from './practice';

/** Frontmatter `kind` that marks a review sheet; never `practice-mistakes`. */
export const MISTAKE_SHEET_KIND = 'practice-review-sheet';

/** The bucket a mistake falls into when its practice set (subject) is unknown. */
export const UNCATEGORIZED_SUBJECT = '未分类';

export interface MistakeSheetInput {
  workspaceId: string;
  /** Local calendar date (`YYYY-MM-DD`) shown in the title and frontmatter. */
  date: string;
  mistakes: readonly PracticeMistake[];
  /**
   * Subject of each mistake's practice set, keyed by `mistake.id`. Feeds the
   * per-subject summary line; a mistake with no entry (or a blank one) counts
   * as `未分类`. Omitting the map entirely renders no summary line, so callers
   * that never resolved subjects stay byte-identical to 1.3.0.
   */
  subjects?: Readonly<Record<string, string>>;
  /**
   * The opt-in stricter-mastery setting. When true the sheet states the rule
   * once under the title; false/absent renders nothing extra, so sheets written
   * before this setting stay byte-identical.
   */
  strict?: boolean;
}

// js-yaml quotes plain scalars that would otherwise resolve to another type
// (numbers, booleans, null, timestamps, hex/sexagesimal forms). Mirroring that
// keeps the frontmatter byte-for-byte in the same style as `serializeNote`.
const YAML_AMBIGUOUS =
  /^(?:true|false|null|yes|no|on|off|y|n|~|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[-+]?0[xXoObB][0-9a-fA-F]+|[-+]?\d[\d_]*(?::\d+)+|\d{4}-\d{1,2}-\d{1,2}(?:[Tt ].*)?)$/i;
const YAML_SPECIAL = /[:#,[\]{}&*!|>'"%@`\r\n\t]/;

function yamlScalar(value: string): string {
  if (value.trim() === '' || YAML_AMBIGUOUS.test(value) || YAML_SPECIAL.test(value)) {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return value;
}

function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** A prompt may span lines in storage; a heading must stay on one line. */
function singleLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

function mistakeSection(mistake: PracticeMistake, index: number): string {
  const state = mistake.status === 'resolved' ? '已掌握' : `下次复习 ${mistake.due}`;
  // A short question has no options to letter; its model answer is prose.
  const answerLine =
    mistake.kind === 'short'
      ? `参考答案：${singleLine(mistake.referenceAnswer ?? '')}`
      : `答案：${optionLetter(mistake.answer)}`;
  // Empty options are skipped, but letters keep their original position so the
  // answer letter still matches the option the learner actually picked.
  const options = mistake.options.flatMap((option, optionIndex) =>
    option.trim() === '' ? [] : [`${optionLetter(optionIndex)}. ${singleLine(option)}`]
  );
  // Both additions are conditional, so a record with no 错因 and without the
  // 顽疾 condition renders exactly the bytes 1.3.0 wrote.
  const causeLine =
    mistake.cause !== undefined && mistake.cause.trim() !== ''
      ? [`错因：${singleLine(mistake.cause)}`]
      : [];
  const stubborn = isStubbornMistake(mistake) ? ' · 顽疾' : '';
  return [
    `## ${index + 1}. ${singleLine(mistake.prompt)}`,
    '',
    ...(options.length > 0 ? [...options, ''] : []),
    answerLine,
    `解析：${singleLine(mistake.explanation)}`,
    ...causeLine,
    '',
    `错 ${mistake.wrongCount} 次 · 优先级 ${mistake.priority} · ${state}${stubborn}`
  ].join('\n');
}

/**
 * The per-subject counts for the summary line (iter34 P0 ③): `[[科目, 计数], …]`
 * in count-descending, then subject-name order. Counted from the same
 * `mistakes` array the sheet renders (never a second read); a mistake whose
 * subject is missing or blank counts as `未分类`.
 */
export function summarizeMistakeSubjects(
  mistakes: readonly PracticeMistake[],
  subjects: Readonly<Record<string, string>> = {}
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const mistake of mistakes) {
    const raw = subjects[mistake.id];
    const subject = raw !== undefined && raw.trim() !== '' ? raw.trim() : UNCATEGORIZED_SUBJECT;
    counts.set(subject, (counts.get(subject) ?? 0) + 1);
  }
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
}

/**
 * The one summary line, or null when it should not appear: fewer than two
 * distinct subjects, or nothing but `未分类`. The line itself joins the
 * `summarizeMistakeSubjects` pairs with ` · `.
 */
export function mistakeSubjectSummaryLine(
  mistakes: readonly PracticeMistake[],
  subjects?: Readonly<Record<string, string>>
): string | null {
  if (subjects === undefined) return null;
  const counts = summarizeMistakeSubjects(mistakes, subjects);
  if (counts.length < 2) return null;
  // `未分类` is not a real subject: all-uncategorized renders nothing.
  if (counts.every(([subject]) => subject === UNCATEGORIZED_SUBJECT)) return null;
  return counts.map(([subject, count]) => `${subject} ${count}`).join(' · ');
}

/** Renders the full markdown file: frontmatter, title, one section per mistake. */
export function buildMistakeSheet({
  workspaceId,
  date,
  mistakes,
  subjects,
  strict = false
}: MistakeSheetInput): string {
  const frontmatter = [
    '---',
    'type: qa',
    'source: user',
    `kind: ${MISTAKE_SHEET_KIND}`,
    `workspaceId: ${yamlScalar(workspaceId)}`,
    `generated: '${date}'`,
    `entries: ${mistakes.length}`,
    '---'
  ].join('\n');
  const sections = mistakes.map((mistake, index) => mistakeSection(mistake, index));
  const title = `# 错题复习单 · ${date}`;
  // The strict note is the only difference between modes; with it off the body
  // is exactly what earlier versions wrote.
  const heading = strict ? `${title}\n\n> ${STRICT_MASTERY_NOTE}` : title;
  // The subject summary sits under the title, before the first mistake, and only
  // when two or more real subjects are present.
  const summary = mistakeSubjectSummaryLine(mistakes, subjects);
  const intro = summary === null ? heading : `${heading}\n\n${summary}`;
  // A blank line before every `##` keeps the sections apart when printed.
  const body =
    sections.length === 0 ? `${intro}\n\n` : `${intro}\n\n${sections.join('\n\n')}\n`;
  return `${frontmatter}\n${body}`;
}
