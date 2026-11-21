import type { WorkspaceTask } from '../../shared/workspace';
import { studyHeatmap, type HeatmapCell } from './heatmap';

type StudyHeatmapProps = {
  tasks: readonly WorkspaceTask[];
  today: Date;
};

/** Colour buckets in the app palette: accent-alpha steps, light and dark. */
const CELL_CLASSES: Record<HeatmapCell['level'], string> = {
  0: 'bg-black/[0.05] dark:bg-white/[0.08]',
  1: 'bg-[#0071e3]/25 dark:bg-[#0a84ff]/30',
  2: 'bg-[#0071e3]/55 dark:bg-[#0a84ff]/60',
  3: 'bg-[#0071e3] dark:bg-[#0a84ff]'
};

const CELL_SIZE = 'h-[11px] w-[11px] rounded-[2px]';

/** GitHub-style 12-week grid of recorded study minutes for the 复盘 page. */
export function StudyHeatmap({ tasks, today }: StudyHeatmapProps) {
  const data = studyHeatmap(tasks, today);

  return (
    <section
      aria-label="学习热力图"
      className="mb-4 rounded-2xl border border-gray-200/70 bg-white px-4 py-3.5 dark:border-white/10 dark:bg-[#1c1c1e]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
          学习热力图
        </h2>
        <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">最近 12 周</span>
      </div>
      {data.hasData ? (
        <>
          <div className="mt-3 flex w-fit gap-[3px] overflow-x-auto">
            {data.columns.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-col gap-[3px]">
                {week.map((cell, dayIndex) =>
                  cell ? (
                    <span
                      key={cell.date}
                      role="img"
                      aria-label={cell.label}
                      title={cell.label}
                      className={`${CELL_SIZE} ${CELL_CLASSES[cell.level]}`}
                    />
                  ) : (
                    <span key={`pad-${dayIndex}`} aria-hidden="true" className={CELL_SIZE} />
                  )
                )}
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-[11px] text-gray-400 dark:text-[#8e8e93]">{data.summary}</p>
            <div aria-hidden="true" className="flex items-center gap-[3px]">
              <span className="mr-0.5 text-[10px] text-gray-400 dark:text-[#8e8e93]">少</span>
              {[0, 1, 2, 3].map((level) => (
                <span
                  key={level}
                  className={`h-[9px] w-[9px] rounded-[2px] ${
                    CELL_CLASSES[level as HeatmapCell['level']]
                  }`}
                />
              ))}
              <span className="ml-0.5 text-[10px] text-gray-400 dark:text-[#8e8e93]">多</span>
            </div>
          </div>
        </>
      ) : (
        <p className="mt-3 text-[12px] text-gray-500 dark:text-[#a1a1a6]">
          还没有学习时长记录：完成带计时的任务后，这里会按天汇总最近 12 周。
        </p>
      )}
    </section>
  );
}
