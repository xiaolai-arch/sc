import { useEffect, useRef, useState } from 'react';
import { cn } from '../ui/cn';
import { formatLocalDate } from '../../shared/date';
import {
  BookOpenIcon,
  ClockIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  ThinkIcon
} from '../ui/icons';
import type { ConversationSummary } from '../../shared/conversations';
import type { Workspace } from '../../shared/workspace';

export type Section = 'chat' | 'projects' | 'memory' | 'review' | 'reminders' | 'settings';

type NavigationSidebarProps = {
  section: Section;
  conversations: ConversationSummary[];
  projects: Workspace[];
  activeConversationId: string | null;
  selectedProjectId: string | null;
  onSectionChange: (section: Section) => void;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onSelectProject: (id: string | null) => void;
  onRenameConversation: (id: string, title: string) => void;
  onTogglePinned: (id: string, pinned: boolean) => void;
  onDeleteConversation: (id: string) => void;
  onSearchConversations: (query: string) => Promise<ConversationSummary[]>;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
};

const NAV_ITEMS: Array<{ id: Section; label: string; Icon: typeof SparklesIcon }> = [
  { id: 'chat', label: '对话', Icon: SparklesIcon },
  { id: 'projects', label: '项目', Icon: FolderIcon },
  { id: 'memory', label: '记忆', Icon: ThinkIcon },
  { id: 'review', label: '复盘', Icon: BookOpenIcon },
  { id: 'reminders', label: '提醒', Icon: ClockIcon },
  { id: 'settings', label: '设置', Icon: SettingsIcon }
];

const PROJECT_SECTIONS: Section[] = ['projects', 'memory', 'review'];

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
  'flex w-full items-center rounded-xl px-2 py-2 text-left text-[13px] text-gray-700 transition-colors duration-200 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#a1a1a6] dark:hover:bg-white/[0.06]';

const contextHeadingClass =
  'px-2.5 pb-1 pt-2 text-[11px] font-medium tracking-wide text-gray-400 dark:text-[#8e8e93]';

export function NavigationSidebar({
  section,
  conversations,
  projects,
  activeConversationId,
  selectedProjectId,
  onSectionChange,
  onNewConversation,
  onSelectConversation,
  onSelectProject,
  onRenameConversation,
  onTogglePinned,
  onDeleteConversation,
  onSearchConversations,
  mobileOpen = false,
  onCloseMobile
}: NavigationSidebarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ConversationSummary[] | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingSearchFocusRef = useRef(false);
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
      if (!((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) return;
      event.preventDefault();
      if (section === 'chat') {
        searchRef.current?.focus();
        return;
      }
      pendingSearchFocusRef.current = true;
      onSectionChange('chat');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [section, onSectionChange]);

  useEffect(() => {
    if (section !== 'chat' || !pendingSearchFocusRef.current) return;
    pendingSearchFocusRef.current = false;
    searchRef.current?.focus();
  }, [section]);

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

  function conversationList() {
    return (
      <>
        <div className="px-1 pb-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-[#8e8e93]" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索对话 ⌘K"
              aria-label="搜索对话"
              className="h-9 w-full rounded-xl border-0 bg-white py-2 pl-7 pr-2 text-[13px] text-[#1d1d1f] outline-none transition-all duration-200 placeholder:text-gray-400 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
            />
          </div>
        </div>
        <p className={contextHeadingClass}>最近对话</p>
        {searching && visibleConversations.length === 0 ? (
          <p className="px-2.5 py-2 text-[12px] leading-5 text-gray-400 dark:text-[#8e8e93]">没有找到对话。</p>
        ) : visibleConversations.length === 0 ? (
          <p className="px-2.5 py-2 text-[12px] leading-5 text-gray-400 dark:text-[#8e8e93]">
            还没有对话。告诉阿咲你想做什么。
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
                      className="h-9 w-full rounded-xl border-0 bg-white px-3 text-[13px] text-[#1d1d1f] outline-none ring-2 ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
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
                      'flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30',
                      active ? 'bg-black/[0.06] dark:bg-white/[0.1]' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                    )}
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white dark:bg-white/[0.08] text-[11px] text-gray-500 dark:text-[#a1a1a6]">
                      {conversation.kind === 'check-in' ? '☾' : '✦'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className="truncate text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                          {conversation.pinned ? '📌 ' : ''}
                          {conversation.title}
                        </span>
                        <span className="ml-auto shrink-0 text-[11px] text-gray-400 dark:text-[#8e8e93]">
                          {timeLabel(conversation.updatedAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-gray-500 dark:text-[#8e8e93]">
                        {conversation.preview || '还没有消息'}
                      </span>
                      {project ? (
                        <span className="mt-1 inline-block rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[11px] text-gray-500 dark:bg-white/[0.08] dark:text-[#a1a1a6]">
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
                    className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full text-gray-500 opacity-0 transition-all duration-300 hover:bg-black/[0.05] hover:opacity-80 hover:text-black active:scale-[0.98] focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 group-hover:opacity-100 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
                  >
                    <MoreHorizontalIcon className="h-3.5 w-3.5" />
                  </button>

                  {menuOpenId === conversation.id ? (
                    <div
                      ref={menuRef}
                      role="menu"
                      className="absolute right-1 top-8 z-10 w-32 rounded-2xl border border-gray-200/70 bg-white p-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:border-white/10 dark:bg-[#1c1c1e]"
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
                          confirmDeleteId === conversation.id ? 'text-[#d70015] dark:text-[#ff7b72]' : ''
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
      </>
    );
  }

  function projectList() {
    return (
      <>
        <p className={contextHeadingClass}>
          {section === 'projects' ? '项目列表' : '按项目筛选'}
        </p>
        {projects.length === 0 ? (
          <p className="px-2.5 py-2 text-[12px] leading-5 text-gray-400 dark:text-[#8e8e93]">
            项目会由阿咲在对话里创建。
          </p>
        ) : (
          <div className="space-y-0.5">
            <button
              type="button"
              aria-current={selectedProjectId === null ? 'page' : undefined}
              onClick={() => onSelectProject(null)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30',
                selectedProjectId === null
                  ? 'bg-black/[0.06] dark:bg-white/[0.1]'
                  : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
              )}
            >
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-gray-300 dark:bg-white/30" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-gray-700 dark:text-[#a1a1a6]">
                全部项目
              </span>
            </button>
            {projects.map((project) => {
              const active = project.id === selectedProjectId;
              return (
                <button
                  key={project.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onSelectProject(project.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30',
                    active ? 'bg-black/[0.06] dark:bg-white/[0.1]' : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full',
                      active ? 'bg-[#0071e3]' : 'bg-gray-300 dark:bg-white/30'
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-gray-700 dark:text-[#a1a1a6]">
                    {project.name}
                  </span>
                  <FolderIcon className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-[#8e8e93]" />
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  }

  return (
    <aside
      aria-label="导航"
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-[260px] max-w-[85vw] shrink-0 flex-col border-r border-gray-200/70 bg-[#f5f5f7] transition-transform duration-200 motion-reduce:transition-none dark:border-white/10 dark:bg-[#0f0f10]',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        'md:static md:z-auto md:h-full md:w-[260px] md:max-w-none md:translate-x-0'
      )}
    >
      <div className="flex items-center justify-between px-4 pt-3 md:hidden">
        <span className="text-[13px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">导航</span>
        <button
          type="button"
          aria-label="关闭导航"
          onClick={onCloseMobile}
          className="flex h-8 items-center justify-center rounded-full px-3 text-[12px] font-medium text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:opacity-80 hover:text-black active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
        >
          关闭
        </button>
      </div>

      <div className="flex items-center gap-2 px-4 pb-3 pt-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[#1d1d1f] text-[12px] font-semibold text-white">
          S
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">
          ASAKI
        </span>
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onNewConversation}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[#0071e3] px-3 text-[13px] font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          <PlusIcon className="h-4 w-4" />
          新对话
        </button>
      </div>

      <nav aria-label="主导航" className="space-y-0.5 px-2 pb-2">
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const active = section === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => onSectionChange(id)}
              className={cn(
                'flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30',
                active
                  ? 'bg-[#0071e3]/10 font-medium text-[#0071e3] dark:bg-[#0a84ff]/15 dark:text-[#4da3ff]'
                  : 'text-gray-700 hover:bg-black/[0.04] dark:text-[#a1a1a6] dark:hover:bg-white/[0.06]'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="mx-3 border-t border-gray-200/70 dark:border-white/10" />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {section === 'chat' ? conversationList() : null}
        {PROJECT_SECTIONS.includes(section) ? projectList() : null}
        {section === 'reminders' ? (
          <>
            <p className={contextHeadingClass}>全部提醒</p>
            <p className="px-2.5 py-2 text-[12px] leading-5 text-gray-400 dark:text-[#8e8e93]">
              提醒是全局的，不按项目筛选。
            </p>
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-t border-gray-200/70 px-3 py-3 dark:border-white/10">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1d1d1f] text-[11px] text-white">
          x
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-gray-500 dark:text-[#a1a1a6]">xiaolai</span>
        <button
          type="button"
          aria-label="打开设置"
          onClick={() => onSectionChange('settings')}
          className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:opacity-80 hover:text-black active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
