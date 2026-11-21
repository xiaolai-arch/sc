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

import type { PracticeMistake } from './practice';

/** Frontmatter `kind` that marks a review sheet; never `practice-mistakes`. */
export const MISTAKE_SHEET_KIND = 'practice-review-sheet';

export interface MistakeSheetInput {
  workspaceId: string;
  /** Local calendar date (`YYYY-MM-DD`) shown in the title and frontmatter. */
  date: string;
  mistakes: readonly PracticeMistake[];
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
  return [
    `## ${index + 1}. ${singleLine(mistake.prompt)}`,
    '',
    ...(options.length > 0 ? [...options, ''] : []),
    answerLine,
    `解析：${singleLine(mistake.explanation)}`,
    '',
    `错 ${mistake.wrongCount} 次 · 优先级 ${mistake.priority} · ${state}`
  ].join('\n');
}

/** Renders the full markdown file: frontmatter, title, one section per mistake. */
export function buildMistakeSheet({
  workspaceId,
  date,
  mistakes
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
  // A blank line before every `##` keeps the sections apart when printed.
  const body =
    sections.length === 0 ? `${title}\n\n` : `${title}\n\n${sections.join('\n\n')}\n`;
  return `${frontmatter}\n${body}`;
}
