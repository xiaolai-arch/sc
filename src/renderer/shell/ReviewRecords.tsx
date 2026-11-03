import { useState } from 'react';
import type { ReviewRecord } from '../../shared/ipc';
import type { Workspace } from '../../shared/workspace';
import { cn } from '../ui/cn';

type ReviewRecordsProps = {
  workspaces: Workspace[];
  /** Current filter; null means every workspace plus global reviews. */
  workspace: Workspace | null;
  reviews: ReviewRecord[];
  onPrompt: (prompt: string) => void;
};

const linkButtonClass =
  'rounded-full px-3 py-1.5 text-[13px] font-medium text-[#0071e3] transition-all duration-300 hover:bg-[#0071e3]/10 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#4da3ff] dark:hover:bg-[#0a84ff]/20';

const expandButtonClass =
  'shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium text-[#0071e3] transition-colors hover:bg-[#0071e3]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#4da3ff] dark:hover:bg-[#0a84ff]/20';

/** Review history with per-record expand/collapse and workspace filtering. */
export function ReviewRecords({
  workspaces,
  workspace,
  reviews,
  onPrompt
}: ReviewRecordsProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const filteredReviews = reviews.filter(
    (review) => !workspace || review.workspaceId === workspace.id
  );

  const toggle = (key: string) => {
    setExpanded((current) => ({ ...current, [key]: !current[key] }));
  };

  if (filteredReviews.length === 0) {
    const hasOtherWorkspaces = Boolean(workspace) && reviews.length > 0;
    return (
      <div>
        <div className="rounded-2xl border border-dashed border-gray-300/80 px-4 py-6 text-center dark:border-white/10">
          <p className="text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
            {hasOtherWorkspaces && workspace
              ? `「${workspace.name}」还没有复盘记录。`
              : '还没有复盘记录。'}
          </p>
          {hasOtherWorkspaces ? (
            <p className="mt-1 text-[12px] leading-5 text-gray-400 dark:text-[#8e8e93]">
              其他工作区还有 {reviews.length} 条复盘，切换上方筛选即可查看。
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => onPrompt('我们开始今天复盘')}
            className={cn('mt-3', linkButtonClass)}
          >
            开始今天复盘
          </button>
        </div>
        <button
          type="button"
          onClick={() => onPrompt('我们开始今天复盘')}
          className={cn('mt-3', linkButtonClass)}
        >
          开始复盘
        </button>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-3 text-[16px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
        最近复盘
      </h3>
      <div className="space-y-3">
        {filteredReviews.map((review, index) => {
          const key = `${review.date}-${review.submittedAt}`;
          const isExpanded = expanded[key] === true;
          const isLatest = index === 0;
          const workspaceName = review.workspaceId
            ? workspaces.find((entry) => entry.id === review.workspaceId)?.name ?? '项目复盘'
            : '全局复盘';

          return (
            <article
              key={key}
              className={
                isLatest
                  ? 'rounded-2xl bg-white p-5 shadow-sm dark:bg-[#1c1c1e]'
                  : 'rounded-2xl border border-gray-100 p-4 dark:border-white/10'
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {review.date}
                  </span>
                  {isLatest ? (
                    <span className="rounded-full bg-[#0071e3]/10 px-2 py-0.5 text-[11px] font-medium text-[#0071e3] dark:bg-[#0a84ff]/20 dark:text-[#4da3ff]">
                      最近一次
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500 dark:text-[#8e8e93]">
                    {workspaceName}
                  </span>
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? '收起' : '展开'} ${review.date} 的复盘全文`}
                    onClick={() => toggle(key)}
                    className={expandButtonClass}
                  >
                    {isExpanded ? '收起' : '展开'}
                  </button>
                </div>
              </div>
              <div className="mt-2 space-y-1">
                <p
                  className={cn(
                    'text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]',
                    !isExpanded && 'line-clamp-2'
                  )}
                >
                  完成：{review.completed || '—'}
                </p>
                <p
                  className={cn(
                    'text-[13px] leading-6 text-[#d70015] dark:text-[#ff7b72]',
                    !isExpanded && 'line-clamp-1'
                  )}
                >
                  卡点：{review.stuck || '—'}
                </p>
                <p
                  className={cn(
                    'text-[13px] leading-6 text-[#0071e3] dark:text-[#4da3ff]',
                    !isExpanded && 'line-clamp-1'
                  )}
                >
                  明天：{review.tomorrow || '—'}
                </p>
              </div>
            </article>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onPrompt('我们开始今天复盘')}
        className={cn('mt-3', linkButtonClass)}
      >
        开始复盘
      </button>
    </div>
  );
}
