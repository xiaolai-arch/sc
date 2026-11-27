import { PRACTICE_DURATION_CAP_MS, type PracticeAttempt, type PracticeSet } from '../../shared/practice';
import { ACCURACY_TREND_WEEKS } from './accuracy-trend';
import { fluencyTrend, FLUENCY_MIN_RECORDS } from './fluency-trend';
import { formatWholePaperSpan } from './focus-timer';

type FluencyTrendProps = {
  attempts: readonly PracticeAttempt[];
  /** Set titles for the per-set rows; an unknown id falls back to the raw id. */
  sets: readonly PracticeSet[];
  today: Date;
};

/**
 * 每套题的「中位用时」趋势与自动召回占比，与正确率趋势同层。Bars scale
 * against the 60 s answer-time cap — deliberately no 及格线 mark (用趋势不用
 * 及格线), and nothing here renders while a question is being answered.
 */
export function FluencyTrend({ attempts, sets, today }: FluencyTrendProps) {
  const data = fluencyTrend(attempts, today);
  const currentIndex = ACCURACY_TREND_WEEKS - 1;
  const titleOf = (setId: string) => sets.find((set) => set.id === setId)?.title ?? setId;

  return (
    <section
      aria-label="用时流畅度"
      className="mb-4 rounded-2xl border border-gray-200/70 bg-white px-4 py-3.5 dark:border-white/10 dark:bg-[#1c1c1e]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
          用时流畅度
        </h2>
        <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">最近 8 周</span>
      </div>
      {data.sets.length > 0 ? (
        data.sets.map((set) => (
          <div
            key={set.setId}
            aria-label={`用时趋势：${titleOf(set.setId)}`}
            className="mt-3 rounded-xl bg-[#f5f5f7] px-3.5 py-3 dark:bg-white/[0.06]"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="min-w-0 truncate text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                {titleOf(set.setId)}
              </p>
              <p className="shrink-0 text-[11px] text-gray-500 dark:text-[#8e8e93]">
                {set.medianMs !== null ? `中位用时 ${formatWholePaperSpan(set.medianMs)}` : ''}
                {set.autoRecallShare !== null
                  ? ` · 自动召回 ${Math.round(set.autoRecallShare * 100)}%`
                  : ' · 自动召回占比 —'}
              </p>
            </div>
            <div className="mt-2.5 flex items-end gap-2">
              {set.weekMedians.map((medianMs, index) => (
                <div key={index} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <div className="flex h-16 w-full items-end justify-center">
                    {medianMs === null ? (
                      <span
                        role="img"
                        aria-label="该周无有效用时记录"
                        className="h-0.5 w-3/5 rounded-full bg-black/[0.08] dark:bg-white/[0.12]"
                      />
                    ) : (
                      <span
                        role="img"
                        aria-label={`中位用时 ${formatWholePaperSpan(medianMs)}`}
                        title={`中位用时 ${formatWholePaperSpan(medianMs)}`}
                        style={{
                          height: `${Math.min(100, (medianMs / PRACTICE_DURATION_CAP_MS) * 100)}%`
                        }}
                        className={`w-3/5 rounded-t-[3px] ${
                          index === currentIndex
                            ? 'bg-[#0071e3] dark:bg-[#0a84ff]'
                            : 'bg-[#0071e3]/60 dark:bg-[#0a84ff]/60'
                        }`}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      ) : (
        <p className="mt-3 text-[12px] text-gray-500 dark:text-[#a1a1a6]">
          最近 8 周还没有足够的用时记录：同一套题答满 {FLUENCY_MIN_RECORDS} 道后，这里会按周显示中位用时与自动召回占比。
        </p>
      )}
    </section>
  );
}
