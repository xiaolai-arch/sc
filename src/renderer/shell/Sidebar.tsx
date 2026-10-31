import { cn } from '../ui/cn';
import { FolderIcon, MoonIcon, SettingsIcon, SunIcon } from '../ui/icons';
import type { ShellView } from './types';

type SidebarProps = {
  view: ShellView;
  onViewChange: (view: ShellView) => void;
  onReview: () => void;
  subjects: string[];
  subjectFilter: string | null;
  onSelectSubject: (subject: string | null) => void;
};

const subjectDotClasses = [
  'bg-[#0071e3]',
  'bg-[#34c759]',
  'bg-[#ff9f0a]',
  'bg-[#a13ff6]'
];

const recentDays = [
  { label: '10月30日', progress: '2/3' },
  { label: '10月29日', progress: '3/3' },
  { label: '10月28日', progress: '1/2' }
];

function navClass(active: boolean) {
  return cn(
    'flex min-h-8 shrink-0 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 md:w-full',
    active ? 'bg-black/[0.06] text-black' : 'text-gray-600 hover:bg-black/[0.04] hover:text-black'
  );
}

export function Sidebar({
  view,
  onViewChange,
  onReview,
  subjects,
  subjectFilter,
  onSelectSubject
}: SidebarProps) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-black/[0.06] bg-[#f5f5f7] md:h-full md:w-[236px] md:border-b-0 md:border-r">
      <div aria-hidden="true" className="hidden items-center gap-1.5 px-4 pt-4 md:flex">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5 md:px-4 md:py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#1d1d1f] text-[11px] font-semibold text-white">
          S
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-black">Study Coach</span>
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:items-stretch md:overflow-visible md:px-3">
        <button
          type="button"
          onClick={() => onViewChange('today')}
          aria-current={view === 'today' ? 'page' : undefined}
          className={navClass(view === 'today')}
        >
          <SunIcon className="h-4 w-4" />
          今日
        </button>
        <button type="button" onClick={onReview} className={navClass(false)}>
          <MoonIcon className="h-4 w-4" />
          复盘
        </button>
        <button
          type="button"
          onClick={() => onViewChange('settings')}
          aria-current={view === 'settings' ? 'page' : undefined}
          className={navClass(view === 'settings')}
        >
          <SettingsIcon className="h-4 w-4" />
          设置
        </button>
      </nav>

      <div className="hidden min-h-0 flex-1 overflow-y-auto px-3 pb-3 md:block">
        <p className="px-2.5 pb-1 pt-3 text-[11px] font-medium text-gray-500">科目</p>
        <button
          type="button"
          onClick={() => onSelectSubject(null)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors duration-150',
            subjectFilter === null ? 'bg-black/[0.06] text-black' : 'text-gray-600 hover:bg-black/[0.04]'
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#c7c7cc]" />
          全部科目
        </button>
        {subjects.map((subject, index) => (
          <button
            key={subject}
            type="button"
            onClick={() => onSelectSubject(subject)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors duration-150',
              subjectFilter === subject ? 'bg-black/[0.06] text-black' : 'text-gray-600 hover:bg-black/[0.04]'
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', subjectDotClasses[index % subjectDotClasses.length])} />
            {subject}
          </button>
        ))}

        <p className="px-2.5 pb-1 pt-4 text-[11px] font-medium text-gray-500">最近</p>
        {recentDays.map((day) => (
          <div
            key={day.label}
            className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-gray-600"
          >
            <span className="flex min-w-0 items-center gap-2">
              <FolderIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <span className="truncate">{day.label}</span>
            </span>
            <span className="shrink-0 text-[11px] text-gray-400">{day.progress}</span>
          </div>
        ))}
      </div>

      <div className="hidden items-center gap-2 border-t border-black/[0.06] px-3 py-3 md:flex">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1d1d1f] text-[11px] font-semibold text-white">
          x
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-gray-600">xiaolai</span>
        <button
          type="button"
          onClick={() => onViewChange('settings')}
          aria-label="打开设置"
          className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-black/[0.04] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
