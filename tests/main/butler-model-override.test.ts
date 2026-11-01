import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelClient, type StreamingModelClient } from '../../src/main/agent/model-client';
import { ButlerServiceImpl } from '../../src/main/butler/butler-service';
import { ConversationStore } from '../../src/main/conversations/conversation-store';

const NOW = new Date(2026, 10, 1, 9, 0, 0);

async function fixture(): Promise<{ dir: string; store: ConversationStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'butler-model-override-'));
  return { dir, store: new ConversationStore(dir, { now: () => NOW }) };
}

test('uses the conversation model through the factory', async () => {
  const { dir, store } = await fixture();
  try {
    const conversation = await store.create({});
    await store.setModel(conversation.id, 'gpt-x');
    const defaultClient = new FakeModelClient(['default reply']);
    const overrideClient = new FakeModelClient(['override reply']);
    const seen: string[] = [];
    const service = new ButlerServiceImpl({
      conversationStore: store,
      modelClient: defaultClient,
      modelClientFor: (model) => {
        seen.push(model);
        return overrideClient;
      }
    });

    const result = await service.send({ conversationId: conversation.id, message: 'hi' });

    expect(seen).toEqual(['gpt-x']);
    expect(result.text).toBe('override reply');
    expect(defaultClient.calls).toHaveLength(0);
    expect(overrideClient.calls).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('uses the default client when the conversation has no model', async () => {
  const { dir, store } = await fixture();
  try {
    const conversation = await store.create({});
    const defaultClient = new FakeModelClient(['default reply']);
    const factory = vi.fn(() => new FakeModelClient(['override reply']));
    const service = new ButlerServiceImpl({
      conversationStore: store,
      modelClient: defaultClient,
      modelClientFor: factory
    });

    const result = await service.send({ conversationId: conversation.id, message: 'hi' });

    expect(factory).not.toHaveBeenCalled();
    expect(result.text).toBe('default reply');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('falls back to the default client when the factory returns null', async () => {
  const { dir, store } = await fixture();
  try {
    const conversation = await store.create({});
    await store.setModel(conversation.id, 'unknown-model');
    const defaultClient = new FakeModelClient(['default reply']);
    const service = new ButlerServiceImpl({
      conversationStore: store,
      modelClient: defaultClient,
      modelClientFor: () => null
    });

    const result = await service.send({ conversationId: conversation.id, message: 'hi' });

    expect(result.text).toBe('default reply');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('falls back to the default client when the factory throws', async () => {
  const { dir, store } = await fixture();
  try {
    const conversation = await store.create({});
    await store.setModel(conversation.id, 'broken-model');
    const defaultClient = new FakeModelClient(['default reply']);
    const service = new ButlerServiceImpl({
      conversationStore: store,
      modelClient: defaultClient,
      modelClientFor: () => {
        throw new Error('cannot build model');
      }
    });

    const result = await service.send({ conversationId: conversation.id, message: 'hi' });

    expect(result.text).toBe('default reply');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('uses the override factory for streaming too', async () => {
  const { dir, store } = await fixture();
  try {
    const conversation = await store.create({});
    await store.setModel(conversation.id, 'stream-model');
    const defaultClient = new FakeModelClient(['default reply']);
    const events: string[] = [];
    const override: StreamingModelClient = {
      complete: async () => ({
        text: 'complete fallback',
        usage: { inputTokens: 0, outputTokens: 0 }
      }),
      stream: async (_request, onEvent) => {
        onEvent({ type: 'text', text: 'streamed reply' });
        return { text: 'streamed reply', usage: { inputTokens: 1, outputTokens: 1 } };
      }
    };
    const seen: string[] = [];
    const service = new ButlerServiceImpl({
      conversationStore: store,
      modelClient: defaultClient,
      modelClientFor: (model) => {
        seen.push(model);
        return override;
      }
    });

    const result = await service.stream(
      { conversationId: conversation.id, message: 'hi' },
      (event) => {
        if (event.type === 'text') events.push(event.text);
      }
    );

    expect(seen).toEqual(['stream-model']);
    expect(result.text).toBe('streamed reply');
    expect(events).toContain('streamed reply');
    expect(defaultClient.calls).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
