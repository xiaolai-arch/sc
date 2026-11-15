import { useEffect, useMemo, useState } from 'react';
import { friendlyErrorMessage } from '../../shared/errors';
import type {
  VideoJob,
  VideoNotesEnqueueInput,
  VideoNotesEstimate
} from '../../shared/video-notes';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { FolderIcon, PlayIcon } from '../ui/icons';

type VideoNotesDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Opens the background job list after a successful submit. */
  onOpenJobs?: () => void;
};

const FILE_LIMIT = 200;

const inputClass =
  'h-10 w-full rounded-xl border-0 bg-[#f5f5f7] px-3 text-[14px] text-gray-800 outline-none transition-all duration-200 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]';

function fileName(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return index >= 0 ? path.slice(index + 1) : path;
}

function formatTokens(tokens: number): string {
  if (tokens >= 10_000) return `${(tokens / 10_000).toFixed(1)} 万`;
  return tokens.toLocaleString('zh-CN');
}

/**
 * A small utility dialog on the Knowledge page: pick local course videos,
 * submit a background job, then close the dialog while the queue works.
 */
export function VideoNotesDialog({ open, onClose, onOpenJobs }: VideoNotesDialogProps) {
  const [videoPaths, setVideoPaths] = useState<string[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [outputDir, setOutputDir] = useState('');
  const [estimate, setEstimate] = useState<VideoNotesEstimate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<VideoJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bridgeMissing, setBridgeMissing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitted(null);
    setEstimate(null);
    setBridgeMissing(!window.studyCoach);
  }, [open]);

  // Estimating probes durations, so debounce typing/selection churn.
  useEffect(() => {
    if (!open) return;
    const api = window.studyCoach;
    if (!api || typeof api.estimateVideoNotes !== 'function') return;
    if (videoPaths.length === 0 && folder === null) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void api
        .estimateVideoNotes!({
          ...(videoPaths.length > 0 ? { videoPaths } : {}),
          ...(folder !== null ? { folder } : {}),
          ...(outputDir.trim() ? { outputDir: outputDir.trim() } : {})
        })
        .then((value) => {
          if (!cancelled) setEstimate(value);
        })
        .catch(() => {
          if (!cancelled) setEstimate(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, videoPaths, folder, outputDir]);

  const unavailable = bridgeMissing || Boolean(window.studyCoachPrototype);
  const hasSelection = videoPaths.length > 0 || folder !== null;
  const selectionLabel = useMemo(() => {
    if (folder !== null) return `整个文件夹：${fileName(folder)}`;
    return `${videoPaths.length}/${FILE_LIMIT} 个视频`;
  }, [folder, videoPaths.length]);

  function close() {
    onClose();
  }

  async function pickFiles() {
    const api = window.studyCoach;
    if (!api) return;
    setError(null);
    try {
      const picked = await api.pickVideoFiles();
      if (!picked || picked.length === 0) return;
      setFolder(null);
      setVideoPaths((current) => {
        const merged = [...current];
        for (const path of picked) {
          if (!merged.includes(path)) merged.push(path);
        }
        return merged.slice(0, FILE_LIMIT);
      });
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '选择视频失败，请重试。'));
    }
  }

  async function pickFolder() {
    const api = window.studyCoach;
    if (!api || typeof api.pickVideoFolder !== 'function') return;
    setError(null);
    try {
      const picked = await api.pickVideoFolder();
      if (!picked) return;
      setFolder(picked);
      setVideoPaths([]);
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '选择文件夹失败，请重试。'));
    }
  }

  async function pickOutput() {
    const api = window.studyCoach;
    if (!api) return;
    setError(null);
    try {
      const picked = await api.pickOutputDirectory();
      if (picked) setOutputDir(picked);
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '选择文件夹失败，请重试。'));
    }
  }

  async function submit() {
    const api = window.studyCoach;
    if (!api || typeof api.enqueueVideoNotes !== 'function') {
      setError('当前环境不支持后台视频任务。');
      return;
    }
    if (!hasSelection) {
      setError('请先选择课程视频或文件夹。');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSubmitted(null);
    const input: VideoNotesEnqueueInput = {
      ...(videoPaths.length > 0 ? { videoPaths } : {}),
      ...(folder !== null ? { folder } : {}),
      ...(outputDir.trim() ? { outputDir: outputDir.trim() } : {})
    };
    try {
      const job = await api.enqueueVideoNotes(input);
      setSubmitted(job);
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '提交任务失败，请重试。'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="视频转课件"
      widthClassName="max-w-2xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
            提交后在后台排队；关闭这个窗口不会中断任务。
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={close}>
              关闭
            </Button>
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={submitting || unavailable || !hasSelection}
            >
              {submitting ? '提交中…' : '提交后台任务'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
          选几讲网课视频，按关键帧和画面上的文字整理成一份分页课件。任务会在后台排队，
          可以关掉这个窗口，也可以在「视频任务」里取消或继续。
        </p>

        {bridgeMissing || window.studyCoachPrototype ? (
          <div className="rounded-xl bg-[#f5f5f7] px-4 py-3 text-[13px] leading-6 text-gray-600 dark:bg-white/[0.06] dark:text-[#a1a1a6]">
            视频课件需要在本机桌面应用中使用：浏览器原型无法读取本地视频，也无法调用 ffmpeg。
          </div>
        ) : null}

        <section aria-label="视频文件" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] font-medium text-gray-500 dark:text-[#8e8e93]">
              {selectionLabel}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void pickFiles()}
                disabled={submitting || unavailable}
              >
                <PlayIcon className="h-4 w-4" />
                选择视频…
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void pickFolder()}
                disabled={submitting || unavailable}
              >
                <FolderIcon className="h-4 w-4" />
                选择文件夹…
              </Button>
            </div>
          </div>
          {!hasSelection ? (
            <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-[13px] text-gray-500 dark:border-white/15 dark:text-[#8e8e93]">
              还没有选择视频。可以选多个文件，也可以选整个文件夹；支持 mp4、mkv、mov、webm
              等常见格式，一个任务最多 200 个文件。
            </p>
          ) : folder !== null ? (
            <div className="flex items-center gap-2 rounded-xl bg-[#f5f5f7] px-3 py-2 text-[13px] text-gray-700 dark:bg-[#242426] dark:text-[#a1a1a6]">
              <FolderIcon className="h-4 w-4 shrink-0 text-[#0071e3] dark:text-[#4da3ff]" />
              <span className="min-w-0 flex-1 truncate" title={folder}>
                {folder}
              </span>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setFolder(null)}
                className="shrink-0 rounded-md px-2 py-0.5 text-[12px] text-gray-500 transition-colors hover:bg-black/[0.05] hover:text-gray-800 disabled:opacity-40 dark:text-[#8e8e93] dark:hover:bg-white/[0.08] dark:hover:text-[#f5f5f7]"
              >
                移除
              </button>
            </div>
          ) : (
            <ul className="max-h-44 space-y-1 overflow-y-auto rounded-xl bg-[#f5f5f7] p-2 dark:bg-[#242426]">
              {videoPaths.map((path) => (
                <li
                  key={path}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-gray-700 dark:text-[#a1a1a6]"
                >
                  <PlayIcon className="h-3.5 w-3.5 shrink-0 text-[#0071e3] dark:text-[#4da3ff]" />
                  <span className="min-w-0 flex-1 truncate" title={path}>
                    {fileName(path)}
                  </span>
                  <button
                    type="button"
                    aria-label={`移除 ${fileName(path)}`}
                    disabled={submitting}
                    onClick={() =>
                      setVideoPaths((current) => current.filter((entry) => entry !== path))
                    }
                    className="shrink-0 rounded-md px-2 py-0.5 text-[12px] text-gray-500 transition-colors hover:bg-black/[0.05] hover:text-gray-800 disabled:opacity-40 dark:text-[#8e8e93] dark:hover:bg-white/[0.08] dark:hover:text-[#f5f5f7]"
                  >
                    移除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="输出设置" className="space-y-1.5">
          <p className="text-[12px] font-medium text-gray-500 dark:text-[#8e8e93]">输出文件夹</p>
          <div className="flex items-center gap-2">
            <input
              value={outputDir}
              onChange={(event) => setOutputDir(event.target.value)}
              disabled={submitting}
              placeholder="默认：第一个视频旁的「笔记」文件夹"
              aria-label="输出文件夹"
              className={inputClass}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void pickOutput()}
              disabled={submitting || unavailable}
              className="shrink-0"
            >
              选择…
            </Button>
          </div>
        </section>

        {estimate ? (
          <section
            aria-label="用量预估"
            className="rounded-xl bg-[#f5f5f7] px-4 py-3 text-[12px] leading-6 text-gray-600 dark:bg-white/[0.06] dark:text-[#a1a1a6]"
          >
            预计 {estimate.lessons} 讲 · 视频{' '}
            {Math.max(1, Math.round(estimate.durationSeconds / 60))} 分钟 · 约{' '}
            {formatTokens(estimate.tokens)} tokens · 约 {estimate.minutes} 分钟
            <span className="mt-1 block text-gray-500 dark:text-[#8e8e93]">
              只是估算；视频任务不检查每日预算，由你决定是否运行。
            </span>
          </section>
        ) : null}

        {error ? (
          <p role="alert" className="text-[12px] text-[#ff3b30]">
            {error}
          </p>
        ) : null}

        {submitted ? (
          <section
            aria-label="已提交"
            role="status"
            className="rounded-xl bg-[#34c759]/10 px-4 py-3 text-[13px] leading-6 text-gray-700 dark:text-[#a1a1a6]"
          >
            <p className="font-medium text-gray-800 dark:text-[#f5f5f7]">
              已提交后台任务：视频转课件 · {submitted.lessons.length} 讲
            </p>
            <p className="mt-1 text-[12px] text-gray-500 dark:text-[#8e8e93]">
              输出到 {submitted.outputDir}
            </p>
            {onOpenJobs ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenJobs();
                }}
                className="mt-2 font-medium text-[#0071e3] hover:underline dark:text-[#4da3ff]"
              >
                查看视频任务
              </button>
            ) : null}
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}
