import { cn } from '../ui/cn';
import {
  BookOpenIcon,
  CalendarIcon,
  FolderIcon,
  MoonIcon,
  SettingsIcon,
  SparklesIcon,
  TargetIcon
} from '../ui/icons';
import type { Workspace } from './demoData';
import type { ShellView } from './types';

type SidebarProps = {
  view: ShellView;
  onViewChange: (view: ShellView) => void;
  workspaceId: string | null;
  onWorkspaceChange: (workspaceId: string | null) => void;
  workspaces: Workspace[];
};

const navItems: Array<{ view: ShellView; label: string; Icon: typeof SparklesIcon }> = [
  { view: 'chat', label: '管家', Icon: SparklesIcon },
  { view: 'plan', label: '计划', Icon: CalendarIcon },
  { view: 'notes', label: '记录', Icon: BookOpenIcon },
  { view: 'learn', label: '学习', Icon: TargetIcon },
  { view: 'review', label: '复盘', Icon: MoonIcon },
  { view: 'settings', label: '设置', Icon: SettingsIcon }
];

const recentItems = [
  { label: '今天 · 3 条记录', meta: '记录' },
  { label: '10月30日 · 复盘', meta: '复盘' },
  { label: '10月29日 · 复盘', meta: '复盘' }
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
  workspaceId,
  onWorkspaceChange,
  workspaces
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
        {navItems.map(({ view: itemView, label, Icon }) => (
          <button
            key={itemView}
            type="button"
            onClick={() => onViewChange(itemView)}
            aria-current={view === itemView ? 'page' : undefined}
            className={navClass(view === itemView)}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </nav>

      <div className="hidden min-h-0 flex-1 overflow-y-auto px-3 pb-3 md:block">
        <p className="px-2.5 pb-1 pt-3 text-[11px] font-medium text-gray-500">工作区</p>
        <button
          type="button"
          onClick={() => onWorkspaceChange(null)}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors duration-150',
            workspaceId === null ? 'bg-black/[0.06] text-black' : 'text-gray-600 hover:bg-black/[0.04]'
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#8e8e93]" />
          全部工作区
        </button>
        {workspaces.map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            onClick={() => onWorkspaceChange(workspace.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors duration-150',
              workspaceId === workspace.id
                ? 'bg-black/[0.06] text-black'
                : 'text-gray-600 hover:bg-black/[0.04]'
            )}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: workspace.color }}
            />
            {workspace.name}
          </button>
        ))}

        <p className="px-2.5 pb-1 pt-4 text-[11px] font-medium text-gray-500">最近</p>
        {recentItems.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-gray-600"
          >
            <span className="flex min-w-0 items-center gap-2">
              <FolderIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <span className="truncate">{item.label}</span>
            </span>
            <span className="shrink-0 text-[11px] text-gray-400">{item.meta}</span>
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
