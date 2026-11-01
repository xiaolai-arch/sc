import { cn } from '../ui/cn';
import { formatLocalDate } from '../../shared/date';
import { FolderIcon, PlusIcon, SettingsIcon } from '../ui/icons';
import type { ConversationSummary } from '../../shared/conversations';
import type { Workspace } from '../../shared/workspace';

type ConversationSidebarProps = {
  conversations: ConversationSummary[];
  projects: Workspace[];
  activeConversationId: string | null;
  selectedProjectId: string | null;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onSelectProject: (id: string) => void;
  onOpenSettings: () => void;
};

function timeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = formatLocalDate(new Date());
  if (formatLocalDate(date) === today) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function ConversationSidebar({
  conversations,
  projects,
  activeConversationId,
  selectedProjectId,
  onNewConversation,
  onSelectConversation,
  onSelectProject,
  onOpenSettings
}: ConversationSidebarProps) {
  const projectName = (id: string | undefined) =>
    projects.find((project) => project.id === id)?.name;

  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-black/[0.06] bg-[#fbfbfa] md:h-full md:w-[220px] md:border-b-0 md:border-r md:border-[#e8e5e0]">
      <div aria-hidden="true" className="hidden items-center gap-1.5 px-4 pt-4 md:flex">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
      </div>

      <div className="flex items-center gap-2 px-4 pb-3 pt-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#1d1d1f] text-[11px] font-semibold text-white">
          S
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-black">Study Coach</span>
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onNewConversation}
          className="flex h-9 w-full items-center gap-2 rounded-lg bg-[#0071e3] px-3 text-[12px] font-semibold text-white transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
        >
          <PlusIcon className="h-4 w-4" />
          新对话
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-2.5 pb-1 pt-2 text-[10px] font-medium tracking-wide text-[#9a9a9e]">
          最近对话
        </p>
        {conversations.length === 0 ? (
          <p className="px-2.5 py-2 text-[11px] leading-5 text-[#9a9a9e]">
            还没有对话。告诉管家你想做什么。
          </p>
        ) : (
          <div className="space-y-0.5">
            {conversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              const project = projectName(conversation.workspaceId);
              return (
                <button
                  key={conversation.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onSelectConversation(conversation.id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30',
                    active ? 'bg-[#e9e6e0]' : 'hover:bg-[#f1eee8]'
                  )}
                >
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/80 text-[10px] text-[#6b6b70]">
                    {conversation.kind === 'check-in' ? '☾' : '✦'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="truncate text-[12px] font-medium text-[#1d1d1f]">
                        {conversation.title}
                      </span>
                      <span className="ml-auto shrink-0 text-[9px] text-[#9a9a9e]">
                        {timeLabel(conversation.updatedAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-[#8a8a8e]">
                      {conversation.preview || '还没有消息'}
                    </span>
                    {project ? (
                      <span className="mt-1 inline-block rounded-full bg-[#f1eee8] px-1.5 py-0.5 text-[9px] text-[#6b6b70]">
                        {project}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <p className="px-2.5 pb-1 pt-4 text-[10px] font-medium tracking-wide text-[#9a9a9e]">
          项目
        </p>
        {projects.length === 0 ? (
          <p className="px-2.5 py-2 text-[11px] leading-5 text-[#9a9a9e]">
            项目会由管家在对话里创建。
          </p>
        ) : (
          <div className="space-y-0.5">
            {projects.map((project) => {
              const active = project.id === selectedProjectId;
              return (
                <button
                  key={project.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onSelectProject(project.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30',
                    active ? 'bg-[#e9e6e0]' : 'hover:bg-[#f1eee8]'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[#3c3c3f]">
                    {project.name}
                  </span>
                  <FolderIcon className="h-3.5 w-3.5 shrink-0 text-[#9a9a9e]" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-[#eeeae4] px-3 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1d1d1f] text-[10px] text-white">
          x
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[#5f5f63]">xiaolai</span>
        <button
          type="button"
          aria-label="打开设置"
          onClick={onOpenSettings}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[#8a8a8e] transition-colors hover:bg-black/[0.04] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
