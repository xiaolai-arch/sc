import { cn } from './cn';

export type AppView = 'today' | 'settings';

const tabs: Array<{ view: AppView; label: string }> = [
  { view: 'today', label: '今日' },
  { view: 'settings', label: '设置' }
];

export function Nav({ view, onChange }: { view: AppView; onChange: (view: AppView) => void }) {
  return (
    <nav className="bg-white">
      <div className="mx-auto flex min-h-16 max-w-[980px] items-center justify-between gap-8 px-6 md:px-8">
        <span className="text-xl font-semibold tracking-tight text-black md:text-2xl">Study Coach</span>
        <div className="flex items-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.view}
              type="button"
              onClick={() => onChange(tab.view)}
              aria-current={view === tab.view ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-medium transition-all duration-300 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none',
                view === tab.view ? 'bg-[#f5f5f7] text-black' : 'text-gray-600'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
