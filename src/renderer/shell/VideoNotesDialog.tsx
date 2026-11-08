import { useEffect, useMemo, useState } from 'react';
import { friendlyErrorMessage } from '../../shared/errors';
import type {
  VideoNotesLanguage,
  VideoNotesProgress,
  VideoNotesResult,
  VideoNotesStage
} from '../../shared/video-notes';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { FolderIcon, PlayIcon } from '../ui/icons';
import { Progress } from '../ui/Progress';
import { Select } from '../ui/Select';

type VideoNotesDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Navigates to Settings so the ASR key can be configured. */
  onOpenSettings?: () => void;
};

const FILE_LIMIT = 50;

const inputClass =
  'h-10 w-full rounded-xl border-0 bg-[#f5f5f7] px-3 text-[14px] text-gray-800 outline-none transition-all duration-200 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]';

const STAGE_LABELS: Record<VideoNotesStage, string> = {
  probe: '读取视频信息',
  audio: '提取音频',
  transcribe: '语音转写',
  notes: '整理笔记',
  html: '生成 HTML',
  done: '完成',
  error: '失败'
};

function fileName(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return index >= 0 ? path.slice(index + 1) : path;
}

function stageFraction(progress: VideoNotesProgress): number {
  switch (progress.stage) {
    case 'probe':
      return 0.02;
    case 'audio':
      return 0.08;
    case 'transcribe': {
      const ratio =
        progress.current !== undefined && progress.total !== undefined && progress.total > 0
          ? progress.current / progress.total
          : 0;
      return 0.1 + ratio * 0.6;
    }
    case 'notes':
      return 0.75;
    case 'html':
      return 0.95;
    default:
      return 1;
  }
}

function overallPercent(progress: VideoNotesProgress): number {
  const count = Math.max(1, progress.videoCount);
  const value = (progress.videoIndex + stageFraction(progress)) / count;
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

/**
 * A small utility dialog on the Knowledge page: pick local course videos, run
 * ASR + note generation, and open the generated HTML when it finishes.
 */
export function VideoNotesDialog({ open, onClose, onOpenSettings }: VideoNotesDialogProps) {
  const [videoPaths, setVideoPaths] = useState<string[]>([]);
  const [outputDir, setOutputDir] = useState('');
  const [language, setLanguage] = useState<VideoNotesLanguage>('auto');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<VideoNotesProgress | null>(null);
  const [result, setResult] = useState<VideoNotesResult | null>(null);
  const [failures, setFailures] = useState<{ path: string; message: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const [bridgeMissing, setBridgeMissing] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    const api = window.studyCoach;
    if (!api) {
      setBridgeMissing(true);
      setHasApiKey(null);
      return;
    }
    setBridgeMissing(false);
    void api
      .getTranscriptionConfig()
      .then((config) => {
        if (!cancelled) setHasApiKey(config.hasApiKey);
      })
      .catch(() => {
        if (!cancelled) setHasApiKey(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const totalChars = useMemo(
    () => (result ? result.lessons.reduce((sum, lesson) => sum + lesson.transcriptChars, 0) : 0),
    [result]
  );
  const unavailable = bridgeMissing || Boolean(window.studyCoachPrototype);

  function close() {
    if (running) return;
    onClose();
  }

  async function pickFiles() {
    const api = window.studyCoach;
    if (!api) return;
    setError(null);
    try {
      const picked = await api.pickVideoFiles();
      if (!picked || picked.length === 0) return;
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

  async function openGenerated(path: string) {
    const api = window.studyCoach;
    if (!api) return;
    try {
      const message = await api.openPath(path);
      if (message) setError(message);
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '无法打开文件。'));
    }
  }

  async function generate() {
    const api = window.studyCoach;
    if (!api) {
      setError('当前环境不支持生成视频笔记。');
      return;
    }
    if (videoPaths.length === 0) {
      setError('请先选择课程视频。');
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    setFailures([]);
    setProgress(null);
    try {
      const next = await api.generateVideoNotes(
        {
          videoPaths,
          ...(outputDir.trim() ? { outputDir: outputDir.trim() } : {}),
          language
        },
        setProgress
      );
      setResult(next);
      setFailures(next.failures.map((failure) => ({ path: failure.videoPath, message: failure.message })));
      if (next.failures.length > 0 && next.lessons.length === 0) {
        setError('这次没有生成任何笔记，请检查下面的错误信息。');
      }
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '生成失败，请重试。'));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="视频生成笔记"
      widthClassName="max-w-2xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
            文件保存在你指定的文件夹，不会写入知识库。
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={close} disabled={running}>
              关闭
            </Button>
            <Button
              size="sm"
              onClick={() => void generate()}
              disabled={running || unavailable || videoPaths.length === 0}
            >
              {running ? '生成中…' : '生成笔记'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
          选几讲网课视频，先用语音识别转成文字，再用模型整理成知识点笔记。
          每讲会生成一个 Markdown、一个可直接打开的 HTML，以及整门课的索引页。
        </p>

        {bridgeMissing || window.studyCoachPrototype ? (
          <div className="rounded-xl bg-[#f5f5f7] px-4 py-3 text-[13px] leading-6 text-gray-600 dark:bg-white/[0.06] dark:text-[#a1a1a6]">
            视频笔记需要在本机桌面应用中使用：浏览器原型无法读取本地视频，也无法调用 ffmpeg。
          </div>
        ) : null}

        {!bridgeMissing && hasApiKey === false ? (
          <div className="rounded-xl bg-[#ff9f0a]/10 px-4 py-3 text-[13px] leading-6 text-[#8a5a00] dark:text-[#ffd60a]">
            <p>还没有保存语音转写 API key。</p>
            {onOpenSettings ? (
              <button
                type="button"
                onClick={() => {
                  if (running) return;
                  onClose();
                  onOpenSettings();
                }}
                className="mt-1 font-medium text-[#0071e3] hover:underline dark:text-[#4da3ff]"
              >
                去设置里配置
              </button>
            ) : null}
          </div>
        ) : null}

        <section aria-label="视频文件" className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] font-medium text-gray-500 dark:text-[#8e8e93]">
              课程视频（{videoPaths.length}/{FILE_LIMIT}）
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void pickFiles()}
              disabled={running || unavailable}
            >
              <FolderIcon className="h-4 w-4" />
              选择视频…
            </Button>
          </div>
          {videoPaths.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-center text-[13px] text-gray-500 dark:border-white/15 dark:text-[#8e8e93]">
              还没有选择视频。支持 mp4、mkv、mov、webm 等常见格式。
            </p>
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
                    disabled={running}
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

        <section aria-label="输出设置" className="grid gap-3 sm:grid-cols-[1fr_150px]">
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-gray-500 dark:text-[#8e8e93]">
              输出文件夹
            </p>
            <div className="flex items-center gap-2">
              <input
                value={outputDir}
                onChange={(event) => setOutputDir(event.target.value)}
                disabled={running}
                placeholder="默认：第一个视频旁的「笔记」文件夹"
                aria-label="输出文件夹"
                className={inputClass}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void pickOutput()}
                disabled={running || unavailable}
                className="shrink-0"
              >
                选择…
              </Button>
            </div>
          </div>
          <label className="space-y-1.5">
            <span className="block text-[12px] font-medium text-gray-500 dark:text-[#8e8e93]">
              转写语言
            </span>
            <Select
              size="field"
              value={language}
              onChange={(event) => setLanguage(event.target.value as VideoNotesLanguage)}
              disabled={running}
            >
              <option value="auto">自动识别</option>
              <option value="zh">中文</option>
              <option value="en">英文</option>
            </Select>
          </label>
        </section>

        {running ? (
          <section aria-live="polite" aria-label="生成进度" className="space-y-2">
            <p className="text-[13px] text-gray-600 dark:text-[#a1a1a6]">
              {progress
                ? `第 ${progress.videoIndex + 1}/${progress.videoCount} 讲 · ${STAGE_LABELS[progress.stage]}：${progress.message}`
                : '正在启动…'}
            </p>
            <Progress value={progress ? overallPercent(progress) : 0} max={100} ariaLabel="生成进度" />
          </section>
        ) : null}

        {running ? (
          <p className="text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
            长视频可能需要十几分钟；中途关闭窗口会终止任务，已完成的音频转写会缓存下来。
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-[12px] text-[#ff3b30]">
            {error}
          </p>
        ) : null}

        {failures.length > 0 ? (
          <section aria-label="失败的文件" className="space-y-1">
            <p className="text-[12px] font-medium text-[#ff3b30]">有 {failures.length} 个文件失败</p>
            <ul className="space-y-1 rounded-xl bg-[#ff3b30]/[0.06] p-3">
              {failures.map((failure) => (
                <li key={failure.path} className="text-[12px] leading-5 text-gray-600 dark:text-[#a1a1a6]">
                  <span className="font-medium text-gray-800 dark:text-[#f5f5f7]">
                    {fileName(failure.path)}
                  </span>
                  ：{failure.message}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {result ? (
          <section aria-label="生成结果" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p
                  role="status"
                  className="text-[13px] font-medium text-gray-800 dark:text-[#f5f5f7]"
                >
                  已生成 {result.lessons.length} 讲
                </p>
                <p className="text-[12px] text-gray-500 dark:text-[#8e8e93]">
                  共 {totalChars.toLocaleString('zh-CN')} 字转录 · {result.outputDir}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => void openGenerated(result.outputDir)}>
                  打开文件夹
                </Button>
                <Button size="sm" onClick={() => void openGenerated(result.indexPath)}>
                  打开课程索引
                </Button>
              </div>
            </div>
            <ul className="max-h-52 space-y-1 overflow-y-auto">
              {result.lessons.map((lesson) => (
                <li
                  key={lesson.lessonDir}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                >
                  <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-[#a1a1a6]" title={lesson.title}>
                    {lesson.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => void openGenerated(lesson.htmlPath)}
                    className="shrink-0 text-[12px] font-medium text-[#0071e3] hover:underline dark:text-[#4da3ff]"
                  >
                    打开笔记
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}
