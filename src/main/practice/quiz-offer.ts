import type { PracticeMistake } from '../../shared/practice';

/**
 * One proactive practice offer for the 今日 page.
 *
 * Decision rules, evaluated in order (kept deterministic so tests can pin the
 * exact output):
 *
 * 1. Cooldown — `daysSinceLastOffer === 0` (already offered today) means null,
 *    whatever the data says. The caller supplies the stored last-offer date;
 *    this module owns no storage.
 * 2. `due-mistakes` — at least 3 active mistakes have `due <= today`
 *    (overdue included), so the spaced-repetition book itself says there is
 *    work waiting. The offer names the real due count: `你有 N 道到期错题，抽
 *    5 分钟做 3 道？`.
 * 3. `low-accuracy` — otherwise, when the last 8 weeks hold at least 10
 *    answered attempts with accuracy below 60%: `最近 8 周正确率 K%，做 3 道
 *    找找手感？`. Fewer than 10 answers means there is not enough signal to
 *    call the accuracy low.
 * 4. Anything else stays silent — the page never invents a reason to quiz.
 *
 * `due-mistakes` wins when both reasons apply: concrete due work beats a
 * general trend. `mistakes` must be the active-only list the practice service
 * returns (`getMistakes`); resolved records would inflate the due count.
 */
export interface QuizOffer {
  reason: 'due-mistakes' | 'low-accuracy';
  text: string;
}

export interface QuizOfferInput {
  today: string;
  mistakes: readonly PracticeMistake[];
  /** Percent over the 8-week window; null when nothing was answered yet. */
  recentAccuracy: number | null;
  /** Attempts recorded inside the same 8-week window. */
  recentAnswered: number;
  /** Days since the offer last showed; 0 = already offered today. */
  daysSinceLastOffer?: number | null;
}

export function quizOffer(input: QuizOfferInput): QuizOffer | null {
  if (input.daysSinceLastOffer === 0) return null;
  const dueCount = input.mistakes.filter((mistake) => mistake.due <= input.today).length;
  if (dueCount >= 3) {
    return {
      reason: 'due-mistakes',
      text: `你有 ${dueCount} 道到期错题，抽 5 分钟做 3 道？`
    };
  }
  if (
    input.recentAnswered >= 10 &&
    input.recentAccuracy !== null &&
    input.recentAccuracy < 60
  ) {
    return {
      reason: 'low-accuracy',
      text: `最近 8 周正确率 ${input.recentAccuracy}%，做 3 道找找手感？`
    };
  }
  return null;
}
