import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { friendlyErrorMessage } from '../../shared/errors';
import type {
  CreateKnowledgeTopicInput,
  KnowledgeBacklink,
  KnowledgeNote,
  KnowledgeStatus,
  KnowledgeTopic,
  MergeKnowledgeTopicsInput,
  SaveKnowledgeNoteInput,
  UpdateKnowledgeTopicInput
} from '../../shared/knowledge';
import type { Workspace } from '../../shared/workspace';
import { Dialog } from '../ui/Dialog';
import { PlusIcon } from '../ui/icons';
import { Select } from '../ui/Select';
import { KnowledgeGraph } from './KnowledgeGraph';
import { KnowledgeNotePane } from './KnowledgeNotePane';
import { PageFrame } from './PageFrame';
import {
  STATUS_DOT_CLASS,
  STATUS_LABELS,
  STATUS_ORDER,
  workspaceName
} from './knowledge-ui';

const inputClass =
  'mt-1 h-10 w-full rounded-xl border-0 bg-[#f5f5f7] px-3 text-[14px] text-gray-800 outline-none transition-all duration-200 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]';
const labelClass = 'block text-[12px] font-medium text-gray-500 dark:text-[#8e8e93]';

type KnowledgePageProps = {
  topics: KnowledgeTopic[];
  workspaces: Workspace[];
  defaultWorkspaceId?: string | null;
  /** Opens this topic when the page mounts (global-search deep link). */
  focusTopicId?: string | null;
  onOpenSidebar: () => void;
  onCreateTopic: (input: CreateKnowledgeTopicInput) => Promise<KnowledgeTopic>;
  onUpdateTopic: (input: UpdateKnowledgeTopicInput) => Promise<KnowledgeTopic>;
  onDeleteTopic: (topicId: string) => Promise<void>;
  onMergeTopic?: (input: MergeKnowledgeTopicsInput) => Promise<KnowledgeTopic>;
  getKnowledgeNote: (topicId: string) => Promise<KnowledgeNote>;
  saveKnowledgeNote: (input: SaveKnowledgeNoteInput) => Promise<KnowledgeNote>;
  getKnowledgeBacklinks: (topicId: string) => Promise<KnowledgeBacklink[]>;
};

type TopicForm = {
  name: string;
  aliases: string;
  workspaceId: string;
  status: KnowledgeStatus | '';
  level: string;
  summary: string;
};

type MobilePane = 'list' | 'note';

type ContentView = 'note' | 'graph';

const viewToggleClass = (active: boolean) =>
  `rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 ${
    active
      ? 'bg-white text-gray-900 shadow-sm dark:bg-white/[0.14] dark:text-[#f5f5f7]'
      : 'text-gray-500 hover:text-gray-800 dark:text-[#8e8e93] dark:hover:text-[#f5f5f7]'
  }`;

type DirectoryGroup = {
  key: string;
  label: string;
  topics: KnowledgeTopic[];
};

const GLOBAL_KEY = '__global';

function emptyForm(defaultWorkspaceId?: string | null): TopicForm {
  return {
    name: '',
    aliases: '',
    workspaceId: defaultWorkspaceId ?? '',
    status: '',
    level: '',
    summary: ''
  };
}

function formFromTopic(topic: KnowledgeTopic): TopicForm {
  return {
    name: topic.name,
    aliases: topic.aliases.join('，'),
    workspaceId: topic.workspaceId ?? '',
    status: topic.status,
    level: topic.level === undefined ? '' : String(topic.level),
    summary: topic.summary
  };
}

function parseAliases(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((alias) => alias.trim())
    .filter(Boolean);
}

/**
 * Workspace groups in workspace order, with the global group last. A topic
 * whose workspace no longer exists falls under its raw id rather than vanishing.
 */
function groupTopics(topics: KnowledgeTopic[], workspaces: Workspace[]): DirectoryGroup[] {
  const groups = new Map<string, KnowledgeTopic[]>();
  for (const workspace of workspaces) {
    if (topics.some((topic) => topic.workspaceId === workspace.id)) {
      groups.set(workspace.id, []);
    }
  }
  for (const topic of topics) {
    const key = topic.workspaceId ?? GLOBAL_KEY;
    const existing = groups.get(key);
    if (existing) existing.push(topic);
    else groups.set(key, [topic]);
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 0)
    .map(([key, items]) => ({
      key,
      label: key === GLOBAL_KEY ? '全局' : workspaceName(workspaces, key),
      topics: items
    }))
    .sort((a, b) => (a.key === GLOBAL_KEY ? 1 : 0) - (b.key === GLOBAL_KEY ? 1 : 0));
}

/**
 * A directory of topics beside one open note. Selection survives a search that
 * hides the selected topic; a wiki-link jump clears the search so the target
 * is visible in the directory afterwards.
 */
export function KnowledgePage({
  topics,
  workspaces,
  defaultWorkspaceId,
  focusTopicId,
  onOpenSidebar,
  onCreateTopic,
  onUpdateTopic,
  onDeleteTopic,
  onMergeTopic,
  getKnowledgeNote,
  saveKnowledgeNote,
  getKnowledgeBacklinks
}: KnowledgePageProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>('list');
  const [contentView, setContentView] = useState<ContentView>('note');
  const [editing, setEditing] = useState<KnowledgeTopic | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<TopicForm>(() => emptyForm(defaultWorkspaceId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const seenIdsRef = useRef(new Set<string>());

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return topics;
    return topics.filter((topic) =>
      [topic.name, ...topic.aliases, topic.summary].some((text) =>
        text.toLowerCase().includes(needle)
      )
    );
  }, [topics, query]);

  const groups = useMemo(() => groupTopics(filtered, workspaces), [filtered, workspaces]);
  const selected = topics.find((topic) => topic.id === selectedId) ?? null;
  const mastered = topics.filter((topic) => topic.status === 'mastered').length;
  const learning = topics.filter((topic) => topic.status === 'learning').length;

  useEffect(() => {
    const ids = new Set(topics.map((topic) => topic.id));
    const wasSeen = selectedId !== null && seenIdsRef.current.has(selectedId);
    for (const id of ids) seenIdsRef.current.add(id);
    if (selectedId === null) {
      if (topics.length > 0) setSelectedId(topics[0]!.id);
      return;
    }
    // A just-created topic is not in the parent's list yet: wait for it.
    if (!ids.has(selectedId) && wasSeen) {
      setSelectedId(topics[0]?.id ?? null);
    }
  }, [topics, selectedId]);

  useEffect(() => {
    if (!focusTopicId) return;
    setQuery('');
    setSelectedId(focusTopicId);
    setMobilePane('note');
  }, [focusTopicId]);

  function selectTopic(topicId: string) {
    setSelectedId(topicId);
    setMobilePane('note');
  }

  function showView(view: ContentView) {
    setContentView(view);
    // The graph is a content-pane view; on mobile it must leave the directory.
    setMobilePane('note');
  }

  function openTopic(topicId: string) {
    setQuery('');
    selectTopic(topicId);
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm(defaultWorkspaceId));
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(topic: KnowledgeTopic) {
    setEditing(topic);
    setForm(formFromTopic(topic));
    setError(null);
    setDialogOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError('主题名称不能为空。');
      return;
    }
    const level = form.level.trim();
    if (level && !/^[1-5]$/.test(level)) {
      setError('掌握程度必须是 1 到 5。');
      return;
    }
    const aliases = parseAliases(form.aliases);
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await onUpdateTopic({
          id: editing.id,
          name,
          aliases,
          status: form.status === '' ? editing.status : form.status,
          level: level ? Number(level) : null,
          workspaceId: form.workspaceId ? form.workspaceId : null,
          summary: form.summary.trim()
        });
      } else {
        const created = await onCreateTopic({
          name,
          ...(aliases.length > 0 ? { aliases } : {}),
          ...(form.status !== '' ? { status: form.status } : {}),
          ...(level ? { level: Number(level) } : {}),
          ...(form.workspaceId ? { workspaceId: form.workspaceId } : {}),
          ...(form.summary.trim() ? { summary: form.summary.trim() } : {})
        });
        setSelectedId(created.id);
        setQuery('');
        setMobilePane('note');
      }
      setDialogOpen(false);
      setEditing(null);
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '保存失败，请重试。'));
    } finally {
      setSaving(false);
    }
  }

  async function remove(topic: KnowledgeTopic) {
    if (typeof window !== 'undefined' && !window.confirm(`删除知识主题「${topic.name}」？`)) {
      return;
    }
    setError(null);
    try {
      await onDeleteTopic(topic.id);
      const remaining = topics.filter((entry) => entry.id !== topic.id);
      setSelectedId((current) => (current === topic.id ? remaining[0]?.id ?? null : current));
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '删除主题失败，请重试。'));
    }
  }

  function openMerge(topic: KnowledgeTopic) {
    const other = topics.find((entry) => entry.id !== topic.id);
    if (!other) return;
    // Start empty so a merge target is always a deliberate choice.
    setMergeTargetId('');
    setMergeError(null);
    setMergeOpen(true);
  }

  async function submitMerge() {
    if (!selected || !onMergeTopic || merging) return;
    if (!mergeTargetId || mergeTargetId === selected.id) {
      setMergeError('请选择要合并到的主题。');
      return;
    }
    setMerging(true);
    setMergeError(null);
    try {
      const target = await onMergeTopic({
        sourceId: selected.id,
        targetId: mergeTargetId
      });
      setSelectedId(target.id);
      setMergeOpen(false);
    } catch (cause) {
      setMergeError(friendlyErrorMessage(cause, '合并失败，请重试。'));
    } finally {
      setMerging(false);
    }
  }

  return (
    <PageFrame
      fill
      title="知识库"
      subtitle="主题 · 笔记 · 证据"
      onOpenSidebar={onOpenSidebar}
      action={
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="知识内容视图"
            className="flex rounded-[9px] bg-[#f5f5f7] p-0.5 dark:bg-white/[0.08]"
          >
            <button
              type="button"
              aria-pressed={contentView === 'note'}
              onClick={() => showView('note')}
              className={viewToggleClass(contentView === 'note')}
            >
              笔记
            </button>
            <button
              type="button"
              aria-pressed={contentView === 'graph'}
              onClick={() => showView('graph')}
              className={viewToggleClass(contentView === 'graph')}
            >
              图谱
            </button>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-[#0071e3] px-3.5 text-[13px] font-medium text-white transition-all duration-200 hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:active:scale-100"
          >
            <PlusIcon className="h-4 w-4" />
            新增主题
          </button>
        </div>
      }
    >
      <div className="mx-auto flex h-full w-full max-w-[1160px] px-4 py-4 md:px-6">
        <aside
          aria-label="知识目录"
          className={`w-full shrink-0 flex-col md:flex md:w-[260px] md:border-r md:border-gray-200/70 md:pr-4 dark:md:border-white/10 ${
            mobilePane === 'note' ? 'hidden' : 'flex'
          }`}
        >
          <input
            type="search"
            aria-label="搜索知识主题"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索主题或别名…"
            className="h-9 w-full rounded-xl border-0 bg-[#f5f5f7] px-3 text-[13px] text-gray-700 outline-none transition-all duration-200 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#a1a1a6]"
          />
          <p className="mt-3 px-1 text-[11px] text-gray-500 dark:text-[#8e8e93]">
            {topics.length} 个主题 · {mastered} 已掌握 · {learning} 在学
          </p>
          <nav className="mt-2 min-h-0 flex-1 overflow-y-auto pb-4">
            {topics.length === 0 ? (
              <p className="px-1 py-6 text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
                还没有知识主题。完成学习任务、写笔记，或对阿咲说“今天学了 X”。
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-1 py-6 text-[13px] text-gray-500 dark:text-[#8e8e93]">
                没有匹配的主题。
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.key} className="mt-3 first:mt-0">
                  <p className="px-1 text-[11px] font-medium text-gray-400 dark:text-[#8e8e93]">
                    {group.label}
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {group.topics.map((topic) => {
                      const active = topic.id === selectedId;
                      return (
                        <li key={topic.id}>
                          <button
                            type="button"
                            aria-current={active ? 'true' : undefined}
                            onClick={() => selectTopic(topic.id)}
                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 ${
                              active
                                ? 'bg-[#0071e3]/10 font-medium text-[#0071e3] dark:bg-[#0071e3]/20 dark:text-[#4da3ff]'
                                : 'text-gray-700 hover:bg-black/[0.04] dark:text-[#a1a1a6] dark:hover:bg-white/[0.06]'
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[topic.status]}`}
                            />
                            <span className="truncate">{topic.name}</span>
                            {topic.level !== undefined ? (
                              <span className="ml-auto text-[10px] text-gray-400 dark:text-[#8e8e93]">
                                L{topic.level}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </nav>
        </aside>

        <section
          aria-label="知识内容"
          className={`min-w-0 flex-1 flex-col overflow-y-auto pt-3 md:flex md:pl-5 md:pt-0 ${
            mobilePane === 'note' ? 'flex' : 'hidden'
          }`}
        >
          {contentView === 'graph' ? (
            <>
              <button
                type="button"
                aria-label="返回目录"
                onClick={() => setMobilePane('list')}
                className="mb-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-black/[0.04] hover:text-gray-700 md:hidden dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
              >
                ←
              </button>
              <KnowledgeGraph
                topics={topics}
                getBacklinks={getKnowledgeBacklinks}
                selectedId={selectedId}
                onSelect={selectTopic}
              />
            </>
          ) : selected ? (
            <KnowledgeNotePane
              topic={selected}
              topics={topics}
              workspaceLabel={workspaceName(workspaces, selected.workspaceId)}
              getNote={getKnowledgeNote}
              saveNote={saveKnowledgeNote}
              getBacklinks={getKnowledgeBacklinks}
              onOpenTopic={openTopic}
              onEdit={() => openEdit(selected)}
              onDelete={() => void remove(selected)}
              {...(onMergeTopic && topics.length > 1
                ? { onMerge: () => openMerge(selected) }
                : {})}
              onBack={() => setMobilePane('list')}
            />
          ) : (
            <p className="py-16 text-center text-[13px] text-gray-500 dark:text-[#8e8e93]">
              {topics.length === 0 ? '还没有知识主题。' : '选择一个主题查看笔记。'}
            </p>
          )}
        </section>
      </div>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={editing ? '编辑知识主题' : '新增知识主题'}
      >
        <form onSubmit={(event) => void save(event)} className="space-y-3">
          <label className={labelClass}>
            主题名称
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className={inputClass}
              placeholder="例如：LangChain"
            />
          </label>
          <label className={labelClass}>
            别名（逗号分隔）
            <input
              value={form.aliases}
              onChange={(event) => setForm({ ...form, aliases: event.target.value })}
              className={inputClass}
              placeholder="例如：LC, Lang Chain"
            />
          </label>
          <label className={labelClass}>
            所属工作区
            <Select
              size="field"
              value={form.workspaceId}
              onChange={(event) => setForm({ ...form, workspaceId: event.target.value })}
              className="mt-1"
              disabled={saving}
            >
              <option value="">全局（所有工作区）</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              状态
              <Select
                size="field"
                value={form.status}
                onChange={(event) =>
                  setForm({ ...form, status: event.target.value as TopicForm['status'] })
                }
                className="mt-1"
                disabled={saving}
              >
                {form.status === '' ? <option value="">默认（在学）</option> : null}
                {STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </label>
            <label className={labelClass}>
              掌握程度
              <input
                inputMode="numeric"
                value={form.level}
                onChange={(event) => setForm({ ...form, level: event.target.value })}
                className={inputClass}
                placeholder="1-5，可留空"
              />
            </label>
          </div>
          <label className={labelClass}>
            摘要
            <textarea
              value={form.summary}
              onChange={(event) => setForm({ ...form, summary: event.target.value })}
              rows={3}
              className="mt-1 w-full resize-none rounded-xl border-0 bg-[#f5f5f7] px-3 py-2 text-[14px] text-gray-800 outline-none transition-all duration-200 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
              placeholder="一句话说明现在到什么程度"
            />
          </label>
          {error ? <p className="text-[12px] text-[#ff3b30]">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className="h-9 rounded-xl px-3.5 text-[13px] text-gray-600 transition-colors hover:bg-black/[0.04] dark:text-[#a1a1a6] dark:hover:bg-white/[0.06]"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-9 rounded-xl bg-[#0071e3] px-4 text-[13px] font-medium text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={mergeOpen}
        onClose={() => {
          if (!merging) setMergeOpen(false);
        }}
        title="合并知识主题"
      >
        <form
          aria-label="合并知识主题"
          onSubmit={(event) => {
            event.preventDefault();
            void submitMerge();
          }}
          className="space-y-3"
        >
          <p className="text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
            把「{selected?.name}」并入另一个主题：别名、证据和笔记会保留在目标主题里，
            当前主题随后被移除。
          </p>
          <label className={labelClass}>
            合并到
            <Select
              size="field"
              aria-label="合并到"
              value={mergeTargetId}
              onChange={(event) => setMergeTargetId(event.target.value)}
              className="mt-1"
              disabled={merging}
            >
              <option value="">请选择目标主题</option>
              {topics
                .filter((topic) => topic.id !== selected?.id)
                .map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
            </Select>
          </label>
          {mergeError ? <p className="text-[12px] text-[#ff3b30]">{mergeError}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setMergeOpen(false)}
              disabled={merging}
              className="h-9 rounded-xl px-3.5 text-[13px] text-gray-600 transition-colors hover:bg-black/[0.04] dark:text-[#a1a1a6] dark:hover:bg-white/[0.06]"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={merging}
              className="h-9 rounded-xl bg-[#0071e3] px-4 text-[13px] font-medium text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
            >
              合并
            </button>
          </div>
        </form>
      </Dialog>
    </PageFrame>
  );
}
