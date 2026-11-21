import { useCallback, useEffect, useState } from 'react';
import {
  MAX_PROFILE_TEXT,
  PROFILE_CATEGORY_LABELS,
  PROFILE_CATEGORY_ORDER,
  groupProfileEntries,
  type ProfileCategory,
  type ProfileEntry
} from '../../shared/profile';
import { PageFrame } from './PageFrame';

type ProfilePageProps = {
  onOpenSidebar: () => void;
};

function api() {
  const bridge = window.studyCoach;
  if (!bridge) throw new Error('本地服务尚未连接。');
  return bridge;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

/**
 * "My profile" page: the vault-wide facts the butler may rely on. Candidates
 * (model guesses) are visually separated and must be confirmed before they are
 * treated as established facts, and every row can be corrected, expired or
 * deleted so a stale preference never becomes permanent.
 */
export function ProfilePage({ onOpenSidebar }: ProfilePageProps) {
  const [entries, setEntries] = useState<ProfileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<ProfileCategory>('identity');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [showExpired, setShowExpired] = useState(false);
  /** Entries whose replaced-value list is expanded, keyed by entry id. */
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const list = await api().listProfile();
      setEntries(list);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取个人资料失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>) => {
    setSaving(true);
    try {
      await action();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败。');
    } finally {
      setSaving(false);
    }
  };

  const add = () =>
    run(async () => {
      if (saving) return;
      const text = draft.trim();
      if (text.length === 0) return;
      await api().createProfileEntry({
        category,
        text,
        source: 'user',
        confidence: 'confirmed',
        origin: '手动添加'
      });
      setDraft('');
    });

  const confirmEntry = (entry: ProfileEntry) =>
    run(async () => {
      await api().updateProfileEntry({ id: entry.id, confidence: 'confirmed' });
    });

  const saveEdit = (entry: ProfileEntry) =>
    run(async () => {
      const text = editingText.trim();
      if (text.length === 0) return;
      await api().updateProfileEntry({ id: entry.id, text });
      setEditingId(null);
      setEditingText('');
    });

  const expireEntry = (entry: ProfileEntry) =>
    run(async () => {
      await api().updateProfileEntry({ id: entry.id, status: 'expired' });
    });

  const restoreEntry = (entry: ProfileEntry) =>
    run(async () => {
      await api().updateProfileEntry({ id: entry.id, status: 'active' });
    });

  const removeEntry = (entry: ProfileEntry) =>
    run(async () => {
      if (saving) return;
      if (!window.confirm(`删除这条资料？\n\n${entry.text}`)) return;
      await api().deleteProfileEntry({ id: entry.id });
    });

  const toggleHistory = (id: string) =>
    setOpenHistory((previous) => ({ ...previous, [id]: !previous[id] }));

  const active = entries.filter((entry) => entry.status === 'active');
  const expired = entries.filter((entry) => entry.status === 'expired');
  const grouped = groupProfileEntries(active);

  return (
    <PageFrame title="我的资料" subtitle="对阿咲长期有效" onOpenSidebar={onOpenSidebar}>
      <p className="max-w-[720px] text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
        这里是你亲口说过、或经你确认的事实：作息、偏好、能力、近期变化。阿咲每次回答都会参考它；
        模型猜测会标为「待确认」，确认之前不会当成事实。
      </p>

      <section className="mt-6 rounded-2xl border border-black/[0.06] bg-[#f5f5f7]/70 p-4 dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            aria-label="资料分类"
            value={category}
            onChange={(event) => setCategory(event.target.value as ProfileCategory)}
            className="h-10 shrink-0 rounded-xl border border-black/10 bg-white px-3 text-[13px] text-gray-700 outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:border-white/10 dark:bg-[#1c1c1e] dark:text-[#f5f5f7]"
          >
            {PROFILE_CATEGORY_ORDER.map((value) => (
              <option key={value} value={value}>
                {PROFILE_CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
          <input
            aria-label="新的资料"
            value={draft}
            placeholder="例如：工作日每天只能安排 1 小时"
            maxLength={MAX_PROFILE_TEXT}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter while an IME candidate window is open must confirm the
              // candidate, not submit the entry.
              if (event.key !== 'Enter' || event.nativeEvent.isComposing || saving) return;
              event.preventDefault();
              void add();
            }}
            className="h-10 min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 text-[13px] text-gray-700 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:border-white/10 dark:bg-[#1c1c1e] dark:text-[#f5f5f7]"
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={saving || draft.trim().length === 0}
            className="h-10 shrink-0 rounded-full bg-[#0071e3] px-4 text-[13px] font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            添加
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-2 text-[12px] text-[#d70015] dark:text-[#ff6961]">
            {error}
          </p>
        ) : null}
      </section>

      {loading ? (
        <p className="mt-6 text-[13px] text-gray-500 dark:text-[#8e8e93]" role="status">
          正在读取个人资料…
        </p>
      ) : error ? null : active.length === 0 ? (
        <p className="mt-6 text-[13px] text-gray-500 dark:text-[#8e8e93]">
          还没有资料。你可以在对话里告诉阿咲，也可以在上面直接添加。
        </p>
      ) : (
        <div className="mt-6 space-y-6">
          {PROFILE_CATEGORY_ORDER.map((value) => {
            const items = grouped[value];
            if (items.length === 0) return null;
            return (
              <section key={value}>
                <h2 className="text-[13px] font-semibold text-black dark:text-[#f5f5f7]">
                  {PROFILE_CATEGORY_LABELS[value]}
                </h2>
                <ul className="mt-2 divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06] dark:divide-white/10 dark:border-white/10">
                  {items.map((entry) => (
                    <li key={entry.id} className="px-4 py-3">
                      {editingId === entry.id ? (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            aria-label="修改资料"
                            maxLength={MAX_PROFILE_TEXT}
                            value={editingText}
                            onChange={(event) => setEditingText(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                setEditingId(null);
                                return;
                              }
                              if (event.key !== 'Enter' || event.nativeEvent.isComposing || saving) {
                                return;
                              }
                              event.preventDefault();
                              void saveEdit(entry);
                            }}
                            className="h-9 min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:border-white/10 dark:bg-[#1c1c1e] dark:text-[#f5f5f7]"
                          />
                          <button
                            type="button"
                            onClick={() => void saveEdit(entry)}
                            disabled={saving}
                            className="h-9 rounded-full bg-[#0071e3] px-3 text-[12px] font-medium text-white disabled:opacity-40"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="h-9 rounded-full px-3 text-[12px] text-gray-500 hover:bg-black/[0.04] dark:text-[#8e8e93] dark:hover:bg-white/[0.06]"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words text-[14px] leading-6 text-black dark:text-[#f5f5f7]">
                              {entry.text}
                            </p>
                            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-400 dark:text-[#8e8e93]">
                              <span>{entry.source === 'user' ? '你提供' : '模型推测'}</span>
                              <span>·</span>
                              <span>{entry.origin}</span>
                              <span>·</span>
                              <span>更新于 {formatUpdatedAt(entry.updatedAt)}</span>
                              {entry.confidence === 'candidate' ? (
                                <span className="rounded-full bg-[#fff4e5] px-1.5 py-0.5 text-[#b25000] dark:bg-[#3a2a12] dark:text-[#ffb340]">
                                  待确认
                                </span>
                              ) : null}
                            </p>
                            {entry.history && entry.history.length > 0 ? (
                              <div className="mt-1">
                                <button
                                  type="button"
                                  onClick={() => toggleHistory(entry.id)}
                                  className="text-[11px] text-gray-400 hover:text-gray-600 hover:underline dark:text-[#8e8e93] dark:hover:text-[#c7c7cc]"
                                >
                                  {openHistory[entry.id]
                                    ? '收起修改历史'
                                    : `曾被修改 ${entry.history.length} 次`}
                                </button>
                                {openHistory[entry.id] ? (
                                  <ul className="mt-1 space-y-1">
                                    {entry.history.map((record, index) => (
                                      <li
                                        key={`${entry.id}:${index}`}
                                        className="text-[11px] leading-5 text-gray-400 dark:text-[#8e8e93]"
                                      >
                                        <p className="break-words">原：{record.text}</p>
                                        <p className="flex flex-wrap items-center gap-1.5">
                                          <span>
                                            {record.source === 'user' ? '你提供' : '模型推测'}
                                          </span>
                                          {record.origin ? (
                                            <>
                                              <span>·</span>
                                              <span>{record.origin}</span>
                                            </>
                                          ) : null}
                                          <span>·</span>
                                          <span>
                                            {formatUpdatedAt(record.replacedAt)} 替换
                                          </span>
                                        </p>
                                      </li>
                                    ))}
                                  </ul>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1">
                            {entry.confidence === 'candidate' ? (
                              <button
                                type="button"
                                onClick={() => void confirmEntry(entry)}
                                disabled={saving}
                                className="rounded-full px-2 py-1 text-[11px] font-medium text-[#0071e3] hover:bg-[#0071e3]/10 disabled:opacity-40"
                              >
                                确认
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(entry.id);
                                setEditingText(entry.text);
                              }}
                              className="rounded-full px-2 py-1 text-[11px] text-gray-500 hover:bg-black/[0.04] dark:text-[#8e8e93] dark:hover:bg-white/[0.06]"
                            >
                              修改
                            </button>
                            <button
                              type="button"
                              onClick={() => void expireEntry(entry)}
                              disabled={saving}
                              className="rounded-full px-2 py-1 text-[11px] text-gray-500 hover:bg-black/[0.04] disabled:opacity-40 dark:text-[#8e8e93] dark:hover:bg-white/[0.06]"
                            >
                              已过期
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeEntry(entry)}
                              disabled={saving}
                              className="rounded-full px-2 py-1 text-[11px] text-[#d70015] hover:bg-[#d70015]/10 disabled:opacity-40 dark:text-[#ff6961]"
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {expired.length > 0 ? (
        <section className="mt-8">
          <button
            type="button"
            onClick={() => setShowExpired((value) => !value)}
            className="text-[12px] text-gray-500 hover:underline dark:text-[#8e8e93]"
          >
            {showExpired ? '收起已过期' : `已过期资料 · ${expired.length}`}
          </button>
          {showExpired ? (
            <ul className="mt-2 divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06] dark:divide-white/10 dark:border-white/10">
              {expired.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 opacity-60">
                    <p className="break-words text-[13px] leading-6 text-black line-through dark:text-[#f5f5f7]">
                      {entry.text}
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-400 dark:text-[#8e8e93]">
                      {PROFILE_CATEGORY_LABELS[entry.category]} · 更新于{' '}
                      {formatUpdatedAt(entry.updatedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => void restoreEntry(entry)}
                      disabled={saving}
                      className="rounded-full px-2 py-1 text-[11px] text-[#0071e3] hover:bg-[#0071e3]/10 disabled:opacity-40"
                    >
                      恢复
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeEntry(entry)}
                      disabled={saving}
                      className="rounded-full px-2 py-1 text-[11px] text-[#d70015] hover:bg-[#d70015]/10 disabled:opacity-40 dark:text-[#ff6961]"
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </PageFrame>
  );
}
