import {
  supportsStreaming,
  type ModelClient,
  type ModelRequest,
  type ModelResponse,
  type ModelStreamEvent,
  type ModelUsage,
  type StreamingModelClient
} from '../agent/model-client';

export interface RecordingModelMeta {
  provider: string;
  model: string;
}

export interface RecordedUsage extends ModelUsage, RecordingModelMeta {}

export type UsageRecorder = (usage: RecordedUsage) => Promise<void> | void;

/**
 * Wraps a model client so every successful call is reported to local usage
 * accounting. Recorder failures are swallowed: a full disk must never break a
 * conversation. Streaming is only exposed when the inner client supports it.
 */
export function createRecordingModelClient(
  inner: ModelClient,
  record: UsageRecorder,
  meta: RecordingModelMeta
): ModelClient {
  const capture = async (usage: ModelUsage | undefined): Promise<void> => {
    try {
      await record({
        provider: meta.provider,
        model: meta.model,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0
      });
    } catch {
      // Usage accounting is best-effort by design.
    }
  };

  const client: ModelClient = {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const response = await inner.complete(request);
      await capture(response.usage);
      return response;
    }
  };

  if (!supportsStreaming(inner)) return client;

  const streaming: StreamingModelClient = {
    ...client,
    async stream(
      request: ModelRequest,
      onEvent: (event: ModelStreamEvent) => void
    ): Promise<ModelResponse> {
      const response = await inner.stream(request, onEvent);
      await capture(response.usage);
      return response;
    }
  };
  return streaming;
}
