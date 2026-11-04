import { useState, type FormEvent } from 'react';
import { formatLocalDate } from '../../shared/date';
import { reviewStreak } from '../../shared/review-stats';
import { weeklyOverview } from '../../shared/weekly-stats';
import { friendlyErrorMessage } from '../../shared/errors';
import type { ReviewRecord } from '../../shared/ipc';
import type { KnowledgeTopic } from '../../shared/knowledge';
import type { PracticeAttempt, PracticeMistake } from '../../shared/practice';
import type {
  SubmitReviewInput,
  Workspace,
  WorkspaceTask
} from '../../shared/workspace';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { PageFrame } from './PageFrame';
import { ReviewRecords } from './ReviewRecords';
import { WeeklyOverview } from './WeeklyOverview';

type ReviewPageProps = {
  workspaces: Workspace[];
  reviews: ReviewRecord[];
  /** Backing data for the weekly overview; omitted by lightweight callers. */
  tasks?: WorkspaceTask[];
  attempts?: PracticeAttempt[];
  dueMistakes?: PracticeMistake[];
  knowledgeTopics?: KnowledgeTopic[];
  onOpenSidebar: () => void;
  onPrompt: (prompt: string, workspaceId?: string) => void;
  /** Persists a manual backfill; when omitted the backfill button is hidden. */
  onSubmitReview?: (input: SubmitReviewInput) => Promise<void>;
  /** Called after a successful backfill so the parent can reload reviews. */
  onSubmitted?: () => void;
};

const filterClass =
  'h-9 rounded-xl border-0 bg-[#f5f5f7] px-3 text-[13px] text-gray-700 outline-none transition-all duration-200 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#a1a1a6]';

export function ReviewPage({
  workspaces,
  reviews,
  tasks = [],
  attempts = [],
  dueMistakes = [],
  knowledgeTopics = [],
  onOpenSidebar,
  onPrompt,
  onSubmitReview,
  onSubmitted
}: ReviewPageProps) {
  const [filterId, setFilterId] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [date, setDate] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [completed, setCompleted] = useState('');
  const [stuck, setStuck] = useState('');
  const [tomorrow, setTomorrow] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = formatLocalDate(new Date());
  const filteredWorkspace = workspaces.find((workspace) => workspace.id === filterId) ?? null;
  const todayDate = new Date();
  const yesterday = new Date(
    todayDate.getFullYear(),
    todayDate.getMonth(),
    todayDate.getDate() - 1
  );
  const reviewedToday = reviews.some((review) => review.date === today);
  // Before today's review, keep showing the streak that is still alive so the
  // number does not drop to zero first thing in the morning.
  const streak = reviewedToday
    ? reviewStreak(reviews, today)
    : reviewStreak(reviews, formatLocalDate(yesterday));

  const inFilter = (workspaceId?: string) => !filterId || workspaceId === filterId;
  const filteredTasks = tasks.filter((task) => inFilter(task.workspaceId));
  const filteredAttempts = attempts.filter((attempt) => inFilter(attempt.workspaceId));
  const filteredDue = dueMistakes.filter((mistake) => inFilter(mistake.workspaceId));
  const filteredTopics = knowledgeTopics.filter(
    (topic) => !filterId || !topic.workspaceId || topic.workspaceId === filterId
  );
  const filteredReviews = reviews.filter((review) => inFilter(review.workspaceId));
  const overview = weeklyOverview({
    tasks: filteredTasks,
    attempts: filteredAttempts,
    reviews: filteredReviews,
    dueMistakes: filteredDue,
    topics: filteredTopics,
    today: todayDate
  });
  const hasOverviewData =
    filteredReviews.length +
      filteredTasks.length +
      filteredAttempts.length +
      filteredDue.length +
      filteredTopics.length >
    0;

  const openBackfill = () => {
    setDate(today);
    // Default to the active filter, but leave "全局" selectable.
    setWorkspaceId(filterId);
    setCompleted('');
    setStuck('');
    setTomorrow('');
    setError(null);
    setPending(false);
    setDialogOpen(true);
  };

  const closeBackfill = () => {
    setDialogOpen(false);
    setError(null);
  };

  const submitBackfill = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onSubmitReview || pending) return;

    if (!date) {
      setError('请选择日期。');
      return;
    }
    if (date > today) {
      setError('日期不能晚于今天。');
      return;
    }

    const answers = {
      completed: completed.trim(),
      stuck: stuck.trim(),
      tomorrow: tomorrow.trim()
    };
    if (!answers.completed && !answers.stuck && !answers.tomorrow) {
      setError('至少填写完成、卡点或明天中的一项。');
      return;
    }

    setError(null);
    setPending(true);
    try {
      await onSubmitReview({
        date,
        ...(workspaceId ? { workspaceId } : {}),
        answers
      });
      setDialogOpen(false);
      onSubmitted?.();
    } catch (cause) {
      setError(friendlyErrorMessage(cause));
    } finally {
      setPending(false);
    }
  };

  const showActions = workspaces.length > 0 || Boolean(onSubmitReview);

  return (
    <PageFrame
      title="复盘"
      subtitle={filteredWorkspace?.name ?? '全部工作区'}
      onOpenSidebar={onOpenSidebar}
      action={
        showActions ? (
          <div className="flex items-center gap-2">
            {workspaces.length > 0 ? (
              <select
                aria-label="按工作区筛选复盘"
                value={filterId}
                onChange={(event) => setFilterId(event.target.value)}
                className={filterClass}
              >
                <option value="">全部工作区</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            ) : null}
            {onSubmitReview ? (
              <Button size="sm" onClick={openBackfill}>
                补录复盘
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      {hasOverviewData ? <WeeklyOverview overview={overview} /> : null}

      {reviews.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-gray-500 dark:text-[#a1a1a6]">
          <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
            连续复盘 {streak} 天
          </span>
          {!reviewedToday ? (
            <span className="ml-auto font-medium text-[#0071e3] dark:text-[#4da3ff]">
              今天还没复盘
            </span>
          ) : null}
        </div>
      ) : null}

      <ReviewRecords
        workspaces={workspaces}
        workspace={filteredWorkspace}
        reviews={reviews}
        onPrompt={(prompt) => onPrompt(prompt, filteredWorkspace?.id)}
      />

      {onSubmitReview ? (
        <Dialog open={dialogOpen} onClose={closeBackfill} title="补录复盘">
          <form onSubmit={(event) => void submitBackfill(event)} className="space-y-4">
            <div>
              <Label htmlFor="review-date">日期</Label>
              <Input
                id="review-date"
                type="date"
                value={date}
                max={today}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </div>
            <div>
              <Label htmlFor="review-workspace">工作区</Label>
              <Select
                id="review-workspace"
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
              >
                <option value="">全局（不选工作区）</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="review-completed">完成</Label>
              <Textarea
                id="review-completed"
                value={completed}
                onChange={(event) => setCompleted(event.target.value)}
                rows={3}
                placeholder="今天完成了什么？"
              />
            </div>
            <div>
              <Label htmlFor="review-stuck">卡点</Label>
              <Textarea
                id="review-stuck"
                value={stuck}
                onChange={(event) => setStuck(event.target.value)}
                rows={2}
                placeholder="哪里卡住了？"
              />
            </div>
            <div>
              <Label htmlFor="review-tomorrow">明天</Label>
              <Textarea
                id="review-tomorrow"
                value={tomorrow}
                onChange={(event) => setTomorrow(event.target.value)}
                rows={2}
                placeholder="明天准备做什么？"
              />
            </div>
            {error ? (
              <p role="alert" className="text-[12px] text-[#d70015] dark:text-[#ff7b72]">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" size="sm" onClick={closeBackfill}>
                取消
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? '保存中…' : '保存'}
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </PageFrame>
  );
}
