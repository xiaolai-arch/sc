import { useEffect, useRef, useState } from 'react';
import { formatLocalDate } from '../../shared/date';
import { friendlyErrorMessage } from '../../shared/errors';
import { buildMistakeSheet } from '../../shared/practice-sheet';
import type {
  CreatePracticeQuestionInput,
  CreatePracticeSetInput,
  ExportMistakeSheetResult,
  PracticeAttempt,
  PracticeMistake,
  PracticeSet
} from '../../shared/practice';

type MistakeBookProps = {
  mistakes: PracticeMistake[];
  /** Workspace the listed mistakes belong to; stamped into the copied sheet. */
  workspaceId?: string;
  /** Mistake ids that are due today. */
  dueIds?: ReadonlySet<string>;
  onReview?: (mistake: PracticeMistake) => void;
  onReviewAll?: () => void;
  onResolve?: (mistake: PracticeMistake) => void;
  /** Turns one mistake into a single-question practice set in this project. */
  onMakeSet?: (mistake: PracticeMistake) => void;
  /** Writes the printable sheet to the vault; its path is shown afterwards. */
  onExport?: () => Promise<ExportMistakeSheetResult>;
};

type MistakeRowProps = {
  mistake: PracticeMistake;
  due: boolean;
  onReview?: (mistake: PracticeMistake) => void;
  onResolve?: (mistake: PracticeMistake) => void;
  onMakeSet?: (mistake: PracticeMistake) => void;
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
function sheetFor(mistakes: readonly PracticeMistake[], workspaceId: string): string {
  return buildMistakeSheet({
    workspaceId,
    date: formatLocalDate(new Date()),
    mistakes
  });
}

function MistakeRow({ mistake, due, onReview, onResolve, onMakeSet }: MistakeRowProps) {
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
        <p className="text-[11px] text-gray-400 dark:text-[#8e8e93]">
          {due ? '今天复习 · ' : ''}
          {mistake.due} 复习 · 错 {mistake.wrongCount} 次 · 优先级 {mistake.priority}
        </p>
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
  onReview,
  onReviewAll,
  onResolve,
  onMakeSet,
  onExport
}: MistakeBookProps) {
  const [expanded, setExpanded] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    };
  }, []);

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

  async function copySheet() {
    try {
      await navigator.clipboard?.writeText(
        sheetFor(mistakes, workspaceId ?? mistakes[0]?.workspaceId ?? '')
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

      <ul className="mt-2 space-y-2.5">
        {(expanded ? mistakes : mistakes.slice(0, 4)).map((mistake) => (
          <MistakeRow
            key={mistake.id}
            mistake={mistake}
            due={dueIds?.has(mistake.id) === true}
            {...(onReview ? { onReview } : {})}
            {...(onResolve ? { onResolve } : {})}
            {...(onMakeSet ? { onMakeSet } : {})}
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
