/**
 * CJK-aware tokenization for the search index.
 *
 * MiniSearch's default tokenizer splits on whitespace/punctuation, which turns
 * a whole Chinese sentence into one giant term — prefix search would only ever
 * match from the start of the sentence. Vault content is mostly Chinese, so we
 * emit CJK bigrams (so "代数" matches "线性代数" without matching everything
 * that merely contains 代 or 数); a lone CJK char stays a unigram. Single-char
 * queries still work because MiniSearch's prefix option matches "搜" against
 * the bigram "搜索". Latin/number runs are lowercased single terms.
 */

const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD_CHAR = /[\p{L}\p{N}]/u;

function isCjkChar(ch: string): boolean {
  return CJK_CHAR.test(ch);
}

function addCjkRun(run: string, tokens: Set<string>): void {
  if (run.length === 1) {
    tokens.add(run);
    return;
  }
  for (let i = 0; i + 1 < run.length; i += 1) {
    tokens.add(run.slice(i, i + 2));
  }
}

/** Splits text into indexable terms: latin/number runs (lowercased) and CJK unigrams+bigrams. */
export function tokenize(text: string): string[] {
  if (typeof text !== 'string') return [];
  const tokens = new Set<string>();
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (isCjkChar(ch)) {
      let end = i + 1;
      while (end < text.length && isCjkChar(text[end] as string)) end += 1;
      addCjkRun(text.slice(i, end), tokens);
      i = end;
    } else if (WORD_CHAR.test(ch)) {
      let end = i + 1;
      while (end < text.length && WORD_CHAR.test(text[end] as string)) end += 1;
      tokens.add(text.slice(i, end).toLowerCase());
      i = end;
    } else {
      i += 1;
    }
  }
  return [...tokens];
}

/**
 * Builds a short excerpt around the earliest literal occurrence of any query
 * term (falls back to the head of the text when nothing matches literally,
 * e.g. fuzzy hits). Whitespace is collapsed first so frontmatter/body
 * newlines don't eat the budget.
 */
export function buildSnippet(text: string, query: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) return '';
  const lower = normalized.toLowerCase();
  let hitStart = -1;
  let hitLength = 0;
  for (const term of tokenize(query.toLowerCase())) {
    if (term.length === 0) continue;
    const index = lower.indexOf(term);
    if (index >= 0 && (hitStart < 0 || index < hitStart)) {
      hitStart = index;
      hitLength = term.length;
    }
  }
  const tailSuffix = normalized.length > maxLength ? '…' : '';
  if (hitStart < 0) return `${normalized.slice(0, maxLength)}${tailSuffix}`;
  const start = Math.max(0, hitStart - 30);
  const excerpt = normalized.slice(start, start + maxLength);
  const prefix = start > 0 ? '…' : '';
  const suffix = start + maxLength < normalized.length ? '…' : '';
  return `${prefix}${excerpt}${suffix}`;
}
