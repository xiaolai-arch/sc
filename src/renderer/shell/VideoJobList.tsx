import { useCallback, useEffect, useState } from 'react';
import { friendlyErrorMessage } from '../../shared/errors';
import type {
  VideoJob,
  VideoJobLesson,
  VideoJobStatus,
  VideoLessonStatus,
  VideoNotesMode
} from '../../shared/video-notes';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

type VideoJobListProps = {
  open: boolean;
  onClose: () => void;
};

const STATUS_LABELS: Record<VideoJobStatus, string> = {
  queued: '排队中',
  running: '运行中',
  done: '已完成',
  failed: '有失败',
  cancelled: '已取消',
  interrupted: '已中断'
};

const LESSON_LABELS: Record<VideoLessonStatus, string> = {
  pending: '等待',
  running: '进行中',
  done: '完成',
  failed: '失败',
  skipped: '跳过'
};

const QUICK_STEP_LABELS: Record<string, string> = {
  probe: '读取视频信息',
  transcribe: '语音转写',
  render: '整理笔记',
  done: '完成'
};

const DECK_STEP_LABELS: Record<string, string> = {
  probe: '读取视频信息',
  transcribe: '语音转写',
  keyframes: '关键帧',
  'screen-read': '读屏',
  outline: '大纲',
  notes: '整理笔记',
  enrich: '补充',
  'factcheck-a': '核查',
  'factcheck-b': '核查',
  compose: '合成课件',
  render: '渲染',
  layout: '排版',
  export: 'PDF',
  report: '报告',
  done: '完成'
};

function stepLabel(step: string, mode: VideoNotesMode): string {
  const labels = mode === 'deck' ? DECK_STEP_LABELS : QUICK_STEP_LABELS;
  return labels[step] ?? step;
}

const MODE_LABELS: Record<VideoNotesMode, string> = {
  quick: '快速笔记',
  deck: '完整课件（预览）'
};

function fileName(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return index >= 0 ? path.slice(index + 1) : path;
}

function statusClass(status: VideoJobStatus): string {
  switch (status) {
    case 'running':
      return 'text-[#0071e3] dark:text-[#4da3ff]';
    case 'done':
      return 'text-[#34c759]';
    case 'failed':
      return 'text-[#ff3b30]';
    case 'interrupted':
    case 'cancelled':
      return 'text-[#ff9f0a]';
    default:
      return 'text-gray-500 dark:text-[#8e8e93]';
  }
}

function lessonClass(status: VideoLessonStatus): string {
  switch (status) {
    case 'running':
      return 'text-[#0071e3] dark:text-[#4da3ff]';
    case 'done':
      return 'text-[#34c759]';
    case 'failed':
      return 'text-[#ff3b30]';
    default:
      return 'text-gray-500 dark:text-[#8e8e93]';
  }
}

function jobUsage(job: VideoJob): number {
  return job.usage.inputTokens + job.usage.outputTokens;
}

function lessonAction(
  label: string,
  onClick: () => void,
  key?: string
): { label: string; onClick: () => void; key: string } {
  return { label, onClick, key: key ?? label };
}

/**
 * Background video-job list: per-lesson progress plus cancel, resume, retry,
 * and shortcuts to the generated note, deck and report.
 */
export function VideoJobList({ open, onClose }: VideoJobListProps) {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = window.studyCoach;
    if (!api || typeof api.listVideoJobs !== 'function') return;
    try {
      setJobs(await api.listVideoJobs());
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '读取任务列表失败。'));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const api = window.studyCoach;
    setError(null);
    setLoading(true);
    const unsubscribe =
      api && typeof api.onVideoJobsChanged === 'function'
        ? api.onVideoJobsChanged((next) => setJobs(next))
        : null;
    void refresh().finally(() => setLoading(false));
    return () => {
      unsubscribe?.();
    };
  }, [open, refresh]);

  async function openPath(path: string): Promise<void> {
    const api = window.studyCoach;
    if (!api) return;
    try {
      const message = await api.openPath(path);
      if (message) setError(message);
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '无法打开文件。'));
    }
  }

  async function act(jobId: string, run: () => Promise<unknown>): Promise<void> {
    setBusyId(jobId);
    setError(null);
    try {
      await run();
      await refresh();
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '操作失败，请重试。'));
    } finally {
      setBusyId(null);
    }
  }

  function lessonActions(job: VideoJob, lesson: VideoJobLesson) {
    const actions = [];
    if (lesson.status === 'failed') {
      actions.push(
        lessonAction('重试本讲', () =>
          void act(
            job.id,
            () =>
              window.studyCoach?.retryVideoLesson?.({
                jobId: job.id,
                videoPath: lesson.videoPath
              }) ?? Promise.resolve()
          )
        )
      );
    }
    if (job.mode === 'quick' && lesson.htmlPath) {
      actions.push(lessonAction('打开笔记', () => void openPath(lesson.htmlPath!)));
    }
    if (lesson.slidesPath) {
      actions.push(lessonAction('打开课件', () => void openPath(lesson.slidesPath!)));
    }
    if (lesson.reportPath) {
      actions.push(lessonAction('打开报告', () => void openPath(lesson.reportPath!)));
    }
    return actions;
  }

  const activeCount = jobs.filter(
    (job) => job.status === 'queued' || job.status === 'running'
  ).length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="视频任务"
      widthClassName="max-w-3xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] text-gray-500 dark:text-[#8e8e93]">
            {activeCount > 0 ? `${activeCount} 个任务正在进行` : '没有正在运行的任务'}
          </p>
          <Button variant="secondary" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error ? (
          <p role="alert" className="text-[12px] text-[#ff3b30]">
            {error}
          </p>
        ) : null}

        {loading && jobs.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-gray-500 dark:text-[#8e8e93]">
            正在读取任务…
          </p>
        ) : null}

        {!loading && jobs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 px-4 py-8 text-center text-[13px] text-gray-500 dark:border-white/15 dark:text-[#8e8e93]">
            还没有视频任务。在「视频笔记」里选好视频后提交，就会在这里排队。
          </p>
        ) : null}

        {jobs.map((job) => {
          const busy = busyId === job.id;
          const running = job.status === 'queued' || job.status === 'running';
          return (
            <section
              key={job.id}
              aria-label={`任务 ${job.id}`}
              className="rounded-xl border border-gray-200/70 p-3 dark:border-white/10"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-gray-800 dark:text-[#f5f5f7]">
                    {MODE_LABELS[job.mode]} · {job.lessons.length} 讲
                    <span className={`ml-2 text-[12px] font-normal ${statusClass(job.status)}`}>
                      {STATUS_LABELS[job.status]}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-gray-500 dark:text-[#8e8e93]" title={job.outputDir}>
                    {job.outputDir}
                  </p>
                  <p className="mt-0.5 text-[12px] text-gray-500 dark:text-[#8e8e93]">
                    已用 {jobUsage(job).toLocaleString('zh-CN')} tokens · 预估约{' '}
                    {job.estimate.tokens.toLocaleString('zh-CN')} tokens / {job.estimate.minutes} 分钟
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {running ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          job.id,
                          () => window.studyCoach?.cancelVideoJob?.(job.id) ?? Promise.resolve()
                        )
                      }
                    >
                      取消
                    </Button>
                  ) : null}
                  {job.status === 'interrupted' ||
                  job.status === 'cancelled' ||
                  job.status === 'failed' ? (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          job.id,
                          () => window.studyCoach?.resumeVideoJob?.(job.id) ?? Promise.resolve()
                        )
                      }
                    >
                      继续
                    </Button>
                  ) : null}
                  {!running ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void act(
                          job.id,
                          () => window.studyCoach?.removeVideoJob?.(job.id) ?? Promise.resolve()
                        )
                      }
                    >
                      移除
                    </Button>
                  ) : null}
                </div>
              </div>

              <ul className="mt-3 space-y-1.5">
                {job.lessons.map((lesson) => {
                  const actions = lessonActions(job, lesson);
                  return (
                    <li
                      key={lesson.videoPath}
                      className="rounded-lg bg-[#f5f5f7] px-2.5 py-2 dark:bg-[#242426]"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                        <span
                          className="min-w-0 flex-1 truncate text-[13px] text-gray-700 dark:text-[#a1a1a6]"
                          title={lesson.videoPath}
                        >
                          {lesson.title ?? fileName(lesson.videoPath)}
                        </span>
                        <span className={lessonClass(lesson.status)}>
                          {LESSON_LABELS[lesson.status]}
                          {lesson.status === 'running' && lesson.step
                            ? ` · ${stepLabel(lesson.step, job.mode)}`
                            : ''}
                        </span>
                        {job.mode === 'quick' && lesson.status === 'done' ? (
                          <span className="text-gray-500 dark:text-[#8e8e93]">
                            {(lesson.usage.inputTokens + lesson.usage.outputTokens).toLocaleString(
                              'zh-CN'
                            )}{' '}
                            tokens
                          </span>
                        ) : null}
                      </div>
                      {lesson.message &&
                      (lesson.status === 'failed' || lesson.status === 'running') ? (
                        <p className="mt-1 text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
                          {lesson.message}
                        </p>
                      ) : null}
                      {actions.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-3">
                          {actions.map((action) => (
                            <button
                              key={action.key}
                              type="button"
                              disabled={busy}
                              onClick={action.onClick}
                              className="text-[12px] font-medium text-[#0071e3] hover:underline disabled:opacity-40 dark:text-[#4da3ff]"
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </Dialog>
  );
}
