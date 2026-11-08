import type { StudyCoachApi } from '../../src/shared/ipc';
import {
  APP_IPC_CHANNELS,
  VIDEO_NOTES_CHANNELS,
  createIpcHandlers,
  createStudyCoachBridge,
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
          videoPaths: ['C:\\a.mp4'],
          language: 'zh'
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
        input: { videoPaths: ['C:\\a.mp4'], language: 'zh' }
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
        input: { videoPaths: ['C:\\a.mp4'], language: 'fr' }
      })
    ).rejects.toThrow(/转写语言/);
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
        { videoPaths: ['C:\\a.mp4'], outputDir: 'C:\\out', language: 'zh' },
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
        outputDir: 'C:\\out',
        language: 'zh'
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

describe('transcription IPC handlers', () => {
  test('validates and forwards the transcription settings', async () => {
    const calls: unknown[] = [];
    const api = {
      async getTranscriptionConfig() {
        return { baseURL: 'https://host/v1', model: 'm', hasApiKey: true };
      },
      async saveTranscriptionConfig(input: unknown) {
        calls.push(input);
        return { baseURL: 'https://host/v1', model: 'm', hasApiKey: true };
      }
    } as unknown as StudyCoachApi;
    const handlers = createIpcHandlers(api);

    await expect(handlers.getTranscriptionConfig()).resolves.toMatchObject({ hasApiKey: true });
    await handlers.saveTranscriptionConfig({
      baseURL: ' https://host/v1 ',
      model: ' m ',
      apiKey: 'key'
    });
    expect(calls).toEqual([{ baseURL: 'https://host/v1', model: 'm', apiKey: 'key' }]);

    await expect(
      handlers.saveTranscriptionConfig({ baseURL: 'ftp://host', model: 'm' })
    ).rejects.toThrow(/http/);
    await expect(
      handlers.saveTranscriptionConfig({ baseURL: 'https://host', model: 'm', apiKey: 1 })
    ).rejects.toThrow(/API key/);
  });
});