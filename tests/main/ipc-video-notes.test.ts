import type { StudyCoachApi } from '../../src/shared/ipc';
import type { VideoJob } from '../../src/shared/video-notes';
import {
  APP_IPC_CHANNELS,
  VIDEO_NOTES_CHANNELS,
  createIpcHandlers,
  createStudyCoachBridge,
  createVideoJobHandlers,
  createVideoNotesHandler,
  type IpcEventLike
} from '../../src/main/ipc';

type Sent = { channel: string; payload: unknown };

function sender(destroyed = false) {
  const sent: Sent[] = [];
  const event: IpcEventLike = {
    sender: {
      send(channel, payload) {
        sent.push({ channel, payload });
      },
      isDestroyed: () => destroyed
    }
  };
  return { event, sent };
}

const RESULT = {
  outputDir: 'C:\\out',
  indexPath: 'C:\\out\\index.html',
  lessons: [],
  failures: []
};

describe('createVideoNotesHandler', () => {
  test('forwards progress with the request id and returns the result', async () => {
    const api = {
      async generateVideoNotes(
        input: unknown,
        onProgress: (progress: unknown) => void
      ) {
        expect(input).toMatchObject({
          videoPaths: ['C:\\a.mp4']
        });
        onProgress({
          videoIndex: 0,
          videoCount: 1,
          videoPath: 'C:\\a.mp4',
          stage: 'notes',
          message: '正在生成笔记…'
        });
        return RESULT;
      }
    } as unknown as StudyCoachApi;
    const handler = createVideoNotesHandler(api);
    const { event, sent } = sender();

    await expect(
      handler(event, {
        requestId: 'req-1',
        input: { videoPaths: ['C:\\a.mp4'] }
      })
    ).resolves.toEqual(RESULT);

    expect(sent).toEqual([
      {
        channel: VIDEO_NOTES_CHANNELS.progress,
        payload: {
          requestId: 'req-1',
          progress: {
            videoIndex: 0,
            videoCount: 1,
            videoPath: 'C:\\a.mp4',
            stage: 'notes',
            message: '正在生成笔记…'
          }
        }
      }
    ]);
  });

  test('redacts secrets in progress messages and errors', async () => {
    const api = {
      async generateVideoNotes(
        _input: unknown,
        onProgress: (progress: unknown) => void
      ) {
        onProgress({
          videoIndex: 0,
          videoCount: 1,
          videoPath: 'C:\\a',
          stage: 'error',
          message: 'request failed with sk-super-secret'
        });
        throw new Error('upstream said sk-super-secret');
      }
    } as unknown as StudyCoachApi;
    const handler = createVideoNotesHandler(api);
    const { event, sent } = sender();

    await expect(
      handler(event, { requestId: 'req-2', input: { videoPaths: ['C:\\a.mp4'] } })
    ).rejects.toThrow(/\[redacted\]/);
    expect(JSON.stringify(sent)).not.toContain('sk-super-secret');
    expect(JSON.stringify(sent)).toContain('[redacted]');
  });

  test('validates the payload before starting work', async () => {
    const api = {
      async generateVideoNotes() {
        throw new Error('should not run');
      }
    } as unknown as StudyCoachApi;
    const handler = createVideoNotesHandler(api);
    const { event, sent } = sender();

    await expect(handler(event, { input: { videoPaths: ['C:\\a.mp4'] } })).rejects.toThrow(
      /请求 ID/
    );
    await expect(
      handler(event, { requestId: 'r', input: { videoPaths: [] } })
    ).rejects.toThrow(/选择视频/);
    await expect(
      handler(event, { requestId: 'r', input: { videoPaths: [1] } })
    ).rejects.toThrow(/视频路径/);
    await expect(
      handler(event, {
        requestId: 'r',
        input: { videoPaths: ['C:\\a.mp4'], outputDir: 42 }
      })
    ).rejects.toThrow(/输出文件夹/);
    expect(sent).toHaveLength(0);
  });

  test('skips progress when the sender is destroyed', async () => {
    const api = {
      async generateVideoNotes(
        _input: unknown,
        onProgress: (progress: unknown) => void
      ) {
        onProgress({
          videoIndex: 0,
          videoCount: 1,
          videoPath: 'C:\\a',
          stage: 'probe',
          message: 'x'
        });
        return RESULT;
      }
    } as unknown as StudyCoachApi;
    const handler = createVideoNotesHandler(api);
    const { event, sent } = sender(true);

    await expect(
      handler(event, { requestId: 'r', input: { videoPaths: ['C:\\a.mp4'] } })
    ).resolves.toEqual(RESULT);
    expect(sent).toHaveLength(0);
  });
});

describe('video notes bridge', () => {
  test('subscribes with a request id, filters other runs, and cleans up', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    let progressListener: ((payload: unknown) => void) | null = null;
    let unsubscribed = false;
    const bridge = createStudyCoachBridge(
      async (channel, ...args) => {
        calls.push({ channel, args });
        if (channel === VIDEO_NOTES_CHANNELS.generate) {
          const payload = args[0] as { requestId: string };
          progressListener?.({ requestId: 'someone-else', progress: { message: 'wrong' } });
          progressListener?.({
            requestId: payload.requestId,
            progress: {
              videoIndex: 0,
              videoCount: 1,
              videoPath: 'C:\\a',
              stage: 'notes',
              message: '正在生成笔记…'
            }
          });
          return RESULT;
        }
        return '';
      },
      (channel, listener) => {
        if (channel === VIDEO_NOTES_CHANNELS.progress) {
          progressListener = listener;
          return () => {
            unsubscribed = true;
          };
        }
        return () => undefined;
      }
    );
    const updates: unknown[] = [];

    await expect(
      bridge.generateVideoNotes(
        { videoPaths: ['C:\\a.mp4'], outputDir: 'C:\\out' },
        (progress) => updates.push(progress)
      )
    ).resolves.toEqual(RESULT);

    expect(updates).toEqual([
      {
        videoIndex: 0,
        videoCount: 1,
        videoPath: 'C:\\a',
        stage: 'notes',
        message: '正在生成笔记…'
      }
    ]);
    expect(calls[0]!.channel).toBe(VIDEO_NOTES_CHANNELS.generate);
    expect(calls[0]!.args[0]).toMatchObject({
      input: {
        videoPaths: ['C:\\a.mp4'],
        outputDir: 'C:\\out'
      }
    });
    expect(unsubscribed).toBe(true);
  });

  test('routes native dialogs and openPath through app channels', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const bridge = createStudyCoachBridge(async (channel, ...args) => {
      calls.push({ channel, args });
      if (channel === APP_IPC_CHANNELS.pickVideoFiles) return ['C:\\a.mp4'];
      if (channel === APP_IPC_CHANNELS.pickOutputDirectory) return 'C:\\out';
      return '';
    });

    await expect(bridge.pickVideoFiles()).resolves.toEqual(['C:\\a.mp4']);
    await expect(bridge.pickOutputDirectory()).resolves.toBe('C:\\out');
    await expect(bridge.openPath('C:\\out\\index.html')).resolves.toBe('');

    expect(calls.map((entry) => entry.channel)).toEqual([
      APP_IPC_CHANNELS.pickVideoFiles,
      APP_IPC_CHANNELS.pickOutputDirectory,
      APP_IPC_CHANNELS.openPath
    ]);
    expect(calls[2]!.args).toEqual(['C:\\out\\index.html']);
  });
});

const JOB = {
  id: 'job-1',
  videoPaths: ['C:\\a.mp4'],
  outputDir: 'C:\\out',
  status: 'queued',
  createdAt: '2026-11-15T03:00:00.000Z',
  lessons: [],
  estimate: { tokens: 1, minutes: 1 },
  usage: { inputTokens: 0, outputTokens: 0 }
} as VideoJob;

describe('video job IPC handlers', () => {
  test('validates the enqueue payload and forwards it to the api', async () => {
    const calls: unknown[] = [];
    const api = {
      async enqueueVideoNotes(input: unknown) {
        calls.push(input);
        return JOB;
      },
      async estimateVideoNotes() {
        return { lessons: 1, durationSeconds: 60, tokens: 1, minutes: 1 };
      }
    } as unknown as StudyCoachApi;
    const handlers = createVideoJobHandlers(api);

    await expect(handlers.enqueue({ videoPaths: ['C:\\a.mp4'] })).resolves.toEqual(JOB);
    expect(calls).toEqual([{ videoPaths: ['C:\\a.mp4'] }]);

    await expect(handlers.enqueue({ videoPaths: ['rel.mp4'] })).rejects.toThrow(/绝对路径/);
    await expect(handlers.enqueue({ videoPaths: ['C:\\a.txt'] })).rejects.toThrow(/媒体格式/);
    await expect(handlers.enqueue({})).rejects.toThrow(/视频文件或文件夹/);
    await expect(handlers.enqueue({ folder: 'rel' })).rejects.toThrow(/绝对路径/);
    await expect(handlers.estimate({ folder: 'C:\\course' })).resolves.toMatchObject({
      lessons: 1
    });
  });

  test('routes job ids and retry payloads', async () => {
    const calls: unknown[] = [];
    const api = {
      async listVideoJobs() {
        return [JOB];
      },
      async cancelVideoJob(id: string) {
        calls.push(['cancel', id]);
        return JOB;
      },
      async resumeVideoJob(id: string) {
        calls.push(['resume', id]);
        return JOB;
      },
      async retryVideoLesson(input: unknown) {
        calls.push(['retry', input]);
        return JOB;
      },
      async removeVideoJob(id: string) {
        calls.push(['remove', id]);
      }
    } as unknown as StudyCoachApi;
    const handlers = createVideoJobHandlers(api);

    await expect(handlers.listJobs()).resolves.toEqual([JOB]);
    await handlers.cancelJob('job-1');
    await handlers.resumeJob('job-1');
    await handlers.retryLesson({ jobId: 'job-1', videoPath: 'C:\\a.mp4' });
    await handlers.removeJob('job-1');

    expect(calls).toEqual([
      ['cancel', 'job-1'],
      ['resume', 'job-1'],
      ['retry', { jobId: 'job-1', videoPath: 'C:\\a.mp4' }],
      ['remove', 'job-1']
    ]);

    await expect(handlers.cancelJob('')).rejects.toThrow(/任务 ID/);
    await expect(handlers.retryLesson({ jobId: 'job-1' })).rejects.toThrow(/视频路径/);
  });
});

describe('video job bridge', () => {
  test('exposes queue calls and subscribes to job snapshots', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = [];
    const listeners = new Map<string, (payload: unknown) => void>();
    const bridge = createStudyCoachBridge(
      async (channel, ...args) => {
        calls.push({ channel, args });
        if (channel === VIDEO_NOTES_CHANNELS.pickVideoFolder) return 'C:\\course';
        if (channel === VIDEO_NOTES_CHANNELS.listJobs) return [JOB];
        if (channel === VIDEO_NOTES_CHANNELS.removeJob) return undefined;
        if (channel === VIDEO_NOTES_CHANNELS.estimate) {
          return { lessons: 1, durationSeconds: 60, tokens: 1, minutes: 1 };
        }
        return JOB;
      },
      (channel, listener) => {
        listeners.set(channel, listener);
        return () => undefined;
      }
    );

    await expect(bridge.pickVideoFolder?.()).resolves.toBe('C:\\course');
    await expect(
      bridge.enqueueVideoNotes?.({ videoPaths: ['C:\\a.mp4'] })
    ).resolves.toEqual(JOB);
    await bridge.estimateVideoNotes?.({ folder: 'C:\\course' });
    await expect(bridge.listVideoJobs?.()).resolves.toEqual([JOB]);
    await bridge.cancelVideoJob?.('job-1');
    await bridge.resumeVideoJob?.('job-1');
    await bridge.retryVideoLesson?.({ jobId: 'job-1', videoPath: 'C:\\a.mp4' });
    await bridge.removeVideoJob?.('job-1');

    const received: VideoJob[][] = [];
    bridge.onVideoJobsChanged?.((jobs) => received.push(jobs));
    listeners.get(VIDEO_NOTES_CHANNELS.jobsChanged)?.([JOB]);
    listeners.get(VIDEO_NOTES_CHANNELS.jobsChanged)?.('not-an-array');
    expect(received).toEqual([[JOB]]);

    expect(calls.map((entry) => entry.channel)).toEqual([
      VIDEO_NOTES_CHANNELS.pickVideoFolder,
      VIDEO_NOTES_CHANNELS.enqueue,
      VIDEO_NOTES_CHANNELS.estimate,
      VIDEO_NOTES_CHANNELS.listJobs,
      VIDEO_NOTES_CHANNELS.cancelJob,
      VIDEO_NOTES_CHANNELS.resumeJob,
      VIDEO_NOTES_CHANNELS.retryLesson,
      VIDEO_NOTES_CHANNELS.removeJob
    ]);
  });
});