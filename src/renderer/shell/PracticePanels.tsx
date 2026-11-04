import { useState } from 'react';
import type {
  PracticeAttempt,
  PracticeMistake,
  PracticeSet
} from '../../shared/practice';

type MistakeBookProps = {
  mistakes: PracticeMistake[];
  /** Mistake ids that are due today. */
  dueIds?: ReadonlySet<string>;
  onReview?: (mistake: PracticeMistake) => void;
  onReviewAll?: () => void;
  onResolve?: (mistake: PracticeMistake) => void;
};

type MistakeRowProps = {
  mistake: PracticeMistake;
  due: boolean;
  onReview?: (mistake: PracticeMistake) => void;
  onResolve?: (mistake: PracticeMistake) => void;
};

const rowActionClass =
  'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-[#0071e3] transition-colors duration-200 hover:bg-[#0071e3]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#4da3ff] dark:hover:bg-[#0a84ff]/20';

function MistakeRow({ mistake, due, onReview, onResolve }: MistakeRowProps) {
  return (
    <li className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">
          {mistake.prompt}
        </p>
        <p className="text-[11px] text-gray-400 dark:text-[#8e8e93]">
          {due ? '今天复习 · ' : ''}
          {mistake.due} 复习 · 错 {mistake.wrongCount} 次 · 优先级 {mistake.priority}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onReview ? (
          <button
            type="button"
            aria-label={`复习错题：${mistake.prompt}`}
            onClick={() => onReview(mistake)}
            className={rowActionClass}
          >
            复习
          </button>
        ) : null}
        {onResolve ? (
          <button
            type="button"
            aria-label={`标记已掌握：${mistake.prompt}`}
            onClick={() => onResolve(mistake)}
            className={rowActionClass}
          >
            已掌握
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** Compact mistake preview that can expand into the full review list. */
export function MistakeBook({
  mistakes,
  dueIds,
  onReview,
  onReviewAll,
  onResolve
}: MistakeBookProps) {
  const [expanded, setExpanded] = useState(false);

  if (mistakes.length === 0) return null;
  const dueCount = dueIds ? mistakes.filter((mistake) => dueIds.has(mistake.id)).length : 0;

  return (
    <div className="mt-6 rounded-2xl bg-[#f5f5f7] p-5 dark:bg-white/[0.06]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-gray-500 dark:text-[#8e8e93]">
          错题本 · {mistakes.length} 道待复习
          {dueCount > 0 ? (
            <span className="ml-2 rounded-full bg-[#ff9f0a]/15 px-2 py-0.5 text-[11px] text-[#8a5a00] dark:text-[#ffb340]">
              今天到期 {dueCount} 道
            </span>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {onReviewAll && dueCount > 0 ? (
            <button
              type="button"
              onClick={onReviewAll}
              className="rounded-full bg-[#0071e3] px-3 py-1 text-[11px] font-medium text-white transition-opacity duration-200 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
            >
              复习今天到期的 {dueCount} 道
            </button>
          ) : null}
          {mistakes.length > 4 ? (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="rounded-full px-1 text-[12px] font-medium text-[#0071e3] transition-colors duration-200 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#4da3ff]"
            >
              {expanded ? '收起' : '查看全部错题'}
            </button>
          ) : null}
        </div>
      </div>

      <ul className="mt-2 space-y-2.5">
        {(expanded ? mistakes : mistakes.slice(0, 4)).map((mistake) => (
          <MistakeRow
            key={mistake.id}
            mistake={mistake}
            due={dueIds?.has(mistake.id) === true}
            {...(onReview ? { onReview } : {})}
            {...(onResolve ? { onResolve } : {})}
          />
        ))}
      </ul>
    </div>
  );
}

type AttemptHistoryProps = {
  attempts?: PracticeAttempt[];
  set: PracticeSet | null;
  mistakes: PracticeMistake[];
};

function formatAttemptDate(value: string): string {
  const matched = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value);
  return matched ? `${matched[1]} ${matched[2]}` : value;
}

/** Collapsible answer history; prompt text is resolved when the data allows it. */
export function AttemptHistory({ attempts, set, mistakes }: AttemptHistoryProps) {
  const [expanded, setExpanded] = useState(true);

  if (!attempts || attempts.length === 0) return null;

  const ordered = [...attempts].sort(
    (a, b) => b.answeredAt.localeCompare(a.answeredAt) || b.id.localeCompare(a.id)
  );

  return (
    <section className="mt-6">
      <button
        type="button"
        aria-label="答题历史"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2 rounded-xl text-left text-[12px] font-medium text-gray-500 transition-colors duration-200 hover:bg-[#f5f5f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#8e8e93] dark:hover:bg-white/[0.06]"
      >
        <span>答题历史</span>
        <span aria-hidden="true">· {attempts.length} 次</span>
        <span aria-hidden="true" className="ml-auto text-[#0071e3] dark:text-[#4da3ff]">
          {expanded ? '收起' : '展开'}
        </span>
      </button>

      {expanded ? (
        <ul className="mt-2 space-y-2">
          {ordered.map((attempt) => {
            const question =
              set && set.id === attempt.setId
                ? set.questions.find((entry) => entry.id === attempt.questionId)
                : undefined;
            const mistake = mistakes.find(
              (entry) =>
                entry.setId === attempt.setId && entry.questionId === attempt.questionId
            );
            const prompt = question?.prompt ?? mistake?.prompt;
            const setTitle = set && set.id === attempt.setId ? set.title : attempt.setId;

            return (
              <li
                key={attempt.id}
                className="rounded-xl bg-[#f5f5f7] px-4 py-3 dark:bg-white/[0.06]"
              >
                <div className="flex items-center gap-2 text-[11px] text-gray-400 dark:text-[#8e8e93]">
                  <span>{formatAttemptDate(attempt.answeredAt)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{setTitle}</span>
                  <span
                    className={
                      attempt.correct
                        ? 'ml-auto shrink-0 font-medium text-[#1d7f3a]'
                        : 'ml-auto shrink-0 font-medium text-[#d70015] dark:text-[#ff7b72]'
                    }
                  >
                    {attempt.correct ? '回答正确' : '回答错误'}
                  </span>
                </div>
                {prompt ? (
                  <p className="mt-1 text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">
                    {prompt}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
