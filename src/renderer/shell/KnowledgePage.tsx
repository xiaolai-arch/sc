import { useMemo, useState, type FormEvent } from 'react';
import type {
  CreateKnowledgeTopicInput,
  KnowledgeStatus,
  KnowledgeTopic,
  UpdateKnowledgeTopicInput
} from '../../shared/knowledge';
import type { Workspace } from '../../shared/workspace';
import { Dialog } from '../ui/Dialog';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from '../ui/icons';
import { PageFrame } from './PageFrame';

const STATUS_LABELS: Record<KnowledgeStatus, string> = {
  planned: '计划中',
  learning: '在学',
  mastered: '已掌握',
  paused: '暂停'
};

const STATUS_ORDER: KnowledgeStatus[] = ['planned', 'learning', 'mastered', 'paused'];

const inputClass =
  'mt-1 h-10 w-full rounded-xl border-0 bg-[#f5f5f7] px-3 text-[14px] text-gray-800 outline-none transition-all duration-200 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]';
const labelClass = 'block text-[12px] font-medium text-gray-500 dark:text-[#8e8e93]';

type KnowledgePageProps = {
  topics: KnowledgeTopic[];
  workspaces: Workspace[];
  defaultWorkspaceId?: string | null;
  onOpenSidebar: () => void;
  onCreateTopic: (input: CreateKnowledgeTopicInput) => Promise<KnowledgeTopic>;
  onUpdateTopic: (input: UpdateKnowledgeTopicInput) => Promise<KnowledgeTopic>;
  onDeleteTopic: (topicId: string) => Promise<void>;
};

type TopicForm = {
  name: string;
  aliases: string;
  workspaceId: string;
  status: KnowledgeStatus | '';
  level: string;
  summary: string;
};

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

function evidenceDate(date: string): string {
  const [, month, day] = date.split('-');
  if (!month || !day) return date;
  return `${Number(month)}/${Number(day)}`;
}

function workspaceName(workspaces: Workspace[], workspaceId: string | undefined): string {
  if (!workspaceId) return '全局';
  return workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId;
}

export function KnowledgePage({
  topics,
  workspaces,
  defaultWorkspaceId,
  onOpenSidebar,
  onCreateTopic,
  onUpdateTopic,
  onDeleteTopic
}: KnowledgePageProps) {
  const [filterId, setFilterId] = useState('');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<KnowledgeTopic | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<TopicForm>(() => emptyForm(defaultWorkspaceId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return topics.filter((topic) => {
      if (filterId && topic.workspaceId !== undefined && topic.workspaceId !== filterId) {
        return false;
      }
      if (!needle) return true;
      return [topic.name, ...topic.aliases, topic.summary].some((text) =>
        text.toLowerCase().includes(needle)
      );
    });
  }, [topics, filterId, query]);

  const mastered = filtered.filter((topic) => topic.status === 'mastered').length;
  const learning = filtered.filter((topic) => topic.status === 'learning').length;

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
    if (level && (!/^[1-5]$/.test(level))) {
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
        await onCreateTopic({
          name,
          ...(aliases.length > 0 ? { aliases } : {}),
          ...(form.status !== '' ? { status: form.status } : {}),
          ...(level ? { level: Number(level) } : {}),
          ...(form.workspaceId ? { workspaceId: form.workspaceId } : {}),
          ...(form.summary.trim() ? { summary: form.summary.trim() } : {})
        });
      }
      setDialogOpen(false);
      setEditing(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  async function remove(topic: KnowledgeTopic) {
    if (typeof window !== 'undefined' && !window.confirm(`删除知识主题「${topic.name}」？`)) {
      return;
    }
    await onDeleteTopic(topic.id);
  }

  return (
    <PageFrame
      title="知识库"
      subtitle="主题 · 证据 · 掌握程度"
      onOpenSidebar={onOpenSidebar}
      action={
        <button
          type="button"
          onClick={openCreate}
          className="flex h-9 items-center gap-1.5 rounded-xl bg-[#0071e3] px-3.5 text-[13px] font-medium text-white transition-all duration-200 hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:active:scale-100"
        >
          <PlusIcon className="h-4 w-4" />
          新增主题
        </button>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="搜索知识主题"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索主题或别名…"
          className="h-9 min-w-[200px] flex-1 rounded-xl border-0 bg-[#f5f5f7] px-3 text-[13px] text-gray-700 outline-none transition-all duration-200 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#a1a1a6]"
        />
        {workspaces.length > 0 ? (
          <select
            aria-label="按工作区筛选知识主题"
            value={filterId}
            onChange={(event) => setFilterId(event.target.value)}
            className="h-9 rounded-xl border-0 bg-[#f5f5f7] px-3 text-[13px] text-gray-700 outline-none transition-all duration-200 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#a1a1a6]"
          >
            <option value="">全部工作区</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      <p className="mb-4 text-[12px] text-gray-500 dark:text-[#8e8e93]">
        {topics.length} 个主题 · {mastered} 已掌握 · {learning} 在学
      </p>

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-[14px] text-gray-500 dark:text-[#8e8e93]">
          还没有知识主题。
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((topic) => {
            const expanded = expandedId === topic.id;
            return (
              <li
                key={topic.id}
                className="rounded-2xl border border-gray-200/70 bg-white transition-colors dark:border-white/10 dark:bg-[#1c1c1e]"
              >
                <div className="flex items-start gap-3 px-4 py-3">
                  <button
                    type="button"
                    aria-label={`${expanded ? '收起' : '展开'} ${topic.name}`}
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : topic.id)}
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-black/[0.04] hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
                  >
                    {expanded ? (
                      <ChevronDownIcon className="h-4 w-4" />
                    ) : (
                      <ChevronRightIcon className="h-4 w-4" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[14px] font-medium text-black dark:text-[#f5f5f7]">
                        {topic.name}
                      </span>
                      <span className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[11px] text-gray-600 dark:bg-white/[0.08] dark:text-[#a1a1a6]">
                        {STATUS_LABELS[topic.status]}
                      </span>
                      {topic.level !== undefined ? (
                        <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">
                          L{topic.level}
                        </span>
                      ) : null}
                      <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">
                        {workspaceName(workspaces, topic.workspaceId)}
                      </span>
                    </div>
                    {topic.summary ? (
                      <p className="mt-1 text-[12px] leading-5 text-gray-500 dark:text-[#a1a1a6]">
                        {topic.summary}
                      </p>
                    ) : null}
                    {topic.aliases.length > 0 ? (
                      <p className="mt-0.5 text-[11px] text-gray-400 dark:text-[#8e8e93]">
                        别名：{topic.aliases.join('、')}
                      </p>
                    ) : null}
                    {expanded ? (
                      <div className="mt-3 border-t border-gray-200/70 pt-2 dark:border-white/10">
                        <p className="text-[11px] font-medium text-gray-400 dark:text-[#8e8e93]">
                          证据 · {topic.evidence.length}
                        </p>
                        {topic.evidence.length === 0 ? (
                          <p className="mt-1 text-[12px] text-gray-400 dark:text-[#8e8e93]">
                            还没有证据。
                          </p>
                        ) : (
                          <ul className="mt-1 space-y-1">
                            {[...topic.evidence].reverse().map((entry) => (
                              <li
                                key={entry.id}
                                className="text-[12px] leading-5 text-gray-600 dark:text-[#a1a1a6]"
                              >
                                {evidenceDate(entry.date)} · {entry.title}
                                {entry.note ? ` — ${entry.note}` : ''}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={`编辑 ${topic.name}`}
                      onClick={() => openEdit(topic)}
                      className="rounded-lg px-2 py-1 text-[12px] text-gray-500 transition-colors hover:bg-black/[0.04] hover:text-gray-900 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      aria-label={`删除 ${topic.name}`}
                      onClick={() => void remove(topic)}
                      className="rounded-lg px-2 py-1 text-[12px] text-[#ff3b30] transition-colors hover:bg-[#ff3b30]/10"
                    >
                      删除
                    </button>
                  </div>
                </div>
                <p className="px-4 pb-3 text-[11px] text-gray-400 dark:text-[#8e8e93]">
                  证据 {topic.evidence.length} 条
                </p>
              </li>
            );
          })}
        </ul>
      )}

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
            <select
              value={form.workspaceId}
              onChange={(event) => setForm({ ...form, workspaceId: event.target.value })}
              className={inputClass}
            >
              <option value="">全局（所有工作区）</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              状态
              <select
                value={form.status}
                onChange={(event) =>
                  setForm({ ...form, status: event.target.value as TopicForm['status'] })
                }
                className={inputClass}
              >
                {form.status === '' ? <option value="">默认（在学）</option> : null}
                {STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
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
    </PageFrame>
  );
}
