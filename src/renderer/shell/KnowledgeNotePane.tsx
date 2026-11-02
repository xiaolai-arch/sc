import { useState, type KeyboardEvent } from 'react';
import {
  KNOWLEDGE_NOTE_CONFLICT_MESSAGE,
  resolveKnowledgeLink,
  type KnowledgeBacklink,
  type KnowledgeNote,
  type KnowledgeTopic,
  type SaveKnowledgeNoteInput
} from '../../shared/knowledge';
import { MarkdownText } from './MarkdownText';
import { KnowledgeSidePanel } from './KnowledgeSidePanel';
import { STATUS_DOT_CLASS, STATUS_LABELS } from './knowledge-ui';
import {
  useKnowledgeNote,
  type KnowledgeNoteStatus
} from './useKnowledgeNote';

type KnowledgeNotePaneProps = {
  topic: KnowledgeTopic;
  topics: KnowledgeTopic[];
  workspaceLabel: string;
  getNote(topicId: string): Promise<KnowledgeNote>;
  saveNote(input: SaveKnowledgeNoteInput): Promise<KnowledgeNote>;
  getBacklinks(topicId: string): Promise<KnowledgeBacklink[]>;
  onOpenTopic(topicId: string): void;
  onEdit(): void;
  onDelete(): void;
  onBack?(): void;
};

const STATUS_TEXT: Record<KnowledgeNoteStatus, string> = {
  loading: '加载中…',
  dirty: '未保存',
  saving: '保存中…',
  saved: '已保存',
  error: '保存失败',
  conflict: '有冲突'
};

type Mode = 'edit' | 'preview';

const toggleClass = (active: boolean) =>
  `rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 ${
    active
      ? 'bg-white text-gray-900 shadow-sm dark:bg-white/[0.14] dark:text-[#f5f5f7]'
      : 'text-gray-500 hover:text-gray-800 dark:text-[#8e8e93] dark:hover:text-[#f5f5f7]'
  }`;

/**
 * The right-hand reading surface: one topic's editable note plus its evidence
 * and backlinks. The parent owns selection; this owns the draft.
 */
export function KnowledgeNotePane({
  topic,
  topics,
  workspaceLabel,
  getNote,
  saveNote,
  getBacklinks,
  onOpenTopic,
  onEdit,
  onDelete,
  onBack
}: KnowledgeNotePaneProps) {
  const [mode, setMode] = useState<Mode>('edit');
  const {
    body,
    status,
    error,
    loadError,
    backlinks,
    backlinksError,
    conflict,
    setBody,
    flush,
    retrySave,
    overwriteConflict,
    reloadNote,
    reloadBacklinks
  } = useKnowledgeNote({ topicId: topic.id, getNote, saveNote, getBacklinks });

  function show(next: Mode) {
    if (next === mode) return;
    void flush();
    setMode(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void flush();
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row xl:gap-6">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-start gap-2">
          {onBack ? (
            <button
              type="button"
              aria-label="返回目录"
              onClick={onBack}
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-black/[0.04] hover:text-gray-700 md:hidden dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
            >
              ←
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-[18px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">
                {topic.name}
              </h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[11px] text-gray-600 dark:bg-white/[0.08] dark:text-[#a1a1a6]">
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASS[topic.status]}`}
                />
                {STATUS_LABELS[topic.status]}
              </span>
              {topic.level !== undefined ? (
                <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">
                  L{topic.level}
                </span>
              ) : null}
              <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">
                {workspaceLabel}
              </span>
            </div>
            {topic.summary ? (
              <p className="mt-1 text-[12px] leading-5 text-gray-500 dark:text-[#a1a1a6]">
                {topic.summary}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label={`编辑 ${topic.name}`}
              onClick={onEdit}
              className="rounded-lg px-2 py-1 text-[12px] text-gray-500 transition-colors hover:bg-black/[0.04] hover:text-gray-900 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
            >
              编辑
            </button>
            <button
              type="button"
              aria-label={`删除 ${topic.name}`}
              onClick={onDelete}
              className="rounded-lg px-2 py-1 text-[12px] text-[#ff3b30] transition-colors hover:bg-[#ff3b30]/10"
            >
              删除
            </button>
          </div>
        </header>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex rounded-[9px] bg-[#f5f5f7] p-0.5 dark:bg-white/[0.08]">
            <button
              type="button"
              aria-pressed={mode === 'edit'}
              onClick={() => show('edit')}
              className={toggleClass(mode === 'edit')}
            >
              编辑
            </button>
            <button
              type="button"
              aria-pressed={mode === 'preview'}
              onClick={() => show('preview')}
              className={toggleClass(mode === 'preview')}
            >
              预览
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span
              role="status"
              className="text-[11px] text-gray-400 dark:text-[#8e8e93]"
            >
              {STATUS_TEXT[status]}
            </span>
            {status === 'error' ? (
              <button
                type="button"
                onClick={() => void retrySave()}
                className="rounded-lg px-2 py-0.5 text-[11px] font-medium text-[#ff3b30] transition-colors hover:bg-[#ff3b30]/10"
              >
                重试保存
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-2 flex min-h-0 flex-1 flex-col">
          {conflict ? (
            <div
              role="alert"
              className="mb-2 rounded-xl bg-[#ff9500]/[0.08] px-3 py-2.5"
            >
              <p className="text-[12px] leading-5 text-[#9a5b00] dark:text-[#ffb340]">
                {KNOWLEDGE_NOTE_CONFLICT_MESSAGE}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void overwriteConflict()}
                  className="rounded-lg bg-[#ff9500]/15 px-2.5 py-1 text-[11px] font-medium text-[#9a5b00] transition-colors hover:bg-[#ff9500]/25 dark:text-[#ffb340]"
                >
                  保留我的版本
                </button>
                <button
                  type="button"
                  onClick={() => void reloadNote()}
                  className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-black/[0.04] dark:text-[#a1a1a6] dark:hover:bg-white/[0.06]"
                >
                  加载磁盘版本
                </button>
              </div>
            </div>
          ) : null}
          {status === 'loading' ? (
            <p className="text-[13px] text-gray-400 dark:text-[#8e8e93]">加载中…</p>
          ) : loadError ? (
            <div className="rounded-xl bg-[#ff3b30]/[0.06] px-3 py-2.5">
              <p className="text-[12px] text-[#ff3b30]">笔记加载失败。</p>
              <button
                type="button"
                onClick={() => void reloadNote()}
                className="mt-1 rounded-lg px-2 py-0.5 text-[11px] font-medium text-[#ff3b30] transition-colors hover:bg-[#ff3b30]/10"
              >
                重试加载
              </button>
            </div>
          ) : mode === 'edit' ? (
            <textarea
              aria-label="知识笔记"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onBlur={() => void flush()}
              onKeyDown={handleKeyDown}
              placeholder="用 markdown 写下这个知识点；[[主题名]] 可以链接到另一个主题。"
              className="min-h-[320px] w-full flex-1 resize-none rounded-xl border-0 bg-[#f5f5f7] px-3 py-2.5 font-mono text-[13px] leading-6 text-gray-800 outline-none transition-all duration-200 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
            />
          ) : body.trim() ? (
            <div className="min-h-[320px]">
              <MarkdownText
                text={body}
                resolveWikiLink={(target) => resolveKnowledgeLink(topics, target)}
                onWikiLink={onOpenTopic}
              />
            </div>
          ) : (
            <p className="text-[13px] text-gray-400 dark:text-[#8e8e93]">
              还没有笔记。点「编辑」开始写。
            </p>
          )}
          {status === 'error' && error ? (
            <p className="mt-1 text-[11px] text-[#ff3b30]">{error}</p>
          ) : null}
        </div>
      </div>

      <details
        open
        className="mt-6 border-t border-gray-200/70 pt-4 dark:border-white/10 xl:mt-0 xl:w-[240px] xl:shrink-0 xl:border-t-0 xl:pt-0"
      >
        <summary className="cursor-pointer list-none text-[12px] font-medium text-gray-500 dark:text-[#8e8e93] xl:hidden">
          证据与反向链接
        </summary>
        <div className="mt-3 xl:mt-0">
          <KnowledgeSidePanel
            topic={topic}
            backlinks={backlinks}
            backlinksError={backlinksError}
            onOpenTopic={onOpenTopic}
            onReloadBacklinks={() => void reloadBacklinks()}
          />
        </div>
      </details>
    </div>
  );
}
