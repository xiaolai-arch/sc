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
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-[#0f0f10]">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-gray-200/70 px-4 dark:border-white/10 md:px-8">
        <div className="flex min-w-0 items-center gap-2">
          {onOpenSidebar ? (
            <button
              type="button"
              aria-label="打开导航"
              onClick={onOpenSidebar}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:opacity-80 hover:text-black active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7] md:hidden"
            >
              <MenuIcon className="h-4 w-4" />
            </button>
          ) : null}
          <span className="text-[20px] font-semibold tracking-tight text-black md:text-[22px] dark:text-[#f5f5f7]">
            {title}
          </span>
          {subtitle ? (
            <>
              <span className="text-[13px] text-gray-400 dark:text-[#8e8e93]">/</span>
              <span className="truncate text-[13px] text-gray-500 dark:text-[#8e8e93]">
                {subtitle}
              </span>
            </>
          ) : null}
        </div>
        {action}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10 md:px-8 md:py-12">
        <div className="mx-auto w-full max-w-[980px]">{children}</div>
      </div>
    </div>
  );
}
