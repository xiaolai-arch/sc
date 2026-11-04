import type { WeeklyOverview as WeeklyOverviewData } from '../../shared/weekly-stats';

type WeeklyOverviewProps = {
  overview: WeeklyOverviewData;
};

function formatDay(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}月${day}日`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-gray-400 dark:text-[#8e8e93]">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
        {value}
      </dd>
    </div>
  );
}

/** Compact week-at-a-glance card shown above the review history. */
export function WeeklyOverview({ overview }: WeeklyOverviewProps) {
  const accuracy =
    overview.accuracy === null
      ? '—'
      : `${Math.round(overview.accuracy * 100)}%（${overview.correct}/${overview.answered}）`;

  return (
    <section className="mb-4 rounded-2xl border border-gray-200/70 bg-white px-4 py-3.5 dark:border-white/10 dark:bg-[#1c1c1e]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
          本周概览
        </h2>
        <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">
          {formatDay(overview.weekStart)} - {formatDay(overview.weekEnd)}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Stat label="任务完成" value={`${overview.tasksDone} / ${overview.tasksTotal}`} />
        <Stat label="专注时长" value={`${overview.focusMinutes} 分钟`} />
        <Stat label="答题正确率" value={accuracy} />
        <Stat label="本周复盘" value={`${overview.reviewedDays} 天`} />
        <Stat label="待复习错题" value={`${overview.dueMistakes} 道`} />
        <Stat
          label="知识主题"
          value={`${overview.learningTopics} 在学 · ${overview.masteredTopics} 已掌握`}
        />
      </dl>
      {overview.weakestTopic ? (
        <p className="mt-3 text-[12px] text-gray-500 dark:text-[#a1a1a6]">
          薄弱主题：{overview.weakestTopic}
        </p>
      ) : null}
    </section>
  );
}
