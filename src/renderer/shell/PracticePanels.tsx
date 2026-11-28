import { useEffect, useRef, useState } from 'react';
import { formatLocalDate } from '../../shared/date';
import { friendlyErrorMessage } from '../../shared/errors';
import { buildMistakeSheet } from '../../shared/practice-sheet';
import {
  STRICT_MASTERY_NOTE,
  isStubbornMistake,
  type CreatePracticeQuestionInput,
  type CreatePracticeSetInput,
  type ExportMistakeSheetResult,
  type PracticeAttempt,
  type PracticeMistake,
  type PracticeSet
} from '../../shared/practice';

type MistakeBookProps = {
  mistakes: PracticeMistake[];
  /** Workspace the listed mistakes belong to; stamped into the copied sheet. */
  workspaceId?: string;
  /** Mistake ids that are due today. */
  dueIds?: ReadonlySet<string>;
  /** Opt-in stricter mastery: states the rule once; off renders nothing extra. */
  strict?: boolean;
  /** Subject per mistake id, for the copy button's aggregate line. */
  subjects?: Readonly<Record<string, string>>;
  onReview?: (mistake: PracticeMistake) => void;
  onReviewAll?: () => void;
  onResolve?: (mistake: PracticeMistake) => void;
  /** Turns one mistake into a single-question practice set in this project. */
  onMakeSet?: (mistake: PracticeMistake) => void;
  /** Writes the printable sheet to the vault; its path is shown afterwards. */
  onExport?: () => Promise<ExportMistakeSheetResult>;
  /** Saves the learner's own one-line 错因 (trimmed server-side). */
  onSaveCause?: (mistake: PracticeMistake, cause: string) => Promise<PracticeMistake | void>;
  /** 清空已掌握: moves resolved mistakes to the archive file. */
  onClearResolved?: () => Promise<{ archived: number } | void>;
  /** 从归档恢复: lists archived records for the restore picker. */
  onListArchived?: () => Promise<PracticeMistake[]>;
  onRestore?: (mistake: PracticeMistake) => Promise<void>;
};

type MistakeRowProps = {
  mistake: PracticeMistake;
  due: boolean;
  onReview?: (mistake: PracticeMistake) => void;
  onResolve?: (mistake: PracticeMistake) => void;
  onMakeSet?: (mistake: PracticeMistake) => void;
  onSaveCause?: (mistake: PracticeMistake, cause: string) => Promise<PracticeMistake | void>;
};

const rowActionClass =
  'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-[#0071e3] transition-colors duration-200 hover:bg-[#0071e3]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#4da3ff] dark:hover:bg-[#0a84ff]/20';

const quietActionClass =
  'rounded-full px-1 text-[12px] font-medium text-[#0071e3] transition-colors duration-200 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#4da3ff]';

/** Whether a set still needs the learner's 我看过了 confirmation. */
export function needsPracticeReview(set: PracticeSet): boolean {
  return set.source === 'model' && set.reviewedAt === undefined;
}

type PracticeReviewChipProps = {
  set: PracticeSet;
  /** Records `reviewedAt` through the update path; omitted means chip only. */
  onReviewed?: () => Promise<void> | void;
};

/**
 * A quiet provenance mark for AI-generated sets. It disappears once the learner
 * confirms they read the questions (`reviewedAt`), and a hand-made set shows
 * nothing at all — no badge ceremony.
 */
export function PracticeReviewChip({ set, onReviewed }: PracticeReviewChipProps) {
  const [saving, setSaving] = useState(false);
  if (!needsPracticeReview(set)) return null;

  async function review() {
    if (onReviewed === undefined || saving) return;
    setSaving(true);
    try {
      await onReviewed();
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span className="rounded-full bg-[#ff9f0a]/15 px-2 py-0.5 text-[11px] font-medium text-[#8a5a00] dark:text-[#ffb340]">
        待核对
      </span>
      {onReviewed ? (
        <button
          type="button"
          aria-label={`确认已看过：${set.title}`}
          disabled={saving}
          onClick={() => void review()}
          className={quietActionClass}
        >
          {saving ? '记录中…' : '我看过了'}
        </button>
      ) : null}
    </span>
  );
}

function singleLineTitle(prompt: string): string {
  const line = prompt.replace(/\s*\n\s*/g, ' ').trim();
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

/**
 * Builds the one-question set for a mistake-book row. Choice mistakes keep
 * their options and answer; short mistakes stay free recall with the stored
 * reference answer. `source` is deliberately unset: the questions came from the
 * learner's own answer history, not from a model.
 */
export function singleQuestionSetInput(
  mistake: PracticeMistake,
  workspaceId: string,
  subject: string
): CreatePracticeSetInput {
  const question: CreatePracticeQuestionInput =
    mistake.kind === 'short'
      ? {
          kind: 'short',
          prompt: mistake.prompt,
          referenceAnswer: mistake.referenceAnswer ?? '',
          explanation: mistake.explanation
        }
      : {
          prompt: mistake.prompt,
          options: [...mistake.options],
          answer: mistake.answer,
          explanation: mistake.explanation
        };
  return {
    workspaceId,
    title: `单题 · ${singleLineTitle(mistake.prompt)}`,
    subject,
    questions: [question]
  };
}

/** Renders the sheet for the mistakes currently on screen so copy matches export. */
function sheetFor(
  mistakes: readonly PracticeMistake[],
  workspaceId: string,
  strict: boolean,
  subjects?: Readonly<Record<string, string>>
): string {
  return buildMistakeSheet({
    workspaceId,
    date: formatLocalDate(new Date()),
    mistakes,
    ...(subjects !== undefined ? { subjects } : {}),
    strict
  });
}

/**
 * The 顽疾 mark: a neutral noun about the *question* (it has been missed twice
 * and has not been answered right twice in a row), never an evaluation of the
 * learner. Rendered only when `isStubbornMistake` is true, so a record with
 * `correctStreak >= 2` silently drops it — display only, no data change.
 */
function StubbornMark({ mistake }: { mistake: PracticeMistake }) {
  if (!isStubbornMistake(mistake)) return null;
  return (
    <span className="ml-1.5 rounded-full bg-[#ff9f0a]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#8a5a00] dark:text-[#ffb340]">
      顽疾
    </span>
  );
}

/** Inline 补一句错因 editor: one line, skippable, saved on submit. */
function CauseEditor({
  mistake,
  onSave
}: {
  mistake: PracticeMistake;
  onSave: (mistake: PracticeMistake, cause: string) => Promise<PracticeMistake | void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(mistake.cause ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        aria-label={`补一句错因：${mistake.prompt}`}
        onClick={() => {
          setText(mistake.cause ?? '');
          setError(null);
          setOpen(true);
        }}
        className={quietActionClass}
      >
        补一句错因
      </button>
    );
  }

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(mistake, text);
      setOpen(false);
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '保存错因失败，请重试。'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="mt-1 flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          aria-label={`错因：${mistake.prompt}`}
          value={text}
          maxLength={40}
          placeholder="哪个概念、为什么（例：导数链没拆完）"
          onChange={(event) => setText(event.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12px] text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:border-white/15 dark:bg-[#1c1c1e] dark:text-[#f5f5f7]"
        />
        <button
          type="submit"
          disabled={saving}
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-[#0071e3] disabled:opacity-50 dark:text-[#4da3ff]"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => setOpen(false)}
          className="shrink-0 rounded-full px-1 text-[11px] text-gray-400 disabled:opacity-50 dark:text-[#8e8e93]"
        >
          跳过
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-[11px] text-[#d70015] dark:text-[#ff7b72]">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function MistakeRow({ mistake, due, onReview, onResolve, onMakeSet, onSaveCause }: MistakeRowProps) {
  return (
    <li className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">
          {mistake.prompt}
        </p>
        {mistake.kind === 'short' && mistake.referenceAnswer ? (
          <p className="text-[12px] leading-6 text-gray-400 dark:text-[#8e8e93]">
            参考答案：{mistake.referenceAnswer}
          </p>
        ) : null}
        {mistake.cause !== undefined && mistake.cause.trim() !== '' ? (
          <p className="text-[12px] leading-6 text-gray-400 dark:text-[#8e8e93]">
            错因：{mistake.cause}
          </p>
        ) : null}
        <p className="text-[11px] text-gray-400 dark:text-[#8e8e93]">
          {due ? '今天复习 · ' : ''}
          {mistake.due} 复习 · 错 {mistake.wrongCount} 次 · 优先级 {mistake.priority}
          <StubbornMark mistake={mistake} />
        </p>
        {onSaveCause ? (
          <CauseEditor mistake={mistake} onSave={onSaveCause} />
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onMakeSet ? (
          <button
            type="button"
            aria-label={`转为练习：${mistake.prompt}`}
            onClick={() => onMakeSet(mistake)}
            className={rowActionClass}
          >
            转为练习
          </button>
        ) : null}
        {onReview ? (
          <button
            type="button"
            aria-label={`复习错题：${mistake.prompt}`}
            onClick={() => onReview(mistake)}
            className={rowActionClass}
          >
            复习
          </button>
        ) : null}
        {onResolve ? (
          <button
            type="button"
            aria-label={`标记已掌握：${mistake.prompt}`}
            onClick={() => onResolve(mistake)}
            className={rowActionClass}
          >
            已掌握
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** Compact mistake preview that can expand into the full review list. */
export function MistakeBook({
  mistakes,
  workspaceId,
  dueIds,
  strict = false,
  subjects,
  onReview,
  onReviewAll,
  onResolve,
  onMakeSet,
  onExport,
  onSaveCause,
  onClearResolved,
  onListArchived,
  onRestore
}: MistakeBookProps) {
  const [expanded, setExpanded] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [archived, setArchived] = useState<PracticeMistake[] | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    };
  }, []);

  // The book lists active mistakes only, so this count is normally zero; it
  // exists so a caller that passes resolved records still sees the action.
  const resolvedCount = mistakes.filter((mistake) => mistake.status === 'resolved').length;

  if (mistakes.length === 0) return null;
  const dueCount = dueIds ? mistakes.filter((mistake) => dueIds.has(mistake.id)).length : 0;

  async function exportSheet() {
    if (!onExport || exporting) return;
    setExporting(true);
    setExportError(null);
    setSavedPath(null);
    try {
      const result = await onExport();
      setSavedPath(result.path);
    } catch (cause) {
      setExportError(friendlyErrorMessage(cause, '导出复习单失败，请重试。'));
    } finally {
      setExporting(false);
    }
  }

  async function clearResolved() {
    if (!onClearResolved || clearing) return;
    setClearing(true);
    setExportError(null);
    setRestoreNotice(null);
    try {
      const result = await onClearResolved();
      // The book lists active mistakes only, so a successful clear changes
      // nothing on screen; say what happened instead of leaving silence.
      const moved = result !== undefined ? result.archived : undefined;
      setRestoreNotice(
        moved !== undefined
          ? moved > 0
            ? `已归档 ${moved} 道已掌握错题（可从归档恢复）`
            : '没有新的已掌握错题可归档'
          : null
      );
    } catch (cause) {
      setExportError(friendlyErrorMessage(cause, '清空已掌握失败，请重试。'));
    } finally {
      setClearing(false);
    }
  }

  /** Opens the restore picker, reading the archive through the supplied reader. */
  async function toggleArchive() {
    if (!onListArchived) return;
    if (archived !== null) {
      setArchived(null);
      return;
    }
    setExportError(null);
    try {
      setArchived(await onListArchived());
    } catch (cause) {
      setExportError(friendlyErrorMessage(cause, '读取归档失败，请重试。'));
    }
  }

  async function restoreOne(mistake: PracticeMistake) {
    if (!onRestore) return;
    setExportError(null);
    try {
      await onRestore(mistake);
      setArchived((current) => (current ?? []).filter((entry) => entry.id !== mistake.id));
      setRestoreNotice(`已恢复到错题本：${singleLineTitle(mistake.prompt)}`);
    } catch (cause) {
      setExportError(friendlyErrorMessage(cause, '恢复归档失败，请重试。'));
    }
  }

  async function copySheet() {
    try {
      await navigator.clipboard?.writeText(
        sheetFor(mistakes, workspaceId ?? mistakes[0]?.workspaceId ?? '', strict, subjects)
      );
      setCopied(true);
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be unavailable in tests or restricted webviews.
    }
  }

  return (
    <div className="mt-6 rounded-2xl bg-[#f5f5f7] p-5 dark:bg-white/[0.06]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-gray-500 dark:text-[#8e8e93]">
          错题本 · {mistakes.length} 道待复习
          {dueCount > 0 ? (
            <span className="ml-2 rounded-full bg-[#ff9f0a]/15 px-2 py-0.5 text-[11px] text-[#8a5a00] dark:text-[#ffb340]">
              今天到期 {dueCount} 道
            </span>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {onReviewAll && dueCount > 0 ? (
            <button
              type="button"
              onClick={onReviewAll}
              className="rounded-full bg-[#0071e3] px-3 py-1 text-[11px] font-medium text-white transition-opacity duration-200 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
            >
              复习今天到期的 {dueCount} 道
            </button>
          ) : null}
          {onExport ? (
            <button
              type="button"
              disabled={exporting}
              onClick={() => void exportSheet()}
              className={quietActionClass}
            >
              {exporting ? '正在导出…' : '导出复习单'}
            </button>
          ) : null}
          {onClearResolved ? (
            <button
              type="button"
              disabled={clearing}
              onClick={() => void clearResolved()}
              className={quietActionClass}
            >
              {clearing
                ? '正在清空…'
                : resolvedCount > 0
                  ? `清空已掌握 ${resolvedCount} 道`
                  : '清空已掌握'}
            </button>
          ) : null}
          {onListArchived ? (
            <button
              type="button"
              aria-expanded={archived !== null}
              onClick={() => void toggleArchive()}
              className={quietActionClass}
            >
              {archived !== null ? '收起归档' : '从归档恢复'}
            </button>
          ) : null}
          <button type="button" onClick={() => void copySheet()} className={quietActionClass}>
            {copied ? '已复制' : '复制清单'}
          </button>
          {mistakes.length > 4 ? (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className={quietActionClass}
            >
              {expanded ? '收起' : '查看全部错题'}
            </button>
          ) : null}
        </div>
      </div>

      {strict ? (
        <p className="mt-2 text-[11px] text-gray-400 dark:text-[#8e8e93]">{STRICT_MASTERY_NOTE}</p>
      ) : null}

      {savedPath ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 text-[11px] text-gray-400 dark:text-[#8e8e93]"
        >
          已保存：{savedPath}
        </p>
      ) : null}
      {exportError ? (
        <p role="alert" className="mt-2 text-[11px] text-[#d70015] dark:text-[#ff7b72]">
          {exportError}
        </p>
      ) : null}
      {restoreNotice ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 text-[11px] text-gray-400 dark:text-[#8e8e93]"
        >
          {restoreNotice}
        </p>
      ) : null}

      {archived !== null ? (
        <div className="mt-3 rounded-2xl bg-white/60 p-3 dark:bg-white/[0.04]">
          <p className="text-[11px] font-medium text-gray-500 dark:text-[#8e8e93]">
            归档 · {archived.length} 道已掌握
          </p>
          {archived.length === 0 ? (
            <p className="mt-1 text-[11px] text-gray-400 dark:text-[#8e8e93]">归档里还没有错题。</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {archived.map((mistake) => (
                <li key={mistake.id} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] leading-5 text-gray-500 dark:text-[#a1a1a6]">
                      {mistake.prompt}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-[#8e8e93]">
                      {mistake.archivedAt !== undefined ? `${mistake.archivedAt} 归档 · ` : ''}
                      错 {mistake.wrongCount} 次
                    </p>
                  </div>
                  {onRestore ? (
                    <button
                      type="button"
                      aria-label={`从归档恢复：${mistake.prompt}`}
                      onClick={() => void restoreOne(mistake)}
                      className={rowActionClass}
                    >
                      恢复
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <ul className="mt-2 space-y-2.5">
        {(expanded ? mistakes : mistakes.slice(0, 4)).map((mistake) => (
          <MistakeRow
            key={mistake.id}
            mistake={mistake}
            due={dueIds?.has(mistake.id) === true}
            {...(onReview ? { onReview } : {})}
            {...(onResolve ? { onResolve } : {})}
            {...(onMakeSet ? { onMakeSet } : {})}
            {...(onSaveCause ? { onSaveCause } : {})}
          />
        ))}
      </ul>
    </div>
  );
}

type AttemptHistoryProps = {
  attempts?: PracticeAttempt[];
  set: PracticeSet | null;
  mistakes: PracticeMistake[];
};

function formatAttemptDate(value: string): string {
  const matched = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value);
  return matched ? `${matched[1]} ${matched[2]}` : value;
}

/** Collapsible answer history; prompt text is resolved when the data allows it. */
export function AttemptHistory({ attempts, set, mistakes }: AttemptHistoryProps) {
  const [expanded, setExpanded] = useState(true);

  if (!attempts || attempts.length === 0) return null;

  const ordered = [...attempts].sort(
    (a, b) => b.answeredAt.localeCompare(a.answeredAt) || b.id.localeCompare(a.id)
  );

  return (
    <section className="mt-6">
      <button
        type="button"
        aria-label="答题历史"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-2 rounded-xl text-left text-[12px] font-medium text-gray-500 transition-colors duration-200 hover:bg-[#f5f5f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#8e8e93] dark:hover:bg-white/[0.06]"
      >
        <span>答题历史</span>
        <span aria-hidden="true">· {attempts.length} 次</span>
        <span aria-hidden="true" className="ml-auto text-[#0071e3] dark:text-[#4da3ff]">
          {expanded ? '收起' : '展开'}
        </span>
      </button>

      {expanded ? (
        <ul className="mt-2 space-y-2">
          {ordered.map((attempt) => {
            const question =
              set && set.id === attempt.setId
                ? set.questions.find((entry) => entry.id === attempt.questionId)
                : undefined;
            const mistake = mistakes.find(
              (entry) =>
                entry.setId === attempt.setId && entry.questionId === attempt.questionId
            );
            const prompt = question?.prompt ?? mistake?.prompt;
            const setTitle = set && set.id === attempt.setId ? set.title : attempt.setId;

            return (
              <li
                key={attempt.id}
                className="rounded-xl bg-[#f5f5f7] px-4 py-3 dark:bg-white/[0.06]"
              >
                <div className="flex items-center gap-2 text-[11px] text-gray-400 dark:text-[#8e8e93]">
                  <span>{formatAttemptDate(attempt.answeredAt)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{setTitle}</span>
                  <span
                    className={
                      attempt.correct
                        ? 'ml-auto shrink-0 font-medium text-[#1d7f3a]'
                        : 'ml-auto shrink-0 font-medium text-[#d70015] dark:text-[#ff7b72]'
                    }
                  >
                    {attempt.correct ? '回答正确' : '回答错误'}
                  </span>
                </div>
                {prompt ? (
                  <p className="mt-1 text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">
                    {prompt}
                  </p>
                ) : null}
                {attempt.response !== undefined ? (
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-6 text-gray-400 dark:text-[#8e8e93]">
                    你写的是：{attempt.response}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
