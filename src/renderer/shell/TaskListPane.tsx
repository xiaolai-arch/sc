import { useState } from 'react';
import { cn } from '../ui/cn';
import { CheckIcon, ChevronRightIcon, SearchIcon } from '../ui/icons';
import type { Workspace, WorkspaceTask } from '../../shared/workspace';

export const shellPaneClass =
  'hidden h-full w-[300px] shrink-0 flex-col border-r border-black/[0.06] bg-white lg:flex';

function statusDotClass(status: WorkspaceTask['status']) {
  if (status === 'done') return 'bg-[#34c759]';
  if (status === 'in-progress') return 'bg-[#0071e3]';
  if (status === 'skipped') return 'bg-[#c7c7cc]';
  return 'bg-[#d1d1d6]';
}

type TaskListPaneProps = {
  tasks: WorkspaceTask[];
  workspaces: Workspace[];
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  title: string;
  showWorkspace: boolean;
};

export function TaskListPane({
  tasks,
  workspaces,
  selectedTaskId,
  onSelectTask,
  title,
  showWorkspace
}: TaskListPaneProps) {
  const [query, setQuery] = useState('');
  const visible = tasks.filter((task) => {
    const workspace = workspaces.find((item) => item.id === task.workspaceId);
    const haystack = `${task.title} ${task.subject} ${workspace?.name ?? ''}`.toLowerCase();
    return !query.trim() || haystack.includes(query.trim().toLowerCase());
  });

  return (
    <aside className={shellPaneClass}>
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-black/[0.06] px-4">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-black">{title}</span>
          <span className="rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px] text-gray-500">
            {tasks.length}
          </span>
        </div>
      </div>

      <div className="shrink-0 px-3 py-3">
        <div className="flex h-8 items-center gap-2 rounded-md bg-[#f5f5f7] px-2.5 text-gray-500">
          <SearchIcon className="h-3.5 w-3.5" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索任务"
            aria-label="搜索任务"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-[#1d1d1f] outline-none placeholder:text-gray-500"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {visible.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-gray-500">没有匹配的任务。</p>
        ) : (
          visible.map((task) => {
            const workspace = workspaces.find((item) => item.id === task.workspaceId);
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onSelectTask(task.id)}
                aria-current={selectedTaskId === task.id ? 'true' : undefined}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150',
                  selectedTaskId === task.id ? 'bg-[#f0f0f2]' : 'hover:bg-[#f7f7f8]'
                )}
              >
                <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', statusDotClass(task.status))} />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-[13px]',
                      task.status === 'done' ? 'text-gray-400 line-through' : 'text-black'
                    )}
                  >
                    {task.title}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
                    {showWorkspace && workspace ? (
                      <>
                        <span className="inline-flex items-center gap-1">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: workspace.color }}
                          />
                          {workspace.name}
                        </span>
                        <span>·</span>
                      </>
                    ) : null}
                    <span>{task.subject}</span>
                    <span>·</span>
                    <span>{task.durationMin} 分钟</span>
                    {task.status === 'in-progress' ? (
                      <span className="text-[10px] font-medium text-[#0071e3]">进行中</span>
                    ) : null}
                  </span>
                </span>
                {task.status === 'done' ? (
                  <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#34c759]" />
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

const settingsSections = [
  { id: 'settings-model-section', label: '模型' },
  { id: 'settings-budget', label: '预算' },
  { id: 'settings-notifications', label: '通知' },
  { id: 'settings-launch', label: '启动' }
];

export function SettingsList({ onSection }: { onSection: (id: string) => void }) {
  return (
    <aside className={shellPaneClass}>
      <div className="flex h-11 shrink-0 items-center border-b border-black/[0.06] px-4">
        <span className="text-[13px] font-medium text-black">设置</span>
      </div>
      <div className="px-2 py-3">
        {settingsSections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => onSection(section.id)}
            className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-[13px] text-gray-600 transition-colors duration-150 hover:bg-[#f7f7f8] hover:text-black"
          >
            {section.label}
            <ChevronRightIcon className="h-3.5 w-3.5 text-gray-400" />
          </button>
        ))}
      </div>
    </aside>
  );
}
