import { useEffect, useRef, useState } from 'react';
import { cn } from '../ui/cn';
import { formatLocalDate } from '../../shared/date';
import {
  FolderIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon
} from '../ui/icons';
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
  onRenameConversation: (id: string, title: string) => void;
  onTogglePinned: (id: string, pinned: boolean) => void;
  onDeleteConversation: (id: string) => void;
  onSearchConversations: (query: string) => Promise<ConversationSummary[]>;
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

const menuItemClass =
  'flex w-full items-center rounded-md px-2 py-1.5 text-left text-[11px] text-[#3c3c3f] hover:bg-[#f1eee8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30';

export function ConversationSidebar({
  conversations,
  projects,
  activeConversationId,
  selectedProjectId,
  onNewConversation,
  onSelectConversation,
  onSelectProject,
  onOpenSettings,
  onRenameConversation,
  onTogglePinned,
  onDeleteConversation,
  onSearchConversations
}: ConversationSidebarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ConversationSummary[] | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void onSearchConversations(trimmed)
        .then((next) => {
          if (!cancelled) setResults(next);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, onSearchConversations]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (menuOpenId === null) return undefined;
    function dismiss() {
      setMenuOpenId(null);
      setConfirmDeleteId(null);
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      dismiss();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') dismiss();
    }
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpenId]);

  const projectName = (id: string | undefined) =>
    projects.find((project) => project.id === id)?.name;
  const searching = query.trim().length > 0;
  const visibleConversations = results ?? conversations;

  function closeMenu() {
    setMenuOpenId(null);
    setConfirmDeleteId(null);
  }

  function startRename(conversation: ConversationSummary) {
    setRenamingId(conversation.id);
    setRenameText(conversation.title);
    closeMenu();
  }

  function commitRename(id: string) {
    const trimmed = renameText.trim();
    if (trimmed.length > 0) onRenameConversation(id, trimmed);
    setRenamingId(null);
    setRenameText('');
  }

  function togglePin(conversation: ConversationSummary) {
    onTogglePinned(conversation.id, !conversation.pinned);
    closeMenu();
  }

  function requestDelete(conversation: ConversationSummary) {
    if (confirmDeleteId === conversation.id) {
      onDeleteConversation(conversation.id);
      closeMenu();
      return;
    }
    setConfirmDeleteId(conversation.id);
  }

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

      <div className="px-3 pb-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9a9a9e]" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索对话 ⌘K"
            aria-label="搜索对话"
            className="h-8 w-full rounded-lg border border-black/[0.08] bg-white pl-7 pr-2 text-[11px] text-[#1d1d1f] outline-none placeholder:text-[#9a9a9e] focus:border-[#0071e3]/40 focus:ring-2 focus:ring-[#0071e3]/20"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-2.5 pb-1 pt-2 text-[10px] font-medium tracking-wide text-[#9a9a9e]">
          最近对话
        </p>
        {searching && visibleConversations.length === 0 ? (
          <p className="px-2.5 py-2 text-[11px] leading-5 text-[#9a9a9e]">没有找到对话。</p>
        ) : visibleConversations.length === 0 ? (
          <p className="px-2.5 py-2 text-[11px] leading-5 text-[#9a9a9e]">
            还没有对话。告诉管家你想做什么。
          </p>
        ) : (
          <div className="space-y-0.5">
            {visibleConversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              const project = projectName(conversation.workspaceId);
              if (renamingId === conversation.id) {
                return (
                  <div key={conversation.id} className="px-1 py-1">
                    <input
                      autoFocus
                      value={renameText}
                      maxLength={24}
                      aria-label="对话标题"
                      onChange={(event) => setRenameText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitRename(conversation.id);
                        } else if (event.key === 'Escape') {
                          setRenamingId(null);
                          setRenameText('');
                        }
                      }}
                      className="h-8 w-full rounded-lg border border-[#0071e3]/40 bg-white px-2 text-[12px] text-[#1d1d1f] outline-none focus:ring-2 focus:ring-[#0071e3]/20"
                    />
                  </div>
                );
              }
              return (
                <div key={conversation.id} className="group relative">
                  <button
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      closeMenu();
                      onSelectConversation(conversation.id);
                    }}
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
                          {conversation.pinned ? '📌 ' : ''}
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

                  <button
                    type="button"
                    ref={menuOpenId === conversation.id ? menuButtonRef : undefined}
                    aria-label="对话操作"
                    aria-haspopup="menu"
                    aria-expanded={menuOpenId === conversation.id}
                    onClick={() =>
                      setMenuOpenId((current) => {
                        setConfirmDeleteId(null);
                        return current === conversation.id ? null : conversation.id;
                      })
                    }
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md text-[#8a8a8e] opacity-0 transition-opacity hover:bg-black/[0.05] hover:text-black focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 group-hover:opacity-100"
                  >
                    <MoreHorizontalIcon className="h-3.5 w-3.5" />
                  </button>

                  {menuOpenId === conversation.id ? (
                    <div
                      ref={menuRef}
                      role="menu"
                      className="absolute right-1 top-7 z-10 w-28 rounded-lg border border-black/[0.08] bg-white p-1 shadow-lg"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className={menuItemClass}
                        onClick={() => startRename(conversation)}
                      >
                        重命名
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={menuItemClass}
                        onClick={() => togglePin(conversation)}
                      >
                        {conversation.pinned ? '取消置顶' : '置顶'}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className={cn(
                          menuItemClass,
                          confirmDeleteId === conversation.id ? 'text-[#d70015]' : ''
                        )}
                        onClick={() => requestDelete(conversation)}
                      >
                        {confirmDeleteId === conversation.id ? '确认删除' : '删除'}
                      </button>
                    </div>
                  ) : null}
                </div>
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
