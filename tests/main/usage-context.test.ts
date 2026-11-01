import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { createAppContext } from '../../src/main/context';
import { InMemorySecretStore } from '../../src/main/settings/secret-store';

test('records butler usage, prices it and clears it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-usage-context-'));
  try {
    const model = new FakeModelClient([
      { text: '回复', usage: { inputTokens: 10, outputTokens: 4 } }
    ]);
    const context = await createAppContext({
      userDataPath: dir,
      defaultVaultPath: join(dir, 'vault'),
      secretStore: new InMemorySecretStore(),
      modelClient: model,
      now: () => new Date(2026, 10, 1, 9, 0, 0)
    });

    await context.api.send({ message: '你好' });

    const summary = await context.api.getUsageSummary(7);
    expect(summary.totals).toEqual({ inputTokens: 10, outputTokens: 4, calls: 1 });
    expect(summary.days[0]).toMatchObject({ date: '2026-11-01', calls: 1 });
    expect(summary.estimatedCost).toBeNull();

    await context.api.updateSettings({
      budget: { inputPricePerMillion: 1, outputPricePerMillion: 2 } as never
    });
    const priced = await context.api.getUsageSummary();
    expect(priced.estimatedCost).toBeCloseTo((10 / 1_000_000) * 1 + (4 / 1_000_000) * 2, 12);

    const raw = await readFile(join(dir, 'usage.json'), 'utf8');
    expect(raw).not.toContain('你好');
    expect(raw).not.toContain('回复');

    await context.api.clearUsage();
    expect((await context.api.getUsageSummary(7)).totals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      calls: 0
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('records override-model usage with the conversation model label', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-usage-override-'));
  try {
    const model = new FakeModelClient([
      { text: '回复', usage: { inputTokens: 5, outputTokens: 2 } }
    ]);
    const context = await createAppContext({
      userDataPath: dir,
      defaultVaultPath: join(dir, 'vault'),
      secretStore: new InMemorySecretStore(),
      modelClient: model,
      now: () => new Date(2026, 10, 1, 9, 0, 0)
    });
    const conversation = await context.api.createConversation({});
    await context.api.setConversationModel(conversation.id, 'override-model');

    await context.api.send({ conversationId: conversation.id, message: '你好' });

    expect(await context.usage.list()).toEqual([
      expect.objectContaining({
        model: 'override-model',
        calls: 1,
        inputTokens: 5,
        outputTokens: 2
      })
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
