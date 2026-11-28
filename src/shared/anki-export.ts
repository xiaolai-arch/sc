import { isStubbornMistake, type PracticeMistake, type PracticeQuestion } from './practice';

/**
 * Anki-compatible TSV export (iter34 P2).
 *
 * Anki's text import understands a `#` header block, so a file written here
 * goes straight in with no converter: `#separator`, `#html`, `#columns`,
 * `#tags column` and `#deck`. Scheduling lives in Anki, never in the vault, so
 * no scheduling field is exported (see `SCHEDULING_FIELD_NAMES`).
 *
 * Two rules keep the file parseable:
 * - a cell's newline becomes `<br>` (`#html:true` makes Anki render it), while
 *   a bare CR is dropped — neither survives as a column break;
 * - a cell's tab becomes 全角空格, because a literal tab would split the row
 *   into more columns than the header declares.
 *
 * There is no quoting: TSV has no quote semantics and Anki splits on tabs.
 */

/** `#columns` header, in the same order every row is written. */
export const ANKI_COLUMNS = ['正面', '背面', '解析', '标签'] as const;

/**
 * Fields Anki owns. None of them may appear in an export — asserted by grep in
 * the tests, so a future field addition cannot silently leak into a file the
 * learner shares.
 */
export const SCHEDULING_FIELD_NAMES = [
  'wrongCount',
  'correctStreak',
  'priority',
  'intervalDays',
  'stabilityDays',
  'difficulty',
  'due'
] as const;

/** A tab inside a cell would add a column; the full-width space keeps one. */
const FULL_WIDTH_SPACE = '　';

/**
 * One cell, made safe for a TSV row. CRLF and LF both become `<br>`; a lone CR
 * has no meaning in Anki's HTML and is dropped rather than rendered.
 */
export function ankiCell(value: string | undefined): string {
  if (value === undefined) return '';
  return value
    .replace(/\r\n/g, '<br>')
    .replace(/\n/g, '<br>')
    .replace(/\r/g, '')
    .replace(/\t/g, FULL_WIDTH_SPACE);
}

/**
 * The deck name inside a header line. A cell turns newlines into `<br>`, but a
 * header line has no HTML context: a newline there would end the header block,
 * and `<br>` would be shown literally in the deck list. Newlines are removed
 * and tabs become a full-width space, keeping the line single and parseable.
 */
export function ankiDeckName(value: string): string {
  return value.replace(/\r\n/g, '').replace(/\n/g, '').replace(/\r/g, '').replace(/\t/g, FULL_WIDTH_SPACE);
}

/** The header block Anki's importer reads; it must be the file's first line. */
export function ankiHeader(deck: string): string[] {
  return [
    '#separator:tab',
    '#html:true',
    `#columns:${ANKI_COLUMNS.join('\t')}`,
    '#tags column:4',
    `#deck:${ankiDeckName(deck)}`
  ];
}

/** The front of a card: the prompt, with a choice question's options below it. */
export function ankiFront(question: Pick<PracticeQuestion, 'prompt' | 'kind' | 'options'>): string {
  const isChoice = (question.kind ?? 'choice') === 'choice';
  const prompt = question.prompt.trim();
  if (!isChoice || question.options.length === 0) return prompt;
  const options = question.options
    .map((option, index) => (option.trim() === '' ? '' : `${optionLetter(index)}. ${option.trim()}`))
    .filter((line) => line !== '');
  return [prompt, ...options].join('\n');
}

/** The back of a card: the letter for a choice, the reference answer for a short. */
export function ankiBack(
  question: Pick<PracticeQuestion, 'kind' | 'answer' | 'referenceAnswer'>
): string {
  const isChoice = (question.kind ?? 'choice') === 'choice';
  if (isChoice) return optionLetter(question.answer);
  return question.referenceAnswer?.trim() ?? '';
}

/** `A`, `B`, … — the same lettering the printed sheet uses. */
function optionLetter(index: number): string {
  return String.fromCharCode(65 + Math.max(0, Math.min(25, index)));
}

/**
 * Tags for a mistake card: the cause mark (when a cause was written), the
 * stubborn mark (the same predicate the UI renders) and the subject. A washed
 * clean question — `correctStreak >= 2` — carries no 顽疾 tag, because the
 * mark is a render-time condition, not stored state.
 */
export function ankiMistakeTags(mistake: PracticeMistake, subject: string | undefined): string[] {
  const tags = ['错因'];
  if (isStubbornMistake(mistake)) tags.push('顽疾');
  if (subject !== undefined && subject.trim() !== '') tags.push(`科目:${subject.trim()}`);
  return tags;
}

/** One row, four cells, always the same count as `ANKI_COLUMNS`. */
export function ankiRow(cells: readonly string[]): string {
  return cells.map(ankiCell).join('\t');
}

/** The analysis cell: the explanation, and a mistake's cause on its own line. */
export function ankiAnalysis(explanation: string | undefined, cause: string | undefined): string {
  const parts: string[] = [];
  const text = explanation?.trim() ?? '';
  if (text !== '') parts.push(text);
  const why = cause?.trim() ?? '';
  if (why !== '') parts.push(`错因：${why}`);
  return parts.join('\n');
}

/** A practice-set export: one row per question, tagged by subject. */
export function buildAnkiSetExport(input: {
  questions: readonly PracticeQuestion[];
  subject: string;
  deck: string;
}): string {
  const lines = ankiHeader(input.deck);
  for (const question of input.questions) {
    const tags = input.subject.trim() === '' ? [] : [`科目:${input.subject.trim()}`];
    lines.push(
      ankiRow([
        ankiFront(question),
        ankiBack(question),
        ankiAnalysis(question.explanation, undefined),
        tags.join(' ')
      ])
    );
  }
  return `${lines.join('\n')}\n`;
}

/** A mistake-book export, resolved against the sets that own the questions. */
export function buildAnkiMistakesExport(input: {
  mistakes: readonly PracticeMistake[];
  /** Subject per mistake id; absent entries fall back to no subject tag. */
  subjects?: Readonly<Record<string, string>>;
  /** The question each mistake refers to, or undefined when it is gone. */
  questions: Readonly<Record<string, PracticeQuestion | undefined>>;
  deck: string;
}): string {
  const lines = ankiHeader(input.deck);
  for (const mistake of input.mistakes) {
    const question = input.questions[mistake.id];
    if (question === undefined) continue;
    lines.push(
      ankiRow([
        ankiFront(question),
        ankiBack(question),
        ankiAnalysis(question.explanation, mistake.cause),
        ankiMistakeTags(mistake, input.subjects?.[mistake.id]).join(' ')
      ])
    );
  }
  return `${lines.join('\n')}\n`;
}
