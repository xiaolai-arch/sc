import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '../ui/cn';
import { DAILY_WORKSPACE_ID } from '../../shared/conversations';
import {
  BookOpenIcon,
  CalendarIcon,
  ClockIcon,
  FolderIcon,
  FolderPlusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  TargetIcon,
  ThinkIcon
} from '../ui/icons';
import type { ConversationSummary } from '../../shared/conversations';
import type { Workspace } from '../../shared/workspace';

export type Section =
  | 'chat'
  | 'projects'
  | 'schedule'
  | 'plan'
  | 'knowledge'
  | 'memory'
  | 'review'
  | 'reminders'
  | 'settings';
export type ChatScope = 'daily' | 'unfiled' | 'workspace';
export type NavSection =
  | 'schedule'
  | 'plan'
  | 'daily'
  | 'knowledge'
  | 'memory'
  | 'review'
  | 'reminders'
  | 'settings';

type NavigationSidebarProps = {
  section: Section;
  chatScope: ChatScope;
  conversations: ConversationSummary[];
  projects: Workspace[];
  activeConversationId: string | null;
  selectedProjectId: string | null;
  onSectionChange: (section: NavSection) => void;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onSelectWorkspace: (id: string) => void;
  onSelectUnfiled: () => void;
  onSelectAll: () => void;
  onNewWorkspace: () => void;
  onRenameConversation: (id: string, title: string) => void;
  onTogglePinned: (id: string, pinned: boolean) => void;
  onDeleteConversation: (id: string) => void;
  onOpenSearch: () => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
};

const NAV_ITEMS: Array<{ id: NavSection; label: string; Icon: typeof SunIcon }> = [
  { id: 'schedule', label: '今日安排', Icon: CalendarIcon },
  { id: 'plan', label: '长期计划', Icon: TargetIcon },
  { id: 'daily', label: '日常', Icon: SunIcon },
  { id: 'knowledge', label: '知识库', Icon: SparklesIcon },
  { id: 'memory', label: '记忆', Icon: ThinkIcon },
  { id: 'review', label: '复盘', Icon: BookOpenIcon },
  { id: 'reminders', label: '提醒', Icon: ClockIcon }
];

/** Same range as the dsh sidebar: 264px minimum, 420px maximum. */
const SIDEBAR_MIN_WIDTH = 264;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 280;
const SIDEBAR_WIDTH_KEY = 'asaki:sidebar-width';
const SIDEBAR_KEYBOARD_STEP = 16;

function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

function readSidebarWidth(): number {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored === null) return SIDEBAR_DEFAULT_WIDTH;
    return clampSidebarWidth(Number(stored));
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

/** Compact relative time, matching the density of the dsh session rows. */
function timeLabel(value: string, now: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const elapsed = now - date.getTime();
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}分钟`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}小时`;
  if (elapsed < 172_800_000) return '昨天';
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}天`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

const menuItemClass =
  'flex w-full items-center rounded-xl px-2 py-2 text-left text-[13px] text-gray-700 transition-colors duration-200 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#a1a1a6] dark:hover:bg-white/[0.06]';

const contextHeadingClass =
  'px-2.5 pb-1 pt-2 text-[11px] font-medium tracking-wide text-gray-400 dark:text-[#8e8e93]';

const workspaceRowClass =
  'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30';

export function NavigationSidebar({
  section,
  chatScope,
  conversations,
  projects,
  activeConversationId,
  selectedProjectId,
  onSectionChange,
  onNewConversation,
  onSelectConversation,
  onSelectWorkspace,
  onSelectUnfiled,
  onSelectAll,
  onNewWorkspace,
  onRenameConversation,
  onTogglePinned,
  onDeleteConversation,
  onOpenSearch,
  mobileOpen = false,
  onCloseMobile
}: NavigationSidebarProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedWorkspaceId, setExpandedWorkspaceId] = useState<string | null>(null);
  const [unfiledExpanded, setUnfiledExpanded] = useState(false);
  const [dailyExpanded, setDailyExpanded] = useState(true);
  const lastActiveForExpansionRef = useRef<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [resizingSidebar, setResizingSidebar] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const resizeDragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // Storage can be unavailable in private/restricted webviews.
    }
  }, [sidebarWidth]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    },
    []
  );

  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: sidebarWidth
    };
    pendingWidthRef.current = sidebarWidth;
    setResizingSidebar(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function moveSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = resizeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pendingWidthRef.current = clampSidebarWidth(
      drag.startWidth + event.clientX - drag.startX
    );
    if (resizeFrameRef.current !== null) return;
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      if (pendingWidthRef.current !== null) {
        setSidebarWidth(pendingWidthRef.current);
      }
    });
  }

  function endSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = resizeDragRef.current;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture?.(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    }
    resizeDragRef.current = null;
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    if (pendingWidthRef.current !== null) {
      setSidebarWidth(pendingWidthRef.current);
      pendingWidthRef.current = null;
    }
    setResizingSidebar(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  function resizeSidebarWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    let next = sidebarWidth;
    if (event.key === 'ArrowLeft') next -= SIDEBAR_KEYBOARD_STEP;
    else if (event.key === 'ArrowRight') next += SIDEBAR_KEYBOARD_STEP;
    else if (event.key === 'Home') next = SIDEBAR_MIN_WIDTH;
    else if (event.key === 'End') next = SIDEBAR_MAX_WIDTH;
    else return;
    event.preventDefault();
    setSidebarWidth(clampSidebarWidth(next));
  }

  // Follow a conversation opened from search, the tray or a check-in. The ref
  // ensures a manual collapse is not undone by a background summary refresh.
  useEffect(() => {
    if (!activeConversationId) return;
    const active = conversations.find((conversation) => conversation.id === activeConversationId);
    if (!active) return;
    const group = active.workspaceId ?? (active.kind === 'check-in' ? 'daily' : 'unfiled');
    const signature = `${activeConversationId}:${group}`;
    if (lastActiveForExpansionRef.current === signature) return;
    lastActiveForExpansionRef.current = signature;
    if (active.workspaceId === DAILY_WORKSPACE_ID) {
      setDailyExpanded(true);
      return;
    }
    if (active.workspaceId) {
      setExpandedWorkspaceId(active.workspaceId);
      setUnfiledExpanded(false);
    } else if (active.kind === 'check-in') {
      setDailyExpanded(true);
      setExpandedWorkspaceId(null);
    } else {
      setUnfiledExpanded(true);
      setExpandedWorkspaceId(null);
    }
  }, [activeConversationId, conversations]);

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
  const dailyActive = section === 'chat' && chatScope === 'daily';
  const unfiledActive = section === 'chat' && chatScope === 'unfiled';
  const showConversations = section === 'chat';
  const dailyConversations = conversations.filter(
    (conversation) =>
      conversation.workspaceId === DAILY_WORKSPACE_ID ||
      (conversation.kind === 'check-in' && !conversation.workspaceId)
  );
  const unfiledConversations = conversations.filter(
    (conversation) => !conversation.workspaceId && conversation.kind !== 'check-in'
  );
  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId
  );
  const activeConversationInUnfiled = Boolean(
    activeConversation &&
      !activeConversation.workspaceId &&
      activeConversation.kind !== 'check-in'
  );

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

  function groupLabel(conversation: ConversationSummary): string {
    if (conversation.workspaceId === DAILY_WORKSPACE_ID) return '日常';
    if (conversation.workspaceId) {
      return projectName(conversation.workspaceId) ?? '工作区';
    }
    return conversation.kind === 'check-in' ? '日常' : '未分组';
  }

  function renameRow(conversation: ConversationSummary) {
    return (
      <div key={conversation.id} className="px-1 py-0.5">
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
          className="h-8 w-full rounded-xl border-0 bg-white px-2.5 text-[13px] text-[#1d1d1f] outline-none ring-2 ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
        />
      </div>
    );
  }

  function conversationActions(conversation: ConversationSummary) {
    return (
      <>
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
          className={cn(
            'absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-gray-500 opacity-0 transition-all duration-300 hover:bg-black/[0.05] hover:opacity-80 hover:text-black active:scale-[0.98] focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 group-hover:opacity-100 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]'
          )}
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
      </>
    );
  }

  function conversationRow(conversation: ConversationSummary) {
    const active = conversation.id === activeConversationId;
    if (renamingId === conversation.id) return renameRow(conversation);
    return (
      <div key={conversation.id} className="group relative">
        <button
          type="button"
          aria-current={active ? 'page' : undefined}
          title={conversation.preview || conversation.title}
          onClick={() => {
            closeMenu();
            onSelectConversation(conversation.id);
          }}
          className={cn(
            'flex h-8 w-full items-center gap-1.5 rounded-xl px-2.5 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30',
            active
              ? 'bg-black/[0.06] dark:bg-white/[0.1]'
              : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
          )}
        >
          <span
            aria-hidden="true"
            className="flex w-3.5 shrink-0 justify-center text-[11px] text-gray-400 dark:text-[#8e8e93]"
          >
            {conversation.kind === 'check-in' ? '☾' : ''}
          </span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
            {conversation.pinned ? '📌 ' : ''}
            {conversation.title}
          </span>
          <span className="shrink-0 text-[10px] tabular-nums text-gray-400 transition-opacity duration-200 group-hover:opacity-0 dark:text-[#8e8e93]">
            {timeLabel(conversation.updatedAt, clockNow)}
          </span>
        </button>
        {conversationActions(conversation)}
      </div>
    );
  }

  function conversationList(items: ConversationSummary[], emptyText: string) {
    if (items.length === 0) {
      return (
        <p className="px-2.5 py-2 text-[12px] leading-5 text-gray-400 dark:text-[#8e8e93]">
          {emptyText}
        </p>
      );
    }
    return <div className="space-y-0.5">{items.map((item) => conversationRow(item))}</div>;
  }

  function dailyConversationList() {
    return (
      <div className="max-h-48 overflow-y-auto pb-1 pl-5 pr-1">
        {dailyConversations.length === 0 ? (
          <p className="px-2.5 py-1.5 text-[12px] leading-5 text-gray-400 dark:text-[#8e8e93]">
            还没有对话。
          </p>
        ) : (
          <div className="space-y-0.5">
            {dailyConversations.map((conversation) => conversationRow(conversation))}
          </div>
        )}
      </div>
    );
  }

  function workspaceList() {
    const showAllButton = section === 'chat' || section === 'projects';
    const unfiledHighlighted = unfiledActive && !activeConversationInUnfiled;
    return (
      <>
        <div className="flex items-center justify-between px-2.5 pb-1 pt-2">
          <p className="text-[11px] font-medium tracking-wide text-gray-400 dark:text-[#8e8e93]">
            工作区
          </p>
          {showAllButton ? (
            <button
              type="button"
              aria-label="全部工作区"
              onClick={onSelectAll}
              className="rounded-full px-1.5 py-0.5 text-[11px] text-gray-400 transition-colors duration-200 hover:bg-black/[0.04] hover:text-[#0071e3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#4da3ff]"
            >
              全部
            </button>
          ) : null}
        </div>

        {projects.length === 0 ? (
          <p className="px-2.5 py-2 text-[12px] leading-5 text-gray-400 dark:text-[#8e8e93]">
            项目会由阿咲在对话里创建。
          </p>
        ) : (
          <div className="space-y-0.5">
            {projects.map((project) => {
              // Selecting a conversation inside a folder highlights only that
              // conversation; the folder background stays neutral.
              const active =
                project.id === selectedProjectId &&
                activeConversation?.workspaceId !== project.id;
              const expanded =
                showConversations && expandedWorkspaceId === project.id;
              const grouped = conversations.filter(
                (conversation) => conversation.workspaceId === project.id
              );
              return (
                <div key={project.id}>
                  <button
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    aria-expanded={expanded}
                    onClick={() => {
                      if (expanded) {
                        setExpandedWorkspaceId(null);
                        return;
                      }
                      setExpandedWorkspaceId(project.id);
                      setUnfiledExpanded(false);
                      onSelectWorkspace(project.id);
                    }}
                    className={cn(
                      workspaceRowClass,
                      active
                        ? 'bg-black/[0.06] dark:bg-white/[0.1]'
                        : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                    )}
                  >
                    <FolderIcon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        active
                          ? 'text-[#0071e3] dark:text-[#4da3ff]'
                          : 'text-gray-400 dark:text-[#8e8e93]'
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-gray-700 dark:text-[#a1a1a6]">
                      {project.name}
                    </span>
                  </button>
                  {expanded ? (
                    <div className="pb-1 pl-5 pr-1">
                      {conversationList(grouped, '还没有对话。')}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-0.5">
          <button
            type="button"
            aria-current={unfiledHighlighted ? 'page' : undefined}
            aria-expanded={showConversations && unfiledExpanded}
            onClick={() => {
              if (showConversations && unfiledExpanded) {
                setUnfiledExpanded(false);
                return;
              }
              setUnfiledExpanded(true);
              setExpandedWorkspaceId(null);
              onSelectUnfiled();
            }}
            className={cn(
              workspaceRowClass,
              unfiledHighlighted
                ? 'bg-black/[0.06] dark:bg-white/[0.1]'
                : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
            )}
          >
            <FolderIcon
              className={cn(
                'h-4 w-4 shrink-0',
                unfiledHighlighted
                  ? 'text-[#0071e3] dark:text-[#4da3ff]'
                  : 'text-gray-400 dark:text-[#8e8e93]'
              )}
            />
            <span className="min-w-0 flex-1 truncate text-[13px] text-gray-700 dark:text-[#a1a1a6]">
              未分组
            </span>
          </button>
          {showConversations && unfiledExpanded ? (
            <div className="pb-1 pl-5 pr-1">
              {conversationList(unfiledConversations, '还没有未分组的对话。')}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onNewWorkspace}
          className="mt-1 flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[12px] text-gray-500 transition-colors duration-200 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#8e8e93] dark:hover:bg-white/[0.06]"
        >
          <FolderPlusIcon className="h-4 w-4 shrink-0" />
          新建工作区
        </button>
      </>
    );
  }

  return (
    <aside
      aria-label="导航"
      style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex w-[260px] max-w-[85vw] shrink-0 flex-col border-r border-gray-200/70 bg-[#f5f5f7] transition-transform duration-200 motion-reduce:transition-none dark:border-white/10 dark:bg-[#0f0f10]',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
        'md:relative md:z-auto md:h-full md:w-[var(--sidebar-width)] md:max-w-none md:translate-x-0',
        resizingSidebar ? 'md:transition-none' : ''
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

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onNewConversation}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[#0071e3] px-3 text-[13px] font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          <PlusIcon className="h-4 w-4" />
          新对话
        </button>
      </div>

      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="打开搜索"
          className="flex h-9 w-full items-center gap-2 rounded-xl border-0 bg-white px-2.5 text-left text-[13px] text-gray-400 transition-all duration-200 hover:bg-black/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#8e8e93] dark:hover:bg-white/[0.04]"
        >
          <SearchIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">搜索全部内容</span>
          <kbd className="shrink-0 rounded-md border border-black/10 px-1.5 py-0.5 text-[10px] text-gray-400 dark:border-white/10 dark:text-[#8e8e93]">
            ⌘K
          </kbd>
        </button>
      </div>

      <nav aria-label="主导航" className="space-y-0.5 px-2 pb-2">
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const active =
            (id === 'daily' && dailyActive) ||
            (id !== 'daily' && section === id);
          return (
            <div key={id}>
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                {...(id === 'daily' ? { 'aria-expanded': dailyExpanded } : {})}
                onClick={() => {
                  if (id === 'daily') {
                    if (section === 'chat' && dailyExpanded) {
                      setDailyExpanded(false);
                      return;
                    }
                    setDailyExpanded(true);
                    onSectionChange('daily');
                    return;
                  }
                  onSectionChange(id);
                }}
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
              {id === 'daily' && dailyExpanded && showConversations
                ? dailyConversationList()
                : null}
            </div>
          );
        })}
      </nav>

      <div className="mx-3 border-t border-gray-200/70 dark:border-white/10" />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{workspaceList()}</div>

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

      <div
        role="separator"
        aria-label="调整导航栏宽度"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={Math.round(sidebarWidth)}
        tabIndex={0}
        onPointerDown={startSidebarResize}
        onPointerMove={moveSidebarResize}
        onPointerUp={endSidebarResize}
        onPointerCancel={endSidebarResize}
        onLostPointerCapture={endSidebarResize}
        onKeyDown={resizeSidebarWithKeyboard}
        onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH)}
        className={cn(
          'group/resize absolute -right-1 top-0 bottom-0 z-20 hidden w-2 cursor-col-resize touch-none md:block',
          'focus-visible:outline-none'
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150',
            'group-hover/resize:bg-black/10 group-focus-visible/resize:bg-[#0071e3]/50 dark:group-hover/resize:bg-white/15 dark:group-focus-visible/resize:bg-[#4da3ff]/60',
            resizingSidebar && 'bg-[#0071e3]/50 dark:bg-[#4da3ff]/60'
          )}
        />
      </div>
    </aside>
  );
}
