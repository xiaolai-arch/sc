import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { BookOpenIcon, CheckIcon, TargetIcon } from '../ui/icons';
import { Progress } from '../ui/Progress';
import { cn } from '../ui/cn';
import type { PracticeSet, Workspace, WorkspaceNote } from './demoData';
import { shellPaneClass } from './TaskListPane';

type PracticeListProps = {
  sets: PracticeSet[];
  workspaces: Workspace[];
  selectedSetId: string | null;
  onSelectSet: (id: string) => void;
  showWorkspace: boolean;
};

export function PracticeList({
  sets,
  workspaces,
  selectedSetId,
  onSelectSet,
  showWorkspace
}: PracticeListProps) {
  return (
    <aside className={shellPaneClass}>
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-black/[0.06] px-4">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-black">学习</span>
          <span className="rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px] text-gray-500">
            {sets.length}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {sets.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-gray-500">这个工作区还没有练习。</p>
        ) : (
          sets.map((set) => {
            const workspace = workspaces.find((item) => item.id === set.workspaceId);
            return (
              <button
                key={set.id}
                type="button"
                onClick={() => onSelectSet(set.id)}
                aria-current={selectedSetId === set.id ? 'true' : undefined}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150',
                  selectedSetId === set.id ? 'bg-[#f0f0f2]' : 'hover:bg-[#f7f7f8]'
                )}
              >
                <TargetIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-black">{set.title}</span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
                    {showWorkspace && workspace ? (
                      <>
                        <span>{workspace.name}</span>
                        <span>·</span>
                      </>
                    ) : null}
                    <span>{set.subject}</span>
                    <span>·</span>
                    <span>{set.questions.length} 题</span>
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

type LearningPaneProps = {
  set: PracticeSet | null;
  workspace: Workspace | null;
  notes: WorkspaceNote[];
  onOpenChat: () => void;
  onOpenNote: (id: string) => void;
};

export function LearningPane({ set, workspace, notes, onOpenChat, onOpenNote }: LearningPaneProps) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [wrongAdded, setWrongAdded] = useState(false);

  useEffect(() => {
    setIndex(0);
    setSelected(null);
    setChecked(false);
    setScore(0);
    setFinished(false);
    setWrongAdded(false);
  }, [set?.id]);

  if (!set) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
        <header className="flex h-11 shrink-0 items-center border-b border-black/[0.06] px-4 md:px-5">
          <span className="text-[13px] font-medium text-black">学习</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
          <div className="mx-auto w-full max-w-[720px]">
            <div className="rounded-xl border border-black/[0.06] bg-[#fafafa] p-5">
              <p className="text-[14px] font-medium text-black">这个工作区还没有练习。</p>
              <p className="mt-1 text-[12px] leading-5 text-gray-500">
                可以让管家当老师讲解，或者先从相关记录开始。
              </p>
              <Button className="mt-4" size="sm" onClick={onOpenChat}>
                去问管家
              </Button>
            </div>
            {notes.length > 0 ? (
              <div className="mt-6">
                <p className="text-[11px] font-medium text-gray-500">相关记录</p>
                <div className="mt-2 space-y-1">
                  {notes.slice(0, 4).map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => onOpenNote(note.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] text-[#0071e3] transition-colors duration-150 hover:bg-[#f7f7f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
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
  const correct = selected === question.answer;
  const last = index === set.questions.length - 1;

  function check() {
    if (selected === null || checked) return;
    setChecked(true);
    if (selected === question.answer) setScore((current) => current + 1);
  }

  function next() {
    if (last) {
      setFinished(true);
      return;
    }
    setIndex((current) => current + 1);
    setSelected(null);
    setChecked(false);
    setWrongAdded(false);
  }

  function restart() {
    setIndex(0);
    setSelected(null);
    setChecked(false);
    setScore(0);
    setFinished(false);
    setWrongAdded(false);
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] px-4 md:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[13px] font-medium text-black">学习</span>
          <span className="text-[11px] text-gray-400">/</span>
          <span className="truncate text-[11px] text-gray-500">{set.title}</span>
        </div>
        <Button size="sm" variant="secondary" onClick={onOpenChat}>
          问管家
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto w-full max-w-[720px]">
          {finished ? (
            <div className="rounded-xl border border-black/[0.06] bg-[#fafafa] p-6 text-center">
              <p className="text-[14px] font-medium text-black">练习完成</p>
              <p className="mt-2 text-[28px] font-semibold tracking-tight text-black">
                {score} / {set.questions.length}
              </p>
              <p className="mt-1 text-[12px] text-gray-500">
                {score === set.questions.length ? '全对，继续保持。' : '错题已经记下来，晚点复盘再看一遍。'}
              </p>
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
              <div className="flex items-center justify-between gap-3 text-[11px] text-gray-500">
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

              <h1 className="mt-6 text-[17px] font-semibold leading-7 tracking-tight text-black">
                {question.prompt}
              </h1>

              <div className="mt-4 space-y-2">
                {question.options.map((option, optionIndex) => {
                  const isCorrect = checked && optionIndex === question.answer;
                  const isWrong = checked && optionIndex === selected && optionIndex !== question.answer;
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={checked}
                      onClick={() => setSelected(optionIndex)}
                      aria-pressed={selected === optionIndex}
                      aria-label={`${String.fromCharCode(65 + optionIndex)}. ${option}`}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-[13px] leading-6 transition-colors duration-150 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30',
                        isCorrect
                          ? 'border-[#34c759]/30 bg-[#f2fbf4] text-black'
                          : isWrong
                            ? 'border-[#d70015]/20 bg-[#fdf3f2] text-black'
                            : selected === optionIndex
                              ? 'border-[#0071e3]/30 bg-[#f2f7fd] text-black'
                              : 'border-black/[0.06] bg-white text-gray-600 hover:bg-[#fafafa]'
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-black/[0.08] text-[10px] font-medium text-gray-500"
                      >
                        {String.fromCharCode(65 + optionIndex)}
                      </span>
                      <span>{option}</span>
                      {isCorrect ? <CheckIcon className="ml-auto h-4 w-4 shrink-0 text-[#34c759]" /> : null}
                    </button>
                  );
                })}
              </div>

              {checked ? (
                <div className="mt-4 rounded-xl border border-black/[0.06] bg-[#fafafa] px-3 py-3">
                  <p className={cn('text-[12px] font-medium', correct ? 'text-[#1d7f3c]' : 'text-[#d70015]')}>
                    {correct ? '回答正确' : '回答错误'}
                  </p>
                  <p className="mt-1 text-[12px] leading-5 text-gray-600">{question.explanation}</p>
                  {!correct && !wrongAdded ? (
                    <button
                      type="button"
                      onClick={() => setWrongAdded(true)}
                      className="mt-2 text-[11px] font-medium text-[#0071e3] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
                    >
                      加入错题本
                    </button>
                  ) : null}
                  {wrongAdded ? (
                    <p className="mt-2 text-[11px] text-gray-500" role="status">
                      已加入错题本（原型）。
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-5 flex gap-2">
                <Button size="sm" disabled={selected === null} onClick={check}>
                  检查答案
                </Button>
                {checked ? (
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
