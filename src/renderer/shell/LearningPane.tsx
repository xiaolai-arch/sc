import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { BookOpenIcon, CheckIcon, TargetIcon } from '../ui/icons';
import { Progress } from '../ui/Progress';
import { cn } from '../ui/cn';
import type { Workspace, WorkspaceNote } from '../../shared/workspace';
import type {
  PracticeMistake,
  PracticeSet,
  SubmitAnswerInput,
  SubmitAnswerResult
} from '../../shared/practice';

type LearningPaneProps = {
  set: PracticeSet | null;
  workspace: Workspace | null;
  notes: WorkspaceNote[];
  mistakes: PracticeMistake[];
  onSubmitAnswer: (input: SubmitAnswerInput) => Promise<SubmitAnswerResult>;
  onOpenChat: () => void;
  onOpenNote: (id: string) => void;
};

export function LearningPane({
  set,
  workspace,
  notes,
  mistakes,
  onSubmitAnswer,
  onOpenChat,
  onOpenNote
}: LearningPaneProps) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<SubmitAnswerResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIndex(0);
    setSelected(null);
    setResult(null);
    setChecking(false);
    setScore(0);
    setFinished(false);
    setError(null);
  }, [set?.id]);

  if (!set) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-[#131315]">
        <header className="flex h-11 shrink-0 items-center border-b border-black/[0.06] dark:border-white/10 px-4 md:px-5">
          <span className="text-[13px] font-medium text-black dark:text-[#f5f5f7]">学习</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
          <div className="mx-auto w-full max-w-[720px]">
            <div className="rounded-xl border border-black/[0.06] dark:border-white/10 bg-[#fafafa] dark:bg-[#1c1c1e] p-5">
              <p className="text-[14px] font-medium text-black dark:text-[#f5f5f7]">这个工作区还没有练习。</p>
              <p className="mt-1 text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
                可以让管家当老师讲解，或者先从相关记录开始。
              </p>
              <Button className="mt-4" size="sm" onClick={onOpenChat}>
                去问管家
              </Button>
            </div>
            {mistakes.length > 0 ? (
              <div className="mt-6 rounded-xl border border-black/[0.06] dark:border-white/10 p-4">
                <p className="text-[11px] font-medium text-gray-500 dark:text-[#8e8e93]">错题本 · {mistakes.length} 道待复习</p>
                <ul className="mt-2 space-y-1.5">
                  {mistakes.slice(0, 4).map((mistake) => (
                    <li key={mistake.id} className="text-[12px] leading-5 text-gray-600 dark:text-[#a1a1a6]">
                      {mistake.prompt}
                      <span className="ml-1 text-[10px] text-gray-400 dark:text-[#8e8e93]">（{mistake.due} 复习）</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {notes.length > 0 ? (
              <div className="mt-6">
                <p className="text-[11px] font-medium text-gray-500 dark:text-[#8e8e93]">相关记录</p>
                <div className="mt-2 space-y-1">
                  {notes.slice(0, 4).map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => onOpenNote(note.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] text-[#0071e3] dark:text-[#4da3ff] transition-colors duration-150 hover:bg-[#f7f7f8] dark:hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
                    >
                      <BookOpenIcon className="h-3.5 w-3.5" />
                      {note.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const question = set.questions[index];
  const answered = result !== null;
  const correct = result?.correct === true;
  const last = index === set.questions.length - 1;

  async function check() {
    if (selected === null || answered || checking) return;
    setChecking(true);
    setError(null);
    try {
      const submitted = await onSubmitAnswer({ questionId: question.id, choice: selected });
      setResult(submitted);
      if (submitted.correct) setScore((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交答案失败，请重试。');
    } finally {
      setChecking(false);
    }
  }

  function next() {
    if (last) {
      setFinished(true);
      return;
    }
    setIndex((current) => current + 1);
    setSelected(null);
    setResult(null);
    setError(null);
  }

  function restart() {
    setIndex(0);
    setSelected(null);
    setResult(null);
    setChecking(false);
    setScore(0);
    setFinished(false);
    setError(null);
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-[#131315]">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] dark:border-white/10 px-4 md:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[13px] font-medium text-black dark:text-[#f5f5f7]">学习</span>
          <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">/</span>
          <span className="truncate text-[11px] text-gray-500 dark:text-[#8e8e93]">{set.title}</span>
        </div>
        <Button size="sm" variant="secondary" onClick={onOpenChat}>
          问管家
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto w-full max-w-[720px]">
          {finished ? (
            <div className="rounded-xl border border-black/[0.06] dark:border-white/10 bg-[#fafafa] dark:bg-[#1c1c1e] p-6 text-center">
              <p className="text-[14px] font-medium text-black dark:text-[#f5f5f7]">练习完成</p>
              <p className="mt-2 text-[28px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">
                {score} / {set.questions.length}
              </p>
              <p className="mt-1 text-[12px] text-gray-500 dark:text-[#8e8e93]">
                {score === set.questions.length ? '全对，继续保持。' : '错题已经记下来，晚点复盘再看一遍。'}
              </p>
              {mistakes.length > 0 ? (
                <p className="mt-1 text-[11px] text-gray-500 dark:text-[#8e8e93]">
                  错题本还有 {mistakes.length} 道待复习。
                </p>
              ) : null}
              <div className="mt-4 flex justify-center gap-2">
                <Button size="sm" onClick={restart}>
                  再练一次
                </Button>
                <Button size="sm" variant="secondary" onClick={onOpenChat}>
                  问管家
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 text-[11px] text-gray-500 dark:text-[#8e8e93]">
                <span className="inline-flex items-center gap-1.5">
                  <TargetIcon className="h-3.5 w-3.5" />
                  {set.subject}
                </span>
                <span>
                  {index + 1} / {set.questions.length}
                </span>
              </div>
              <div className="mt-2">
                <Progress value={index + 1} max={set.questions.length} ariaLabel="练习进度" />
              </div>

              <h1 className="mt-6 text-[17px] font-semibold leading-7 tracking-tight text-black dark:text-[#f5f5f7]">
                {question.prompt}
              </h1>

              <div className="mt-4 space-y-2">
                {question.options.map((option, optionIndex) => {
                  const isCorrect = answered && optionIndex === result.answer;
                  const isWrong = answered && optionIndex === selected && !result?.correct;
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={answered || checking}
                      onClick={() => setSelected(optionIndex)}
                      aria-pressed={selected === optionIndex}
                      aria-label={`${String.fromCharCode(65 + optionIndex)}. ${option}`}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-[13px] leading-6 transition-colors duration-150 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30',
                        isCorrect
                          ? 'border-[#34c759]/30 bg-[#f2fbf4] dark:bg-[#12301c] text-black dark:text-[#f5f5f7]'
                          : isWrong
                            ? 'border-[#d70015]/20 bg-[#fdf3f2] dark:bg-[#3a1c1e] text-black dark:text-[#f5f5f7]'
                            : selected === optionIndex
                              ? 'border-[#0071e3]/30 bg-[#f2f7fd] dark:bg-[#16202b] text-black dark:text-[#f5f5f7]'
                              : 'border-black/[0.06] dark:border-white/10 bg-white dark:bg-[#242426] text-gray-600 dark:text-[#a1a1a6] hover:bg-[#fafafa] dark:hover:bg-white/[0.06]'
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-black/[0.08] dark:border-white/10 text-[10px] font-medium text-gray-500 dark:text-[#8e8e93]"
                      >
                        {String.fromCharCode(65 + optionIndex)}
                      </span>
                      <span>{option}</span>
                      {isCorrect ? <CheckIcon className="ml-auto h-4 w-4 shrink-0 text-[#34c759]" /> : null}
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
                <div className="mt-4 rounded-xl border border-black/[0.06] dark:border-white/10 bg-[#fafafa] dark:bg-[#1c1c1e] px-3 py-3">
                  <p className={cn('text-[12px] font-medium', correct ? 'text-[#1d7f3c]' : 'text-[#d70015] dark:text-[#ff7b72]')}>
                    {correct ? '回答正确' : '回答错误'}
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-gray-600 dark:text-[#a1a1a6]">{result.explanation}</p>
                  {result.mistake?.status === 'active' ? (
                    <p className="mt-2 text-[11px] text-gray-500 dark:text-[#8e8e93]" role="status">
                      已加入错题本，{result.mistake.due} 复习。
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-5 flex gap-2">
                <Button size="sm" disabled={selected === null || answered || checking} onClick={() => void check()}>
                  {checking ? '正在提交…' : '检查答案'}
                </Button>
                {answered ? (
                  <Button size="sm" variant="secondary" onClick={next}>
                    {last ? '完成练习' : '下一题'}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
