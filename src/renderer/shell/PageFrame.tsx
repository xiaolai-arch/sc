import type { ReactNode } from 'react';
import { MenuIcon } from '../ui/icons';

type PageFrameProps = {
  title: string;
  subtitle?: string;
  onOpenSidebar?: () => void;
  action?: ReactNode;
  children: ReactNode;
};

/** One main page beside the single navigation column. */
export function PageFrame({
  title,
  subtitle,
  onOpenSidebar,
  action,
  children
}: PageFrameProps) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-[#131315]">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] dark:border-white/10 px-4 md:px-5">
        <div className="flex min-w-0 items-center gap-2">
          {onOpenSidebar ? (
            <button
              type="button"
              aria-label="打开导航"
              onClick={onOpenSidebar}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 dark:text-[#8e8e93] transition-colors duration-150 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-black dark:hover:text-[#f5f5f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 md:hidden"
            >
              <MenuIcon className="h-4 w-4" />
            </button>
          ) : null}
          <span className="text-[13px] font-medium text-black dark:text-[#f5f5f7]">{title}</span>
          {subtitle ? (
            <>
              <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">/</span>
              <span className="truncate text-[11px] text-gray-500 dark:text-[#8e8e93]">
                {subtitle}
              </span>
            </>
          ) : null}
        </div>
        {action}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto w-full max-w-[980px]">{children}</div>
      </div>
    </div>
  );
}
