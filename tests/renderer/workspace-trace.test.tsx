// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ButlerStreamListener } from '../../src/shared/butler-stream';
import type { SendMessageInput, SendMessageResult } from '../../src/shared/workspace';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function setup(
  stream: (
    input: SendMessageInput,
    onEvent: ButlerStreamListener
  ) => Promise<SendMessageResult>
) {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  api.stream = stream;
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

function scriptedStream(
  events: Array<Parameters<ButlerStreamListener>[0]>,
  answer: string
) {
  return async (input: SendMessageInput, onEvent: ButlerStreamListener) => {
    for (const event of events) onEvent(event);
    onEvent({ type: 'done', text: answer });
    if (input.conversationId && input.assistantMessageId) {
      const api = window.studyCoach;
      if (api) {
        await api.appendConversationMessage(input.conversationId, {
          id: input.assistantMessageId,
          role: 'assistant',
          text: answer,
          createdAt: new Date().toISOString()
        });
      }
    }
    return {
      text: answer,
      ...(input.conversationId ? { conversationId: input.conversationId } : {})
    };
  };
}

test('orders reasoning and tool rows from the stream and keeps them in memory', async () => {
  const api = setup(
    scriptedStream(
      [
        { type: 'reasoning', text: '第一段思考' },
        { type: 'tool-start', id: 't1', name: 'write_note', label: '写入笔记' },
        { type: 'tool-result', id: 't1', name: 'write_note', ok: true, label: '写入笔记' },
        { type: 'reasoning', text: '第二段思考' },
        { type: 'text', text: '最终回答' }
      ],
      '最终回答'
    )
  );

  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));
  await screen.findByText('最终回答');

  const titles = screen.getAllByText('思考');
  const toolTitle = screen.getByText('写入笔记');
  expect(titles).toHaveLength(2);
  expect(titles[0]!.compareDocumentPosition(toolTitle)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  );
  expect(toolTitle.compareDocumentPosition(titles[1]!)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  );

  // The reasoning is in memory only, never in the conversation JSON.
  const summary = (await api!.listConversations())[0]!;
  const conversation = await api!.getConversation(summary.id);
  expect(JSON.stringify(conversation)).not.toContain('第一段思考');
  expect(JSON.stringify(conversation)).not.toContain('第二段思考');

  // Switch away and back: the in-memory trace is still rendered.
  await userEvent.click(screen.getByRole('button', { name: '新对话' }));
  const sidebar = screen.getAllByRole('complementary')[0]!;
  await userEvent.click(
    within(sidebar).getByRole('button', { name: /帮我排一下今天的优先级/ })
  );
  await waitFor(() => expect(screen.getAllByText('思考')).toHaveLength(2));
});

test('reloads the conversation when it is reopened mid-turn', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  setup(async (input, onEvent) => {
    onEvent({ type: 'reasoning', text: '先想一想' });
    await gate;
    const answer = '延迟到达的回答';
    onEvent({ type: 'done', text: answer });
    const live = window.studyCoach;
    if (input.conversationId && input.assistantMessageId && live) {
      await live.appendConversationMessage(input.conversationId, {
        id: input.assistantMessageId,
        role: 'assistant',
        text: answer,
        createdAt: new Date().toISOString()
      });
    }
    return {
      text: answer,
      ...(input.conversationId ? { conversationId: input.conversationId } : {})
    };
  });

  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));

  const sidebar = screen.getAllByRole('complementary')[0]!;
  const item = await within(sidebar).findByRole('button', {
    name: /帮我排一下今天的优先级/
  });
  await userEvent.click(item);
  release();

  await waitFor(
    () => expect(screen.getAllByText('延迟到达的回答').length).toBeGreaterThanOrEqual(2),
    { timeout: 3000 }
  );
});
