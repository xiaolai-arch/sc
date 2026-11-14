// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StudyCoachApi } from '../../src/shared/ipc';
import type { VideoJob } from '../../src/shared/video-notes';
import { VideoJobList } from '../../src/renderer/shell/VideoJobList';

const RUNNING: VideoJob = {
  id: 'job-run',
  mode: 'quick',
  videoPaths: ['C:\\课程\\a.mp4', 'C:\\课程\\b.mp4', 'C:\\课程\\c.mp4'],
  outputDir: 'C:\\课程\\笔记',
  language: 'auto',
  status: 'running',
  createdAt: '2026-11-15T03:00:00.000Z',
  lessons: [
    {
      videoPath: 'C:\\课程\\a.mp4',
      status: 'done',
      title: 'A 讲',
      lessonDir: 'C:\\课程\\笔记\\A',
      notesPath: 'C:\\课程\\笔记\\A\\notes.md',
      htmlPath: 'C:\\课程\\笔记\\A\\notes.html',
      usage: { inputTokens: 100, outputTokens: 50 }
    },
    {
      videoPath: 'C:\\课程\\b.mp4',
      status: 'running',
      step: 'transcribe',
      message: '正在转写音频（1/2）…',
      usage: { inputTokens: 0, outputTokens: 0 }
    },
    {
      videoPath: 'C:\\课程\\c.mp4',
      status: 'failed',
      message: '转写失败。',
      lessonDir: 'C:\\课程\\笔记\\C',
      slidesPath: 'C:\\课程\\笔记\\C\\slides.html',
      reportPath: 'C:\\课程\\笔记\\C\\report.md',
      usage: { inputTokens: 10, outputTokens: 5 }
    }
  ],
  estimate: { tokens: 150_000, minutes: 12 },
  usage: { inputTokens: 110, outputTokens: 55 }
};

const INTERRUPTED: VideoJob = {
  id: 'job-int',
  mode: 'deck',
  videoPaths: ['C:\\课程\\d.mp4'],
  outputDir: 'C:\\课程\\笔记',
  language: 'auto',
  status: 'interrupted',
  createdAt: '2026-11-15T02:00:00.000Z',
  lessons: [
    {
      videoPath: 'C:\\课程\\d.mp4',
      status: 'pending',
      message: '已中断',
      usage: { inputTokens: 0, outputTokens: 0 }
    }
  ],
  estimate: { tokens: 300_000, minutes: 20 },
  usage: { inputTokens: 0, outputTokens: 0 }
};

function installApi(overrides: Partial<StudyCoachApi> = {}) {
  let listener: ((jobs: VideoJob[]) => void) | null = null;
  const api = {
    listVideoJobs: vi.fn(async () => [RUNNING, INTERRUPTED]),
    onVideoJobsChanged: vi.fn((next: (jobs: VideoJob[]) => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    }),
    cancelVideoJob: vi.fn(async () => ({ ...RUNNING, status: 'cancelled' as const })),
    resumeVideoJob: vi.fn(async () => ({ ...INTERRUPTED, status: 'queued' as const })),
    retryVideoLesson: vi.fn(async () => RUNNING),
    removeVideoJob: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ''),
    ...overrides
  } as unknown as StudyCoachApi;
  window.studyCoach = api;
  return { api, emit: (jobs: VideoJob[]) => listener?.(jobs) };
}

afterEach(() => {
  delete window.studyCoach;
});

test('shows per-lesson progress and offers job actions', async () => {
  const { api, emit } = installApi();
  render(<VideoJobList open onClose={() => {}} />);

  expect(await screen.findByText('A 讲')).toBeInTheDocument();
  expect(screen.getByText(/进行中 · 语音转写/)).toBeInTheDocument();
  expect(screen.getByText('正在转写音频（1/2）…')).toBeInTheDocument();
  expect(screen.getByText('转写失败。')).toBeInTheDocument();
  expect(screen.getByText('1 个任务正在进行')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(api.cancelVideoJob).toHaveBeenCalledWith(RUNNING.id);

  await userEvent.click(screen.getByRole('button', { name: '继续' }));
  expect(api.resumeVideoJob).toHaveBeenCalledWith(INTERRUPTED.id);

  await userEvent.click(screen.getByRole('button', { name: '重试本讲' }));
  expect(api.retryVideoLesson).toHaveBeenCalledWith({
    jobId: RUNNING.id,
    videoPath: 'C:\\课程\\c.mp4'
  });

  await userEvent.click(screen.getByRole('button', { name: '打开笔记' }));
  expect(api.openPath).toHaveBeenCalledWith('C:\\课程\\笔记\\A\\notes.html');

  await userEvent.click(screen.getByRole('button', { name: '打开课件' }));
  await userEvent.click(screen.getByRole('button', { name: '打开报告' }));
  expect(api.openPath).toHaveBeenCalledWith('C:\\课程\\笔记\\C\\slides.html');
  expect(api.openPath).toHaveBeenCalledWith('C:\\课程\\笔记\\C\\report.md');
});

test('updates when the main process pushes a snapshot', async () => {
  const { emit } = installApi();
  render(<VideoJobList open onClose={() => {}} />);
  await screen.findByText('A 讲');

  act(() => {
    emit([
      { ...RUNNING, status: 'done', lessons: RUNNING.lessons.map((lesson) => ({ ...lesson, status: 'done' as const })) },
      INTERRUPTED
    ]);
  });

  await waitFor(() => expect(screen.getAllByText('已完成').length).toBeGreaterThan(0));
  expect(screen.queryByRole('button', { name: '取消' })).toBeNull();
});

test('shows the empty state and stops listening when closed', async () => {
  const { api } = installApi({ listVideoJobs: vi.fn(async () => []) });
  const onClose = vi.fn();
  const { rerender } = render(<VideoJobList open onClose={onClose} />);

  expect(await screen.findByText(/还没有视频任务/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(onClose).toHaveBeenCalled();

  rerender(<VideoJobList open={false} onClose={onClose} />);
  expect(api.listVideoJobs).toHaveBeenCalled();
});
