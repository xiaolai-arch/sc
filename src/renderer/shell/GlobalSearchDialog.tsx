import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationSummary } from '../../shared/conversations';
import type { SearchResult, SearchResultKind } from '../../shared/search';
import type { Workspace } from '../../shared/workspace';
import { Dialog } from '../ui/Dialog';

type SearchItem =
  | { key: string; source: 'conversation'; conversation: ConversationSummary }
  | { key: string; source: 'vault'; result: SearchResult };

type GlobalSearchDialogProps = {
  open: boolean;
  workspaces: Workspace[];
  onClose: () => void;
  onSearchConversations: (query: string) => Promise<ConversationSummary[]>;
  onSearchAll: (query: string) => Promise<SearchResult[]>;
  onSelectConversation: (id: string) => void;
  onSelectResult: (result: SearchResult) => void;
};

const KIND_LABELS: Record<SearchResultKind, string> = {
  workspace: '工作区',
  note: '笔记',
  task: '任务',
  memory: '记忆',
  review: '复盘',
  'practice-set': '练习',
  'practice-question': '练习',
  'practice-mistake': '错题',
  plan: '长期计划',
  'knowledge-topic': '知识库'
};

const SEARCH_DELAY_MS = 180;
const MAX_CONVERSATIONS = 5;

function itemKey(item: SearchItem): string {
  return item.key;
}

function resultLabel(result: SearchResult): string {
  return KIND_LABELS[result.kind];
}

function resultTitle(item: Extract<SearchItem, { source: 'vault' }>): string {
  return item.result.title;
}

export function GlobalSearchDialog({
  open,
  workspaces,
  onClose,
  onSearchConversations,
  onSearchAll,
  onSelectConversation,
  onSelectResult
}: GlobalSearchDialogProps) {
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [vaultResults, setVaultResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const workspaceNames = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces]
  );

  const items = useMemo<SearchItem[]>(
    () => [
      ...conversations.map((conversation) => ({
        key: `conversation:${conversation.id}`,
        source: 'conversation' as const,
        conversation
      })),
      ...vaultResults.map((result) => ({
        key: `vault:${result.path}:${result.kind}:${result.docId}`,
        source: 'vault' as const,
        result
      }))
    ],
    [conversations, vaultResults]
  );

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setConversations([]);
    setVaultResults([]);
    setLoading(false);
    setError(null);
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setConversations([]);
      setVaultResults([]);
      setLoading(false);
      setError(null);
      setActiveIndex(0);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setConversations([]);
    setVaultResults([]);
    setActiveIndex(0);
    const timer = window.setTimeout(() => {
      void Promise.allSettled([
        onSearchConversations(trimmed),
        onSearchAll(trimmed)
      ]).then(([conversationResult, vaultResult]) => {
        if (cancelled) return;
        const conversationOk = conversationResult.status === 'fulfilled';
        const vaultOk = vaultResult.status === 'fulfilled';
        setConversations(
          conversationOk ? conversationResult.value.slice(0, MAX_CONVERSATIONS) : []
        );
        setVaultResults(vaultOk ? vaultResult.value : []);
        setError(!conversationOk && !vaultOk ? '搜索失败，请稍后再试。' : null);
        setLoading(false);
        setActiveIndex(0);
      });
    }, SEARCH_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, open, onSearchConversations, onSearchAll]);

  useEffect(() => {
    setActiveIndex((current) => {
      if (items.length === 0) return 0;
      return Math.min(current, items.length - 1);
    });
  }, [items.length]);

  useEffect(() => {
    if (!open) return;
    const active = listRef.current?.querySelector<HTMLElement>(
      `[data-search-index="${activeIndex}"]`
    );
    active?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open]);

  const trimmed = query.trim();

  function selectItem(item: SearchItem | undefined): void {
    if (!item) return;
    if (item.source === 'conversation') onSelectConversation(item.conversation.id);
    else onSelectResult(item.result);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) =>
        items.length === 0 ? 0 : (current + 1) % items.length
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) =>
        items.length === 0 ? 0 : (current - 1 + items.length) % items.length
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      selectItem(items[activeIndex] ?? items[0]);
    }
  }

  function contextLabel(item: SearchItem): string | null {
    if (item.source === 'conversation') {
      const id = item.conversation.workspaceId;
      if (!id) return item.conversation.kind === 'check-in' ? '日常' : null;
      return workspaceNames.get(id) ?? '工作区';
    }
    if (item.result.kind === 'knowledge-topic') {
      if (!item.result.workspaceId) return '知识库';
      return `${workspaceNames.get(item.result.workspaceId) ?? '工作区'} · 知识库`;
    }
    if (!item.result.workspaceId) return null;
    return workspaceNames.get(item.result.workspaceId) ?? '工作区';
  }

  return (
    <Dialog open={open} onClose={onClose} title="搜索">
      <div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="搜索对话、笔记、任务、计划、知识库…"
          aria-label="搜索全部内容"
          aria-controls="global-search-results"
          aria-activedescendant={
            items.length > 0 ? `global-search-item-${activeIndex}` : undefined
          }
          className="h-11 w-full rounded-xl border-0 bg-[#f5f5f7] px-3 text-[14px] text-[#1d1d1f] outline-none transition-all duration-200 placeholder:text-gray-400 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
        />
        <p className="mt-2 text-[12px] leading-5 text-gray-400 dark:text-[#8e8e93]">
          搜索对话、笔记、任务、长期计划和知识库
        </p>

        {error ? (
          <p role="alert" className="mt-3 text-[13px] text-[#d70015] dark:text-[#ff7b72]">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p role="status" className="mt-3 text-[13px] text-gray-500 dark:text-[#a1a1a6]">
            搜索中…
          </p>
        ) : null}

        {!loading && trimmed.length > 0 && items.length === 0 && !error ? (
          <p className="mt-3 text-[13px] text-gray-500 dark:text-[#a1a1a6]">
            没有找到相关内容。
          </p>
        ) : null}

        {items.length > 0 ? (
          <div
            ref={listRef}
            id="global-search-results"
            role="listbox"
            aria-label="搜索结果"
            className="mt-3 max-h-[52vh] space-y-0.5 overflow-y-auto"
          >
            {items.map((item, index) => {
              const active = index === activeIndex;
              const label =
                item.source === 'conversation' ? '对话' : resultLabel(item.result);
              const title =
                item.source === 'conversation' ? item.conversation.title : resultTitle(item);
              const snippet =
                item.source === 'conversation'
                  ? item.conversation.preview
                  : item.result.snippet;
              const context = contextLabel(item);
              return (
                <button
                  key={itemKey(item)}
                  id={`global-search-item-${index}`}
                  data-search-index={index}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectItem(item)}
                  className={`flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-none ${
                    active
                      ? 'bg-[#0071e3]/10 dark:bg-[#0a84ff]/15'
                      : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="mt-0.5 shrink-0 rounded-full bg-black/[0.06] px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-white/[0.08] dark:text-[#a1a1a6]">
                    {label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {title}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-gray-500 dark:text-[#a1a1a6]">
                      {snippet}
                    </span>
                  </span>
                  {context ? (
                    <span className="mt-0.5 shrink-0 text-[11px] text-gray-400 dark:text-[#8e8e93]">
                      {context}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
