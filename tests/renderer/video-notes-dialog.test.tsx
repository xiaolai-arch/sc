// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StudyCoachApi } from '../../src/shared/ipc';
import type { VideoJob } from '../../src/shared/video-notes';
import { VideoNotesDialog } from '../../src/renderer/shell/VideoNotesDialog';

const JOB: VideoJob = {
  id: 'job-1',
  mode: 'deck',
  videoPaths: ['C:\\课程\\01-集合.mp4'],
  outputDir: 'C:\\课程\\笔记',
  language: 'auto',
  status: 'queued',
  createdAt: '2026-11-15T03:00:00.000Z',
  lessons: [
    {
      videoPath: 'C:\\课程\\01-集合.mp4',
      status: 'pending',
      usage: { inputTokens: 0, outputTokens: 0 }
    }
  ],
  estimate: { tokens: 500_000, minutes: 30 },
  usage: { inputTokens: 0, outputTokens: 0 }
};

function installApi(overrides: Partial<StudyCoachApi> = {}) {
  const api = {
    getTranscriptionConfig: vi.fn(async () => ({
      baseURL: 'https://host/v1',
      model: 'mimo-v2.5-asr',
      hasApiKey: true
    })),
    pickVideoFiles: vi.fn(async () => ['C:\\课程\\01-集合.mp4']),
    pickVideoFolder: vi.fn(async () => 'C:\\课程\\全部'),
    pickOutputDirectory: vi.fn(async () => 'C:\\课程\\笔记'),
    estimateVideoNotes: vi.fn(async () => ({
      lessons: 1,
      durationSeconds: 600,
      tokens: 500_000,
      minutes: 30
    })),
    enqueueVideoNotes: vi.fn(async () => JOB),
    openPath: vi.fn(async () => ''),
    ...overrides
  } as unknown as StudyCoachApi;
  window.studyCoach = api;
  return api;
}

afterEach(() => {
  delete window.studyCoach;
});

test('defaults to the deck mode, estimates usage and submits a background job', async () => {
  const api = installApi();
  const onOpenJobs = vi.fn();
  render(<VideoNotesDialog open onClose={() => {}} onOpenJobs={onOpenJobs} />);
  await waitFor(() => expect(api.getTranscriptionConfig).toHaveBeenCalled());

  expect(screen.getByRole('button', { name: '完整课件（预览）' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await userEvent.click(screen.getByRole('button', { name: /选择视频/ }));
  expect(await screen.findByText('01-集合.mp4')).toBeInTheDocument();

  expect(await screen.findByText(/预计 1 讲/)).toBeInTheDocument();
  expect(screen.getByText(/50.0 万 tokens/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '提交后台任务' }));
  await waitFor(() => expect(api.enqueueVideoNotes).toHaveBeenCalled());
  expect(api.enqueueVideoNotes).toHaveBeenCalledWith({
    mode: 'deck',
    videoPaths: ['C:\\课程\\01-集合.mp4'],
    language: 'auto'
  });

  expect(await screen.findByText('已提交后台任务：完整课件（预览） · 1 讲')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '查看视频任务' }));
  expect(onOpenJobs).toHaveBeenCalled();
});

test('selects a whole folder instead of individual files', async () => {
  const api = installApi();
  render(<VideoNotesDialog open onClose={() => {}} />);
  await waitFor(() => expect(api.getTranscriptionConfig).toHaveBeenCalled());

  await userEvent.click(screen.getByRole('button', { name: /选择文件夹/ }));
  expect(await screen.findByText('C:\\课程\\全部')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '提交后台任务' }));
  await waitFor(() =>
    expect(api.enqueueVideoNotes).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'deck', folder: 'C:\\课程\\全部' })
    )
  );
});

test('sends the chosen output folder and language in quick mode', async () => {
  const api = installApi();
  render(<VideoNotesDialog open onClose={() => {}} />);
  await waitFor(() => expect(api.getTranscriptionConfig).toHaveBeenCalled());

  await userEvent.click(screen.getByRole('button', { name: '快速笔记' }));
  await userEvent.click(screen.getByRole('button', { name: /选择视频/ }));
  await screen.findByText('01-集合.mp4');
  await userEvent.click(screen.getByRole('button', { name: '选择…' }));

  await waitFor(() => expect(api.pickOutputDirectory).toHaveBeenCalled());
  expect(await screen.findByDisplayValue('C:\\课程\\笔记')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '提交后台任务' }));
  await waitFor(() =>
    expect(api.enqueueVideoNotes).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'quick',
        videoPaths: ['C:\\课程\\01-集合.mp4'],
        outputDir: 'C:\\课程\\笔记',
        language: 'auto'
      })
    )
  );
});

test('shows a settings shortcut when the ASR key is missing', async () => {
  installApi({
    getTranscriptionConfig: vi.fn(async () => ({
      baseURL: 'https://host/v1',
      model: 'mimo-v2.5-asr',
      hasApiKey: false
    })),
    pickVideoFiles: vi.fn(async () => null)
  });
  const onOpenSettings = vi.fn();
  const onClose = vi.fn();
  render(<VideoNotesDialog open onClose={onClose} onOpenSettings={onOpenSettings} />);

  await screen.findByText(/还没有保存语音转写 API key/);
  await userEvent.click(screen.getByRole('button', { name: '去设置里配置' }));

  expect(onClose).toHaveBeenCalled();
  expect(onOpenSettings).toHaveBeenCalled();
});

test('can be closed once the job is queued and reports duplicate submissions', async () => {
  let resolveEnqueue!: (value: VideoJob) => void;
  const api = installApi({
    enqueueVideoNotes: vi.fn(
      () =>
        new Promise<VideoJob>((resolve) => {
          resolveEnqueue = resolve;
        })
    )
  });
  const onClose = vi.fn();
  render(<VideoNotesDialog open onClose={onClose} />);
  await waitFor(() => expect(api.getTranscriptionConfig).toHaveBeenCalled());

  await userEvent.click(screen.getByRole('button', { name: /选择视频/ }));
  await screen.findByText('01-集合.mp4');
  await userEvent.click(screen.getByRole('button', { name: '提交后台任务' }));

  // The dialog stays open while the job is starting, but closing is allowed.
  expect(screen.getByRole('button', { name: '关闭' })).not.toBeDisabled();

  resolveEnqueue(JOB);
  expect(await screen.findByText(/已提交后台任务/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(onClose).toHaveBeenCalled();
});

test('shows the queue duplicate error', async () => {
  installApi({
    enqueueVideoNotes: vi.fn(async () => {
      throw new Error('已在队列中：01-集合.mp4');
    })
  });
  render(<VideoNotesDialog open onClose={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /选择视频/ }));
  await screen.findByText('01-集合.mp4');
  await userEvent.click(screen.getByRole('button', { name: '提交后台任务' }));

  expect(await screen.findByText(/已在队列中/)).toBeInTheDocument();
});
