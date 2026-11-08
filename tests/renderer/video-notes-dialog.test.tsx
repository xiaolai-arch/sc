// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StudyCoachApi } from '../../src/shared/ipc';
import type { VideoNotesResult } from '../../src/shared/video-notes';
import { VideoNotesDialog } from '../../src/renderer/shell/VideoNotesDialog';

const RESULT: VideoNotesResult = {
  outputDir: 'C:\\课程\\笔记',
  indexPath: 'C:\\课程\\笔记\\index.html',
  lessons: [
    {
      sourcePath: 'C:\\课程\\01-集合.mp4',
      lessonDir: 'C:\\课程\\笔记\\01-集合',
      title: '01-集合',
      durationSeconds: 600,
      transcriptChars: 3000,
      noteChars: 900,
      notesPath: 'C:\\课程\\笔记\\01-集合\\notes.md',
      htmlPath: 'C:\\课程\\笔记\\01-集合\\notes.html'
    }
  ],
  failures: []
};

function installApi(overrides: Partial<StudyCoachApi> = {}) {
  const api = {
    getTranscriptionConfig: vi.fn(async () => ({
      baseURL: 'https://host/v1',
      model: 'mimo-v2.5-asr',
      hasApiKey: true
    })),
    pickVideoFiles: vi.fn(async () => ['C:\\课程\\01-集合.mp4']),
    pickOutputDirectory: vi.fn(async () => 'C:\\课程\\笔记'),
    generateVideoNotes: vi.fn(async (_input, onProgress) => {
      onProgress({
        videoIndex: 0,
        videoCount: 1,
        videoPath: 'C:\\课程\\01-集合.mp4',
        stage: 'notes',
        message: '正在生成笔记…'
      });
      return RESULT;
    }),
    openPath: vi.fn(async () => ''),
    ...overrides
  } as unknown as StudyCoachApi;
  window.studyCoach = api;
  return api;
}

afterEach(() => {
  delete window.studyCoach;
});

test('picks videos, generates notes, and opens the result', async () => {
  const api = installApi();
  const onClose = vi.fn();
  render(<VideoNotesDialog open onClose={onClose} />);
  await waitFor(() => expect(api.getTranscriptionConfig).toHaveBeenCalled());

  await userEvent.click(screen.getByRole('button', { name: /选择视频/ }));
  expect(await screen.findByText('01-集合.mp4')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '生成笔记' }));

  await waitFor(() => expect(api.generateVideoNotes).toHaveBeenCalled());
  expect(api.generateVideoNotes).toHaveBeenCalledWith(
    { videoPaths: ['C:\\课程\\01-集合.mp4'], language: 'auto' },
    expect.any(Function)
  );

  expect(await screen.findByText('已生成 1 讲')).toBeInTheDocument();
  expect(screen.getByText(/3,000 字转录/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '打开课程索引' }));
  expect(api.openPath).toHaveBeenCalledWith(RESULT.indexPath);

  await userEvent.click(screen.getByRole('button', { name: '打开笔记' }));
  expect(api.openPath).toHaveBeenCalledWith(RESULT.lessons[0]!.htmlPath);
  expect(onClose).not.toHaveBeenCalled();
});

test('sends the chosen output folder and language', async () => {
  const api = installApi();
  render(<VideoNotesDialog open onClose={() => {}} />);
  await waitFor(() => expect(api.getTranscriptionConfig).toHaveBeenCalled());

  await userEvent.click(screen.getByRole('button', { name: /选择视频/ }));
  await screen.findByText('01-集合.mp4');
  await userEvent.click(screen.getByRole('button', { name: '选择…' }));

  await waitFor(() => expect(api.pickOutputDirectory).toHaveBeenCalled());
  expect(await screen.findByDisplayValue('C:\\课程\\笔记')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '生成笔记' }));
  await waitFor(() =>
    expect(api.generateVideoNotes).toHaveBeenCalledWith(
      expect.objectContaining({
        videoPaths: ['C:\\课程\\01-集合.mp4'],
        outputDir: 'C:\\课程\\笔记',
        language: 'auto'
      }),
      expect.any(Function)
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

test('does not close while a run is in progress', async () => {
  let resolveRun!: (value: VideoNotesResult) => void;
  const api = installApi({
    generateVideoNotes: vi.fn(
      (_input: unknown, onProgress: (progress: unknown) => void) =>
        new Promise<VideoNotesResult>((resolve) => {
          resolveRun = resolve;
          onProgress({
            videoIndex: 0,
            videoCount: 1,
            videoPath: 'C:\\课程\\01-集合.mp4',
            stage: 'transcribe',
            message: '正在转写音频（1/2）…',
            current: 1,
            total: 2
          });
        })
    )
  });
  const onClose = vi.fn();
  render(<VideoNotesDialog open onClose={onClose} />);
  await waitFor(() => expect(api.getTranscriptionConfig).toHaveBeenCalled());

  await userEvent.click(screen.getByRole('button', { name: /选择视频/ }));
  await screen.findByText('01-集合.mp4');
  await userEvent.click(screen.getByRole('button', { name: '生成笔记' }));

  expect(await screen.findByText(/正在转写音频（1\/2）/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled();
  await userEvent.keyboard('{Escape}');
  expect(onClose).not.toHaveBeenCalled();

  resolveRun(RESULT);
  await screen.findByText('已生成 1 讲');
  await userEvent.click(screen.getByRole('button', { name: '关闭' }));
  expect(onClose).toHaveBeenCalled();
});

test('surfaces failures without discarding successful lessons', async () => {
  installApi({
    generateVideoNotes: vi.fn(async () => ({
      ...RESULT,
      failures: [{ videoPath: 'C:\\课程\\02-函数.mp4', message: '没有识别到有效语音内容。' }]
    })) as never
  });
  render(<VideoNotesDialog open onClose={() => {}} />);

  await userEvent.click(screen.getByRole('button', { name: /选择视频/ }));
  await screen.findByText('01-集合.mp4');
  await userEvent.click(screen.getByRole('button', { name: '生成笔记' }));

  expect(await screen.findByText('有 1 个文件失败')).toBeInTheDocument();
  expect(screen.getByText(/没有识别到有效语音内容/)).toBeInTheDocument();
  expect(screen.getByText('已生成 1 讲')).toBeInTheDocument();
});
