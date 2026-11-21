import type { PracticeAttempt } from '../../shared/practice';
import { accuracyTrend } from './accuracy-trend';

type AccuracyTrendProps = {
  attempts: readonly PracticeAttempt[];
  today: Date;
};

/** Eight week columns, one bar per week scaled by accuracy (0–100%). */
export function AccuracyTrend({ attempts, today }: AccuracyTrendProps) {
  const data = accuracyTrend(attempts, today);
  const currentIndex = data.weeks.length - 1;

  return (
    <section
      aria-label="正确率趋势"
      className="mb-4 rounded-2xl border border-gray-200/70 bg-white px-4 py-3.5 dark:border-white/10 dark:bg-[#1c1c1e]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
          正确率趋势
        </h2>
        <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">最近 8 周</span>
      </div>
      {data.hasData ? (
        <>
          <div className="mt-3 flex items-end gap-2">
            {data.weeks.map((week, index) => (
              <div
                key={week.weekStart}
                className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
              >
                <div className="flex h-20 w-full items-end justify-center">
                  {week.accuracy === null ? (
                    <span
                      role="img"
                      aria-label={week.label}
                      title={week.label}
                      className="h-0.5 w-3/5 rounded-full bg-black/[0.08] dark:bg-white/[0.12]"
                    />
                  ) : (
                    <span
                      role="img"
                      aria-label={week.label}
                      title={week.label}
                      style={{ height: `${week.accuracy * 100}%` }}
                      className={`w-3/5 rounded-t-[3px] ${
                        index === currentIndex
                          ? 'bg-[#0071e3] dark:bg-[#0a84ff]'
                          : 'bg-[#0071e3]/60 dark:bg-[#0a84ff]/60'
                      }`}
                    />
                  )}
                </div>
                <span className="text-[10px] text-gray-400 dark:text-[#8e8e93]">
                  {week.caption}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-[11px] text-gray-400 dark:text-[#8e8e93]">{data.summary}</p>
        </>
      ) : (
        <p className="mt-3 text-[12px] text-gray-500 dark:text-[#a1a1a6]">
          最近 8 周还没有练习记录：答几道题后，这里会按周汇总正确率。
        </p>
      )}
    </section>
  );
}
