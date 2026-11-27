import { useEffect, useState } from 'react';
import { friendlyErrorMessage } from '../../shared/errors';
import { PRACTICE_DURATION_CAP_MS } from '../../shared/practice';
import { Button } from '../ui/Button';
import { BookOpenIcon, CheckIcon, TargetIcon } from '../ui/icons';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { Progress } from '../ui/Progress';
import { cn } from '../ui/cn';
import type { Workspace, WorkspaceNote } from '../../shared/workspace';
import type {
  CreatePracticeSetInput,
  ExportMistakeSheetInput,
  ExportMistakeSheetResult,
  PracticeAttempt,
  PracticeConfidence,
  PracticeMistake,
  PracticeSet,
  SubmitAnswerInput,
  SubmitAnswerResult,
  SubmitShortAnswerInput
} from '../../shared/practice';
import { normalizeCheckpoints } from '../../shared/practice';
import { ConfidencePicker } from './CalibrationCard';
import {
  FOCUS_TICK_MS,
  WHOLE_PAPER_MAX_MINUTES,
  WHOLE_PAPER_MIN_MINUTES,
  clampWholePaperMinutes,
  defaultWholePaperMinutes,
  formatFocusTime,
  formatWholePaperSpan,
  wholePaperElapsedMs,
  wholePaperRemainingMs
} from './focus-timer';
import { buildMixedPracticeSet, type MixedPracticeSet } from './interleave';
import {
  AttemptHistory,
  MistakeBook,
  PracticeReviewChip,
  singleQuestionSetInput
} from './PracticePanels';
import { PracticeSetDialog } from './PracticeSetDialog';

type LearningPaneProps = {
  set: PracticeSet | null;
  /**
   * All practice sets in the current workspace. Supplied so the pane can offer
   * 交错混练 when two of them share one subject; omitted means never offered.
   */
  sets?: PracticeSet[];
  workspace: Workspace | null;
  /** All projects, so the practice dialog can show/choose where a set lands. */
  workspaces?: Workspace[];
  notes: WorkspaceNote[];
  mistakes: PracticeMistake[];
  /** Active mistakes due today, used to highlight and start a review. */
  dueMistakes?: PracticeMistake[];
  /** Opt-in stricter mastery; states the rule in the mistake book when on. */
  strictMastery?: boolean;
  onReviewMistake?: (mistake: PracticeMistake) => void;
  onReviewAllMistakes?: () => void;
  onResolveMistake?: (mistake: PracticeMistake) => void;
  attempts?: PracticeAttempt[];
  onSubmitAnswer: (input: SubmitAnswerInput) => Promise<SubmitAnswerResult>;
  /** Free-recall answers; the learner's self-assessment is the verdict. */
  onSubmitShortAnswer?: (input: SubmitShortAnswerInput) => Promise<SubmitAnswerResult>;
  onCreateSet?: (input: CreatePracticeSetInput) => Promise<PracticeSet>;
  /** Records the learner's 我看过了 verdict on a model-generated set. */
  onReviewSet?: (setId: string) => Promise<void>;
  /** Writes the printable sheet; omitted callers simply do not show the button. */
  onExportMistakeSheet?: (
    input: ExportMistakeSheetInput
  ) => Promise<ExportMistakeSheetResult>;
  onOpenChat: () => void;
  onOpenNote: (id: string) => void;
};

/** One answered paper question, kept only in memory for the 结卷摘要. */
interface WholePaperVerdict {
  questionId: string;
  correct: boolean;
  /** The submit path recorded an active mistake for this answer. */
  mistake: boolean;
}

/**
 * 整卷模拟 session — a way of answering one set, not a new entity. It lives
 * only in component state: leaving the page or restarting voids it, while
 * answers already handed to the submit handlers stay recorded as usual.
 */
interface WholePaperSession {
  set: PracticeSet;
  durationMs: number;
  /** Wall-clock start; remaining time derives from it, so throttling can't lie. */
  startedAt: number;
  verdicts: WholePaperVerdict[];
  ended: { reason: 'time' | 'early' | 'complete'; finishedAt: number } | null;
}

export function LearningPane({
  set,
  sets,
  workspace,
  workspaces,
  notes,
  mistakes,
  dueMistakes,
  strictMastery,
  onReviewMistake,
  onReviewAllMistakes,
  onResolveMistake,
  attempts,
  onSubmitAnswer,
  onSubmitShortAnswer,
  onCreateSet,
  onReviewSet,
  onExportMistakeSheet,
  onOpenChat,
  onOpenNote
}: LearningPaneProps) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<SubmitAnswerResult | null>(null);
  const [checking, setChecking] = useState(false);
  /** Short questions: the textarea contents. */
  const [response, setResponse] = useState('');
  /** Short questions: 提交 reveals the reference answer and self-assessment. */
  const [revealed, setRevealed] = useState(false);
  /**
   * Short questions with checkpoints: 提交 first opens the 对照检查点自查
   * step; 对答案 then reveals the reference answer. Questions without
   * checkpoints skip this state entirely and keep the baseline two-step flow.
   */
  const [selfChecked, setSelfChecked] = useState(false);
  /** Per-checkpoint self-ticks, aligned with the question's checkpoints. */
  const [checks, setChecks] = useState<boolean[]>([]);
  /** Pre-answer confidence; undefined until the learner marks one. */
  const [confidence, setConfidence] = useState<PracticeConfidence | undefined>(undefined);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  /** Quiet confirmation after a mistake becomes a one-question set. */
  const [setNotice, setSetNotice] = useState<string | null>(null);
  /** An in-memory round-robin session; null means the real selected set. */
  const [mix, setMix] = useState<MixedPracticeSet | null>(null);
  /** In-memory 整卷模拟 session; null means the normal per-question mode. */
  const [paper, setPaper] = useState<WholePaperSession | null>(null);
  /** Whether the 整卷 configuration row is open. */
  const [paperConfigOpen, setPaperConfigOpen] = useState(false);
  /** 总时长（分钟） input contents; clamped when the paper starts. */
  const [paperMinutes, setPaperMinutes] = useState('');
  /** Wall-clock snapshot the countdown renders from; a 1 Hz tick refreshes it. */
  const [clockNow, setClockNow] = useState(() => Date.now());
  /**
   * When the current question was presented. Reset at every presentation point
   * (set switch, restart, next) — never shown to the learner as a timer.
   * Unrelated to 整卷模拟's paper-level `durationMs`, which is a session budget.
   */
  const [questionShownAt, setQuestionShownAt] = useState(() => Date.now());

  function resetAnswerState() {
    setIndex(0);
    setSelected(null);
    setResult(null);
    setChecking(false);
    setResponse('');
    setRevealed(false);
    setSelfChecked(false);
    setChecks([]);
    setConfidence(undefined);
    setScore(0);
    setFinished(false);
    setError(null);
    // A fresh question is on screen: its answer clock starts now.
    setQuestionShownAt(Date.now());
  }

  /**
   * 本题用时（口径 B，item 67 sc-lead 2026-11-27）：从题目呈现到提交的墙钟差，
   * 简答题一路跑到「答对了/没答对」自评点击——与 attempt 落盘同一时刻，与选择
   * 题共用一条采集路径。客户端按 Anki `cap_answer_time_to_secs` 口径 60 秒封顶
   * （服务端还有一层归一化兜底）。只记录，不显示——不新增答题中计时器。
   */
  function measuredDurationMs(): number {
    return Math.min(PRACTICE_DURATION_CAP_MS, Math.max(0, Date.now() - questionShownAt));
  }

  useEffect(() => {
    resetAnswerState();
    // Choosing a real set leaves any mixed session behind.
    setMix(null);
    // A whole-paper session belongs to one set; switching sets voids it.
    setPaper(null);
    setPaperConfigOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set?.id]);

  // 整卷倒计时：a 1 Hz tick refreshes the wall-clock snapshot, and returning
  // to the tab settles immediately. Background throttling or system sleep only
  // reduces how often the tick fires — remaining time derives from startedAt
  // on every render, so the paper never runs slow.
  useEffect(() => {
    if (paper === null || paper.ended !== null) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), FOCUS_TICK_MS);
    const onVisible = () => setClockNow(Date.now());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [paper]);

  // 到时自动交卷：the first render that reveals the deadline has passed ends
  // the paper; questions never submitted stay unrecorded.
  useEffect(() => {
    if (paper === null || paper.ended !== null) return;
    if (wholePaperRemainingMs(paper, clockNow) > 0) return;
    setPaper((current) =>
      current && current.ended === null
        ? { ...current, ended: { reason: 'time', finishedAt: Date.now() } }
        : current
    );
  }, [paper, clockNow]);

  // Rebuilt cheaply each render; only an eligible same-subject group yields one.
  const mixable = buildMixedPracticeSet(sets ?? []);

  /** 整卷中不逐题亮对错：verdicts wait for the 结卷摘要. */
  const showVerdict = paper === null || paper.ended !== null;

  function startMixed() {
    if (!mixable) return;
    resetAnswerState();
    setMix(mixable);
  }

  function openPaperConfig() {
    if (!set) return;
    setPaperMinutes(String(defaultWholePaperMinutes(set.questions.length)));
    setPaperConfigOpen(true);
  }

  function startWholePaper() {
    if (!set) return;
    // 越界提交被钳回：the clamped value is the session's duration, whatever was typed.
    const minutes = clampWholePaperMinutes(Number(paperMinutes));
    const startedAt = Date.now();
    setPaperConfigOpen(false);
    setMix(null);
    resetAnswerState();
    setClockNow(startedAt);
    setPaper({ set, durationMs: minutes * 60_000, startedAt, verdicts: [], ended: null });
  }

  /**
   * 整卷中每题提交照走 submitAnswer/submitShortAnswer；这里只把对错记进会话
   * 内存供结卷摘要使用，全部答完时自动结卷。已结卷后的迟到结果被丢弃。
   */
  function recordPaperVerdict(result: SubmitAnswerResult) {
    setPaper((current) => {
      if (!current || current.ended !== null) return current;
      if (current.verdicts.some((verdict) => verdict.questionId === result.questionId)) {
        return current;
      }
      const verdicts = [
        ...current.verdicts,
        {
          questionId: result.questionId,
          correct: result.correct,
          mistake: result.mistake?.status === 'active'
        }
      ];
      const ended =
        verdicts.length >= current.set.questions.length
          ? { reason: 'complete' as const, finishedAt: Date.now() }
          : null;
      return { ...current, verdicts, ...(ended ? { ended } : {}) };
    });
  }

  /** 提前交卷：结卷出摘要；已落库的作答与错题原样保留。 */
  function submitPaperEarly() {
    setPaper((current) =>
      current && current.ended === null
        ? { ...current, ended: { reason: 'early', finishedAt: Date.now() } }
        : current
    );
  }

  /** 「再练一次」：回普通模式，同一套练习从第 1 题开始。 */
  function exitWholePaper() {
    setPaper(null);
    resetAnswerState();
  }

  const createButton = onCreateSet ? (
    <Button size="sm" variant="secondary" onClick={() => setCreateOpen(true)}>
      新建练习集
    </Button>
  ) : null;

  const createDialog = onCreateSet ? (
    <PracticeSetDialog
      open={createOpen}
      workspaceId={workspace?.id ?? set?.workspaceId ?? ''}
      workspaces={workspaces}
      onClose={() => setCreateOpen(false)}
      onCreate={onCreateSet}
    />
  ) : null;

  const dueIds = new Set((dueMistakes ?? []).map((mistake) => mistake.id));
  const mistakeBookWorkspaceId =
    workspace?.id ?? set?.workspaceId ?? mistakes[0]?.workspaceId ?? '';
  /** One question, one set: the book never bulk-imports. */
  async function makeSetFromMistake(mistake: PracticeMistake) {
    if (!onCreateSet) return;
    setSetNotice(null);
    setError(null);
    // The set lands wherever the mistake lives. The source set's subject is
    // closest to "the mistake's subject"; the project name is the fallback
    // when that set is gone.
    const sourceSet = sets?.find((entry) => entry.id === mistake.setId);
    const owner = workspaces?.find((entry) => entry.id === mistake.workspaceId);
    try {
      const created = await onCreateSet(
        singleQuestionSetInput(
          mistake,
          mistake.workspaceId,
          sourceSet?.subject || owner?.name || workspace?.name || ''
        )
      );
      setSetNotice(`已生成单题练习：${created.title}`);
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '生成单题练习失败，请重试。'));
    }
  }
  const mistakeBook = (
    <MistakeBook
      mistakes={mistakes}
      workspaceId={mistakeBookWorkspaceId}
      dueIds={dueIds}
      strict={strictMastery === true}
      {...(onReviewMistake ? { onReview: onReviewMistake } : {})}
      {...(onReviewAllMistakes ? { onReviewAll: onReviewAllMistakes } : {})}
      {...(onResolveMistake ? { onResolve: onResolveMistake } : {})}
      {...(onCreateSet ? { onMakeSet: (mistake: PracticeMistake) => void makeSetFromMistake(mistake) } : {})}
      {...(onExportMistakeSheet
        ? {
            onExport: () =>
              onExportMistakeSheet({ workspaceId: mistakeBookWorkspaceId, dueOnly: false })
          }
        : {})}
    />
  );

  if (!set) {
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-[#0f0f10]">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-gray-200/70 px-4 dark:border-white/10 md:px-6">
          <span className="text-[14px] font-medium text-black dark:text-[#f5f5f7]">学习</span>
          {createButton}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
          <div className="mx-auto w-full max-w-[720px]">
            <div className="rounded-2xl bg-[#f5f5f7] p-6 dark:bg-[#1c1c1e]">
              <p className="text-[14px] font-medium text-black dark:text-[#f5f5f7]">这个项目还没有练习。</p>
              <p className="mt-1 text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
                可以让阿咲当老师讲解，或者先从相关记录开始。
              </p>
              <Button className="mt-4" size="sm" onClick={onOpenChat}>
                去问阿咲
              </Button>
            </div>
            {setNotice ? (
              <p
                role="status"
                aria-live="polite"
                className="mt-3 text-[12px] text-gray-500 dark:text-[#8e8e93]"
              >
                {setNotice}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="mt-3 text-[13px] text-[#d70015] dark:text-[#ff7b72]">
                {error}
              </p>
            ) : null}
            {mistakeBook}
            <AttemptHistory attempts={attempts} set={set} mistakes={mistakes} />
            {notes.length > 0 ? (
              <div className="mt-6">
                <p className="text-[12px] font-medium text-gray-500 dark:text-[#8e8e93]">相关记录</p>
                <div className="mt-2 space-y-1">
                  {notes.slice(0, 4).map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => onOpenNote(note.id)}
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] text-[#0071e3] dark:text-[#4da3ff] transition-colors duration-200 hover:bg-[#f5f5f7] dark:hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
                    >
                      <BookOpenIcon className="h-3.5 w-3.5" />
                      {note.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {createDialog}
      </div>
    );
  }

  // A mix replaces the displayed set but never the real one used for lookups.
  const activeSet: PracticeSet = mix ?? set;
  const question = activeSet.questions[index];
  /** Mixed sessions only: the original set's title for this question. */
  const sourceTitle = mix ? mix.sources[question.id] : undefined;
  const answered = result !== null;
  const correct = result?.correct === true;
  const last = index === activeSet.questions.length - 1;
  /** Free recall: the learner has answered, the reference answer is visible. */
  const isShort = question.kind === 'short';
  /**
   * The 2-3 checkpoint sentences for this question, re-normalized on render so
   * a stray vault value can never open the self-check step. Choice questions
   * and checkpoint-less short questions keep the baseline flow exactly.
   */
  const questionCheckpoints = isShort ? (normalizeCheckpoints(question.checkpoints) ?? []) : [];
  const hasCheckpoints = questionCheckpoints.length > 0;
  const awaitingSelfAssessment = isShort && revealed && !answered;
  /** Checkpoint questions only: the self-check step between 提交 and 对答案. */
  const awaitingCheckpointCheck = isShort && selfChecked && !revealed && !answered;
  const responseReady = response.trim() !== '' && !answered && !checking;
  // 结卷摘要 numbers: the denominator is the whole paper (未作答 included),
  // deliberately different from attempt history's answered-only denominator.
  const paperTotal = paper ? paper.set.questions.length : 0;
  const paperCorrect = paper ? paper.verdicts.filter((verdict) => verdict.correct).length : 0;
  const paperUnanswered = paperTotal - (paper ? paper.verdicts.length : 0);
  const paperHasMistake = paper ? paper.verdicts.some((verdict) => verdict.mistake) : false;
  const paperSummaryLine = paper?.ended
    ? `整卷完成：正确 ${paperCorrect} / ${paperTotal} 题${
        paperUnanswered > 0 ? `，未作答 ${paperUnanswered} 题` : ''
      }，用时 ${formatWholePaperSpan(wholePaperElapsedMs(paper, paper.ended.finishedAt))}。${
        paperHasMistake ? '错题已记入错题本。' : ''
      }`
    : '';
  const paperVerdictById = paper
    ? new Map(paper.verdicts.map((verdict) => [verdict.questionId, verdict]))
    : new Map<string, WholePaperVerdict>();

  async function check() {
    if (selected === null || answered || checking) return;
    setChecking(true);
    setError(null);
    try {
      const submitted = await onSubmitAnswer({
        questionId: question.id,
        choice: selected,
        durationMs: measuredDurationMs(),
        ...(confidence !== undefined ? { confidence } : {})
      });
      setResult(submitted);
      if (submitted.correct) setScore((current) => current + 1);
      recordPaperVerdict(submitted);
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '提交答案失败，请重试。'));
    } finally {
      setChecking(false);
    }
  }

  /**
   * 提交: nothing is recorded yet — just open the next look. A checkpoint
   * question goes to the 对照检查点自查 step (the reference answer stays
   * hidden), every other question reveals it directly as before.
   */
  function reveal() {
    if (!responseReady) return;
    setError(null);
    if (hasCheckpoints) {
      setChecks(questionCheckpoints.map(() => false));
      setSelfChecked(true);
      return;
    }
    setRevealed(true);
  }

  /** 对答案: the self-check is done; the reference answer becomes visible. */
  function revealReference() {
    if (revealed || checking) return;
    setError(null);
    setRevealed(true);
  }

  /** Ticks one checkpoint in the 对照检查点自查 step; never scored. */
  function toggleCheckpoint(index: number) {
    setChecks((current) =>
      current.map((hit, entryIndex) => (entryIndex === index ? !hit : hit))
    );
  }

  /**
   * 答对了 / 没答对: recording happens HERE. ASAKI is local-first and has no
   * grader, so an automatic check is not honest — the learner compares their
   * own recall with the reference answer and that verdict drives the same
   * spaced-repetition scheduler a choice answer would.
   */
  async function selfAssess(selfCorrect: boolean) {
    if (!awaitingSelfAssessment || checking) return;
    if (!onSubmitShortAnswer) {
      setError('当前存储不支持简答作答。');
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const submitted = await onSubmitShortAnswer({
        questionId: question.id,
        response,
        selfCorrect,
        // 口径 B: the clock stops here, at the recording click (see measuredDurationMs).
        durationMs: measuredDurationMs(),
        // The self-check ticks ride along for the attempt record; they never
        // change `correct` or the schedule. Only aligned ticks are sent.
        ...(hasCheckpoints && checks.length === questionCheckpoints.length
          ? { checkpointHits: checks }
          : {}),
        ...(confidence !== undefined ? { confidence } : {})
      });
      setResult(submitted);
      if (submitted.correct) setScore((current) => current + 1);
      recordPaperVerdict(submitted);
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '提交答案失败，请重试。'));
    } finally {
      setChecking(false);
    }
  }

  function next() {
    if (last) {
      // 整卷兜底：the normal path auto-ends the paper on the last submit, so
      // reaching here means the final verdict never landed — close the paper.
      if (paper !== null) {
        submitPaperEarly();
        return;
      }
      setFinished(true);
      return;
    }
    setIndex((current) => current + 1);
    setSelected(null);
    setResult(null);
    setResponse('');
    setRevealed(false);
    setSelfChecked(false);
    setChecks([]);
    setConfidence(undefined);
    setError(null);
    // Next question on screen: its answer clock starts fresh.
    setQuestionShownAt(Date.now());
  }

  /** 再练一次：回到第 1 题，与首次呈现完全相同的初始状态（含答题时钟）。 */
  function restart() {
    resetAnswerState();
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-[#0f0f10]">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-gray-200/70 px-4 dark:border-white/10 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[14px] font-medium text-black dark:text-[#f5f5f7]">学习</span>
          <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">/</span>
          <span className="truncate text-[12px] text-gray-500 dark:text-[#8e8e93]">{activeSet.title}</span>
          <PracticeReviewChip
            set={activeSet}
            {...(onReviewSet
              ? {
                  onReviewed: async () => {
                    await onReviewSet(activeSet.id);
                  }
                }
              : {})}
          />
        </div>
        <div className="flex items-center gap-2">
          {createButton}
          <Button size="sm" variant="secondary" onClick={onOpenChat}>
            问阿咲
          </Button>
        </div>
      </header>

      {paper !== null && paper.ended === null ? (
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-gray-200/70 px-4 dark:border-white/10 md:px-6">
          <span className="text-[12px] font-medium text-gray-500 dark:text-[#8e8e93]">
            整卷模拟 · {activeSet.title}
          </span>
          <div className="flex items-center gap-2">
            <span
              role="timer"
              aria-label="整卷剩余时间"
              className="text-[14px] font-semibold tabular-nums text-black dark:text-[#f5f5f7]"
            >
              {formatFocusTime(wholePaperRemainingMs(paper, clockNow))}
            </span>
            <Button size="sm" variant="secondary" onClick={submitPaperEarly}>
              提前交卷
            </Button>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto w-full max-w-[720px]">
          {setNotice ? (
            <p
              role="status"
              aria-live="polite"
              className="mb-4 text-[12px] text-gray-500 dark:text-[#8e8e93]"
            >
              {setNotice}
            </p>
          ) : null}
          {set && !paper ? (
            paperConfigOpen ? (
              <div
                role="group"
                aria-label="整卷模拟配置"
                className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-[#f5f5f7] px-4 py-3 dark:bg-white/[0.06]"
              >
                <div>
                  <Label htmlFor="whole-paper-minutes" className="mb-1">
                    总时长（分钟）
                  </Label>
                  <Input
                    id="whole-paper-minutes"
                    type="number"
                    min={WHOLE_PAPER_MIN_MINUTES}
                    max={WHOLE_PAPER_MAX_MINUTES}
                    value={paperMinutes}
                    onChange={(event) => setPaperMinutes(event.target.value)}
                    className="w-28"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={startWholePaper}>
                    确认开始
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setPaperConfigOpen(false)}>
                    取消
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  'mb-4 flex items-center gap-3 rounded-xl bg-[#f5f5f7] px-4 py-2.5 dark:bg-white/[0.06]',
                  mixable ? 'justify-between' : 'justify-end'
                )}
              >
                {mixable ? (
                  <p className="min-w-0 text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
                    把「{mixable.subject}」的多份练习交错着做，比一次做完一套记得更牢。
                  </p>
                ) : null}
                <div className="flex shrink-0 items-center gap-2">
                  {mixable ? (
                    <Button size="sm" variant="secondary" onClick={startMixed}>
                      交错混练
                    </Button>
                  ) : null}
                  <Button size="sm" variant="secondary" onClick={openPaperConfig}>
                    整卷模拟
                  </Button>
                </div>
              </div>
            )
          ) : null}
          {paper && paper.ended ? (
            <div className="rounded-2xl bg-[#f5f5f7] p-8 text-center dark:bg-[#1c1c1e]">
              {paper.ended.reason === 'time' ? (
                <p
                  role="status"
                  className="text-[13px] font-medium text-[#0071e3] dark:text-[#4da3ff]"
                >
                  时间到，自动交卷。
                </p>
              ) : null}
              <p className="mt-2 text-[14px] leading-6 text-black dark:text-[#f5f5f7]">
                {paperSummaryLine}
              </p>
              <ul className="mt-4 space-y-1 text-left">
                {paper.set.questions.map((paperQuestion, paperIndex) => {
                  const verdict = paperVerdictById.get(paperQuestion.id);
                  return (
                    <li
                      key={paperQuestion.id}
                      className={
                        verdict === undefined
                          ? 'text-[12px] font-medium text-[#8a5a00] dark:text-[#ffb340]'
                          : verdict.correct
                            ? 'text-[12px] text-[#1d7f3a]'
                            : 'text-[12px] text-[#d70015] dark:text-[#ff7b72]'
                      }
                    >
                      {`第 ${paperIndex + 1} 题 · ${
                        verdict === undefined
                          ? '未作答'
                          : verdict.correct
                            ? '回答正确'
                            : '回答错误'
                      }`}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 flex justify-center gap-2">
                <Button size="sm" onClick={exitWholePaper}>
                  再练一次
                </Button>
                <Button size="sm" variant="secondary" onClick={onOpenChat}>
                  问阿咲
                </Button>
              </div>
            </div>
          ) : finished ? (
            <div className="rounded-2xl bg-[#f5f5f7] p-8 text-center dark:bg-[#1c1c1e]">
              <p className="text-[16px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">练习完成</p>
              <p className="mt-2 text-[28px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">
                {score} / {activeSet.questions.length}
              </p>
              <p className="mt-1 text-[13px] text-gray-500 dark:text-[#8e8e93]">
                {score === activeSet.questions.length ? '全对，继续保持。' : '错题已经记下来，晚点复盘再看一遍。'}
              </p>
              {mistakes.length > 0 ? (
                <p className="mt-1 text-[12px] text-gray-500 dark:text-[#8e8e93]">
                  错题本还有 {mistakes.length} 道待复习。
                </p>
              ) : null}
              <div className="mt-4 flex justify-center gap-2">
                <Button size="sm" onClick={restart}>
                  再练一次
                </Button>
                <Button size="sm" variant="secondary" onClick={onOpenChat}>
                  问阿咲
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 text-[12px] text-gray-500 dark:text-[#8e8e93]">
                <span className="inline-flex items-center gap-1.5">
                  <TargetIcon className="h-3.5 w-3.5" />
                  {activeSet.subject}
                </span>
                <span>
                  {index + 1} / {activeSet.questions.length}
                </span>
              </div>
              <div className="mt-2">
                <Progress value={index + 1} max={activeSet.questions.length} ariaLabel="练习进度" />
              </div>

              <h1 className="mt-6 text-[18px] font-semibold leading-7 tracking-tight text-black dark:text-[#f5f5f7]">
                {question.prompt}
              </h1>

              {sourceTitle ? (
                <p className="mt-1 text-[11px] text-gray-400 dark:text-[#8e8e93]">
                  来自：{sourceTitle}
                </p>
              ) : null}

              <ConfidencePicker
                value={confidence}
                disabled={answered || checking}
                onChange={setConfidence}
              />

              {isShort ? (
                <>
                  <label
                    htmlFor="practice-short-response"
                    className="mt-4 block text-[12px] font-medium text-gray-500 dark:text-[#8e8e93]"
                  >
                    用你自己的话回答
                  </label>
                  <textarea
                    id="practice-short-response"
                    value={response}
                    rows={4}
                    disabled={revealed || checking}
                    onChange={(event) => setResponse(event.target.value)}
                    className="mt-2 w-full resize-none rounded-xl border border-gray-200/70 bg-white px-4 py-3 text-[14px] leading-6 text-black outline-none transition-colors duration-200 focus:border-[#0071e3]/40 focus:ring-2 focus:ring-[#0071e3]/20 disabled:cursor-default disabled:bg-[#f5f5f7] disabled:text-gray-500 dark:border-white/10 dark:bg-[#242426] dark:text-[#f5f5f7] dark:focus:border-[#0a84ff]/50"
                  />
                  {awaitingCheckpointCheck ? (
                    <div
                      role="group"
                      aria-label="对照检查点自查"
                      className="mt-4 rounded-xl bg-[#f5f5f7] px-4 py-3 dark:bg-[#1c1c1e]"
                    >
                      <p className="text-[13px] font-medium text-black dark:text-[#f5f5f7]">
                        对照检查点自查
                      </p>
                      <p className="mt-1 text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
                        先别看参考答案——对照下面几条，勾出你已经答到的。
                      </p>
                      <ul className="mt-2 space-y-2">
                        {questionCheckpoints.map((checkpoint, checkpointIndex) => {
                          const checkboxId = `checkpoint-${question.id}-${checkpointIndex}`;
                          return (
                            <li key={checkboxId} className="flex items-start gap-2.5">
                              <input
                                id={checkboxId}
                                type="checkbox"
                                checked={checks[checkpointIndex] === true}
                                onChange={() => toggleCheckpoint(checkpointIndex)}
                                className="mt-1 h-4 w-4 shrink-0 accent-[#0071e3]"
                              />
                              <label
                                htmlFor={checkboxId}
                                className="text-[13px] leading-6 text-black dark:text-[#f5f5f7]"
                              >
                                {checkpoint}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                  {revealed ? (
                    <div className="mt-4 rounded-xl bg-[#f5f5f7] px-4 py-3 dark:bg-[#1c1c1e]">
                      <p className="text-[13px] leading-6 text-black dark:text-[#f5f5f7]">
                        参考答案：{question.referenceAnswer ?? ''}
                      </p>
                      {/* The learner's own words are kept as typed. */}
                      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">
                        你写的是：{response}
                      </p>
                      {hasCheckpoints ? (
                        <ul aria-label="检查点对照" className="mt-2 space-y-1">
                          {questionCheckpoints.map((checkpoint, checkpointIndex) => {
                            const hit = checks[checkpointIndex] === true;
                            return (
                              <li
                                key={checkpointIndex}
                                data-hit={hit ? 'true' : 'false'}
                                className={cn(
                                  'rounded-lg px-2 py-1 text-[13px] leading-6',
                                  hit
                                    ? 'text-gray-500 dark:text-[#a1a1a6]'
                                    : // 漏勾是信息不是错误：neutral amber, never the red verdict.
                                      'bg-[#ffb340]/10 font-medium text-[#8a5a00] dark:text-[#ffb340]'
                                )}
                              >
                                {hit ? `✓ ${checkpoint}` : `${checkpoint}（没答到）`}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                      {question.explanation ? (
                        <p className="mt-2 text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">
                          {question.explanation}
                        </p>
                      ) : null}
                      {answered ? (
                        showVerdict ? (
                          <>
                            <p
                              className={cn(
                                'mt-2 text-[13px] font-medium',
                                correct ? 'text-[#1d7f3a]' : 'text-[#d70015] dark:text-[#ff7b72]'
                              )}
                            >
                              {correct ? '回答正确' : '回答错误'}
                            </p>
                            {result?.mistake?.status === 'active' ? (
                              <p className="mt-2 text-[12px] text-gray-500 dark:text-[#8e8e93]" role="status">
                                已加入错题本，{result.mistake.due} 复习。
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <p
                            role="status"
                            className="mt-2 text-[12px] text-gray-500 dark:text-[#8e8e93]"
                          >
                            已提交。
                          </p>
                        )
                      ) : (
                        <p className="mt-3 text-[12px] text-gray-500 dark:text-[#8e8e93]">
                          对照参考答案自评，这一步会决定下次复习时间。
                        </p>
                      )}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="mt-4 space-y-2">
                  {question.options.map((option, optionIndex) => {
                    // 整卷中不亮对错：options stay neutral until the paper closes.
                    const isCorrect = showVerdict && answered && optionIndex === result.answer;
                    const isWrong =
                      showVerdict && answered && optionIndex === selected && !result?.correct;
                    return (
                      <button
                        key={option}
                        type="button"
                        disabled={answered || checking}
                        onClick={() => setSelected(optionIndex)}
                        aria-pressed={selected === optionIndex}
                        aria-label={`${String.fromCharCode(65 + optionIndex)}. ${option}`}
                        className={cn(
                          'flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-[14px] leading-6 transition-colors duration-200 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30',
                          isCorrect
                            ? 'border-[#34c759]/30 bg-[#34c759]/10 dark:bg-[#34c759]/15 text-black dark:text-[#f5f5f7]'
                            : isWrong
                              ? 'border-[#d70015]/20 bg-[#ff3b30]/10 dark:bg-[#ff3b30]/15 text-black dark:text-[#f5f5f7]'
                              : selected === optionIndex
                                ? 'border-[#0071e3]/30 bg-[#0071e3]/5 dark:bg-[#0a84ff]/10 text-black dark:text-[#f5f5f7]'
                                : 'border-gray-200/70 dark:border-white/10 bg-white dark:bg-[#242426] text-gray-500 dark:text-[#a1a1a6] hover:bg-[#f5f5f7] dark:hover:bg-white/[0.06]'
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gray-200 dark:border-white/10 text-[11px] font-medium text-gray-500 dark:text-[#8e8e93]"
                        >
                          {String.fromCharCode(65 + optionIndex)}
                        </span>
                        <span>{option}</span>
                        {isCorrect ? <CheckIcon className="ml-auto h-4 w-4 shrink-0 text-[#34c759]" /> : null}
                      </button>
                    );
                  })}
                </div>
              )}

              {error ? (
                <p role="alert" className="mt-3 text-[13px] text-[#d70015] dark:text-[#ff7b72]">
                  {error}
                </p>
              ) : null}

              {!isShort && answered && showVerdict ? (
                <div className="mt-4 rounded-xl bg-[#f5f5f7] px-4 py-3 dark:bg-[#1c1c1e]">
                  <p className={cn('text-[13px] font-medium', correct ? 'text-[#1d7f3a]' : 'text-[#d70015] dark:text-[#ff7b72]')}>
                    {correct ? '回答正确' : '回答错误'}
                  </p>
                  <p className="mt-1 text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">{result.explanation}</p>
                  {result.mistake?.status === 'active' ? (
                    <p className="mt-2 text-[12px] text-gray-500 dark:text-[#8e8e93]" role="status">
                      已加入错题本，{result.mistake.due} 复习。
                    </p>
                  ) : null}
                </div>
              ) : null}
              {!isShort && answered && !showVerdict ? (
                <p role="status" className="mt-3 text-[12px] text-gray-500 dark:text-[#8e8e93]">
                  已提交。
                </p>
              ) : null}

              <div className="mt-5 flex gap-2">
                {isShort ? (
                  <>
                    {!revealed && !selfChecked ? (
                      <Button size="sm" disabled={!responseReady} onClick={reveal}>
                        提交
                      </Button>
                    ) : null}
                    {awaitingCheckpointCheck ? (
                      <Button size="sm" variant="secondary" onClick={revealReference}>
                        对答案
                      </Button>
                    ) : null}
                    {awaitingSelfAssessment ? (
                      <>
                        <Button size="sm" disabled={checking} onClick={() => void selfAssess(true)}>
                          答对了
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={checking}
                          onClick={() => void selfAssess(false)}
                        >
                          没答对
                        </Button>
                      </>
                    ) : null}
                    {answered ? (
                      <Button size="sm" variant="secondary" onClick={next}>
                        {last ? '完成练习' : '下一题'}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Button size="sm" disabled={selected === null || answered || checking} onClick={() => void check()}>
                      {checking ? '正在提交…' : '检查答案'}
                    </Button>
                    {answered ? (
                      <Button size="sm" variant="secondary" onClick={next}>
                        {last ? '完成练习' : '下一题'}
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </>
          )}
          {/* 整卷进行中隐藏错题本与答题历史——两者都会泄露单题对错。 */}
          {showVerdict ? mistakeBook : null}
          {showVerdict ? (
            <AttemptHistory attempts={attempts} set={set} mistakes={mistakes} />
          ) : null}
        </div>
      </div>
      {createDialog}
    </div>
  );
}
