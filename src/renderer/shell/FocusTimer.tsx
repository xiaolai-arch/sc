import { useEffect, useState } from 'react';
import { MAX_TASK_NEXT_STEP_LENGTH } from '../../shared/workspace';
import { focusProgress, formatFocusTime, type FocusSession } from './focus-timer';

type FocusRestorePrompt = {
  label: string;
};

type FocusTimerProps = {
  session: FocusSession | null;
  notice: string | null;
  /** The one-time restore prompt for an interrupted session (iter33 P2b①). */
  restore: FocusRestorePrompt | null;
  canStart: boolean;
  onStartDefault: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onRestoreContinue: () => void;
  onRestoreDismiss: () => void;
  /**
   * The stop/abandon flow (iter33 P2b②): ends the session; a non-null text
   * is written to the bound task's `nextStep` first, null skips the write.
   */
  onAbandon: (nextStep: string | null) => void;
};

const controlClass =
  'rounded-full px-2.5 py-1 text-[13px] font-medium text-gray-500 transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:bg-black/[0.04] hover:text-black hover:opacity-80 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#a1a1a6] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]';

export function FocusTimer({
  session,
  notice,
  restore,
  canStart,
  onStartDefault,
  onPause,
  onResume,
  onReset,
  onRestoreContinue,
  onRestoreDismiss,
  onAbandon
}: FocusTimerProps) {
  const progress = session ? focusProgress(session.remainingMs) : 0;
  // The abandon flow's one-line 下一步 ask. Local to the card: it only ever
  // lives between the 放弃 click and the 保存/跳过 click.
  const [askingNextStep, setAskingNextStep] = useState(false);
  const [nextStepDraft, setNextStepDraft] = useState('');
  useEffect(() => {
    // A session that ends (settled, reset, restored) closes the ask.
    if (!session) {
      setAskingNextStep(false);
      setNextStepDraft('');
    }
  }, [session !== null]);

  function submitNextStep(skip: boolean) {
    const text = nextStepDraft.trim();
    onAbandon(skip || text === '' ? null : text);
    setAskingNextStep(false);
    setNextStepDraft('');
  }

  return (
    <div className="mb-4 rounded-2xl bg-[#f5f5f7] p-4 dark:bg-white/[0.06]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">专注计时</span>
        {session ? (
          <span className="text-[20px] font-semibold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">
            {formatFocusTime(session.remainingMs)}
          </span>
        ) : null}
      </div>

      {session ? (
        <>
          <p className="mt-1 truncate text-[12px] text-gray-500 dark:text-[#a1a1a6]">{session.taskTitle}</p>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="mt-2 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10"
          >
            <div
              className="h-full rounded-full bg-[#0071e3] transition-[width] duration-300 motion-reduce:transition-none"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="mt-2 flex items-center gap-1">
            {session.running ? (
              <button type="button" onClick={onPause} className={controlClass}>
                暂停
              </button>
            ) : (
              <button
                type="button"
                onClick={onResume}
                disabled={session.remainingMs === 0}
                className={controlClass}
              >
                继续
              </button>
            )}
            <button type="button" onClick={onReset} className={controlClass}>
              重置
            </button>
            {!askingNextStep ? (
              <button
                type="button"
                onClick={() => setAskingNextStep(true)}
                className={controlClass}
              >
                放弃
              </button>
            ) : null}
          </div>
          {askingNextStep ? (
            <form
              aria-label="放弃专注"
              className="mt-2"
              onSubmit={(event) => {
                event.preventDefault();
                submitNextStep(false);
              }}
            >
              <input
                aria-label="下一步"
                placeholder="记下下一步（可跳过）：一句话、可执行"
                maxLength={MAX_TASK_NEXT_STEP_LENGTH}
                value={nextStepDraft}
                onChange={(event) => setNextStepDraft(event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12px] text-[#1d1d1f] outline-none focus:border-[#0071e3] dark:border-white/10 dark:bg-white/[0.08] dark:text-[#f5f5f7]"
              />
              <div className="mt-1 flex items-center gap-1">
                <button type="submit" className={controlClass}>
                  保存并放弃
                </button>
                <button type="button" onClick={() => submitNextStep(true)} className={controlClass}>
                  直接放弃
                </button>
              </div>
            </form>
          ) : null}
        </>
      ) : (
        <div className="mt-2">
          <p className="text-[12px] text-gray-500 dark:text-[#8e8e93]">选一个任务，开始 25 分钟专注。</p>
          <button
            type="button"
            onClick={onStartDefault}
            disabled={!canStart}
            className="mt-2 rounded-full bg-[#0071e3] px-3 py-1.5 text-[13px] font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            开始专注
          </button>
        </div>
      )}

      {restore && !session ? (
        <div role="status" className="mt-2 rounded-xl bg-white/70 p-2.5 dark:bg-white/[0.08]">
          <p className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7]">{restore.label}</p>
          <div className="mt-1.5 flex items-center gap-1">
            <button type="button" onClick={onRestoreContinue} className={controlClass}>
              继续
            </button>
            <button type="button" onClick={onRestoreDismiss} className={controlClass}>
              不要了
            </button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="mt-2 text-[12px] text-[#0071e3] dark:text-[#4da3ff]">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
