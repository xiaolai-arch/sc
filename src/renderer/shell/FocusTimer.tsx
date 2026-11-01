import { focusProgress, formatFocusTime, type FocusSession } from './focus-timer';

type FocusTimerProps = {
  session: FocusSession | null;
  notice: string | null;
  canStart: boolean;
  onStartDefault: () => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
};

const controlClass =
  'rounded px-1.5 py-0.5 text-[10px] text-[#6b6b70] dark:text-[#a1a1a6] transition-colors hover:bg-black/[0.05] dark:hover:bg-white/[0.06] hover:text-black dark:hover:text-[#f5f5f7] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30';

export function FocusTimer({
  session,
  notice,
  canStart,
  onStartDefault,
  onPause,
  onResume,
  onReset
}: FocusTimerProps) {
  const progress = session ? focusProgress(session.remainingMs) : 0;

  return (
    <div className="mb-3 rounded-lg border border-[#e5e1da] dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">专注计时</span>
        {session ? (
          <span className="text-[18px] font-semibold tabular-nums text-[#1d1d1f] dark:text-[#f5f5f7]">
            {formatFocusTime(session.remainingMs)}
          </span>
        ) : null}
      </div>

      {session ? (
        <>
          <p className="mt-1 truncate text-[10px] text-[#6b6b70] dark:text-[#a1a1a6]">{session.taskTitle}</p>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            className="mt-2 h-1 overflow-hidden rounded-full bg-[#ece9e4] dark:bg-white/10"
          >
            <div
              className="h-full rounded-full bg-[#0071e3] transition-[width] duration-300"
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
          </div>
        </>
      ) : (
        <div className="mt-2">
          <p className="text-[10px] text-[#8a8a8e] dark:text-[#8e8e93]">选一个任务，开始 25 分钟专注。</p>
          <button
            type="button"
            onClick={onStartDefault}
            disabled={!canStart}
            className="mt-1 rounded-md bg-[#0071e3] px-2 py-1 text-[10px] font-medium text-white disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
          >
            开始专注
          </button>
        </div>
      )}

      {notice ? (
        <p role="status" className="mt-2 text-[10px] text-[#0071e3] dark:text-[#4da3ff]">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
