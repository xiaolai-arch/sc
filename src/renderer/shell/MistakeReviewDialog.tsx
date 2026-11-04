import { useEffect, useState } from 'react';
import { friendlyErrorMessage } from '../../shared/errors';
import type {
  PracticeMistake,
  ReviewMistakeInput,
  SetMistakeResolvedInput,
  SubmitAnswerResult
} from '../../shared/practice';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { cn } from '../ui/cn';

type MistakeReviewDialogProps = {
  open: boolean;
  /** Mistakes to work through; the dialog closes after the last one. */
  queue: PracticeMistake[];
  onReview: (input: ReviewMistakeInput) => Promise<SubmitAnswerResult>;
  onResolve: (input: SetMistakeResolvedInput) => Promise<void>;
  onClose: () => void;
};

/**
 * Answers due mistakes directly from their stored snapshot, so reviewing still
 * works when the original practice set was edited or deleted.
 */
export function MistakeReviewDialog({
  open,
  queue,
  onReview,
  onResolve,
  onClose
}: MistakeReviewDialogProps) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<SubmitAnswerResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setSelected(null);
    setResult(null);
    setChecking(false);
    setResolving(false);
    setError(null);
  }, [open]);

  const mistake = queue[index] ?? null;
  if (!mistake) return null;
  const last = index === queue.length - 1;
  const answered = result !== null;

  async function check() {
    if (selected === null || answered || checking) return;
    setChecking(true);
    setError(null);
    try {
      const submitted = await onReview({ mistakeId: mistake!.id, choice: selected });
      setResult(submitted);
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '提交答案失败，请重试。'));
    } finally {
      setChecking(false);
    }
  }

  function next() {
    if (last) {
      onClose();
      return;
    }
    setIndex((current) => current + 1);
    setSelected(null);
    setResult(null);
    setError(null);
  }

  async function resolve() {
    if (resolving) return;
    setResolving(true);
    setError(null);
    try {
      await onResolve({ mistakeId: mistake!.id, resolved: true });
      next();
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '标记失败，请重试。'));
    } finally {
      setResolving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="复习错题">
      <div className="flex items-center justify-between gap-3 text-[12px] text-gray-500 dark:text-[#8e8e93]">
        <span>
          第 {index + 1} / {queue.length} 题
        </span>
        <span>到期 {mistake.due}</span>
      </div>

      <h3 className="mt-3 text-[16px] font-semibold leading-7 text-[#1d1d1f] dark:text-[#f5f5f7]">
        {mistake.prompt}
      </h3>

      <div className="mt-3 space-y-2">
        {mistake.options.map((option, optionIndex) => {
          const isCorrect = answered && optionIndex === result!.answer;
          const isWrong = answered && optionIndex === selected && !result!.correct;
          return (
            <button
              key={option}
              type="button"
              disabled={answered || checking}
              onClick={() => setSelected(optionIndex)}
              aria-pressed={selected === optionIndex}
              aria-label={`${String.fromCharCode(65 + optionIndex)}. ${option}`}
              className={cn(
                'flex w-full items-start gap-3 rounded-xl border px-4 py-2.5 text-left text-[13px] leading-6 transition-colors duration-200 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30',
                isCorrect
                  ? 'border-[#34c759]/30 bg-[#34c759]/10 text-black dark:text-[#f5f5f7]'
                  : isWrong
                    ? 'border-[#d70015]/20 bg-[#ff3b30]/10 text-black dark:text-[#f5f5f7]'
                    : selected === optionIndex
                      ? 'border-[#0071e3]/30 bg-[#0071e3]/5 text-black dark:text-[#f5f5f7]'
                      : 'border-gray-200/70 bg-white text-gray-500 hover:bg-[#f5f5f7] dark:border-white/10 dark:bg-[#242426] dark:text-[#a1a1a6] dark:hover:bg-white/[0.06]'
              )}
            >
              <span className="shrink-0 font-medium">
                {String.fromCharCode(65 + optionIndex)}.
              </span>
              <span>{option}</span>
            </button>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
          {error}
        </p>
      ) : null}

      {answered ? (
        <div className="mt-3 rounded-xl bg-[#f5f5f7] px-4 py-3 dark:bg-white/[0.06]">
          <p
            className={cn(
              'text-[13px] font-medium',
              result!.correct ? 'text-[#1d7f3a]' : 'text-[#d70015] dark:text-[#ff7b72]'
            )}
          >
            {result!.correct ? '回答正确' : '回答错误'}
          </p>
          {!result!.correct ? (
            <p className="mt-1 text-[12px] text-gray-500 dark:text-[#a1a1a6]">
              正确答案：{result!.answer + 1}. {mistake.options[result!.answer] ?? ''}
            </p>
          ) : null}
          {result!.explanation ? (
            <p className="mt-1 text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">
              {result!.explanation}
            </p>
          ) : null}
          <p className="mt-1 text-[12px] text-gray-500 dark:text-[#8e8e93]">
            {result!.mistake?.status === 'active'
              ? `下次复习 ${result!.due ?? result!.mistake.due}`
              : result!.mistake?.status === 'resolved'
                ? '这道错题已经掌握'
                : ''}
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        {!answered ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={checking || resolving}
            onClick={() => void resolve()}
          >
            {resolving ? '正在标记…' : '标记已掌握'}
          </Button>
        ) : null}
        {answered ? (
          <Button size="sm" onClick={next}>
            {last ? '完成' : '下一题'}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={selected === null || checking || resolving}
            onClick={() => void check()}
          >
            {checking ? '正在提交…' : '检查答案'}
          </Button>
        )}
      </div>
    </Dialog>
  );
}
