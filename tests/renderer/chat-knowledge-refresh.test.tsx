// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ButlerStreamEvent } from '../../src/shared/butler-stream';
import type { KnowledgeTopic } from '../../src/shared/knowledge';
import type { SendMessageResult } from '../../src/shared/workspace';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';
import { sendPrompt } from './send-prompt';

const topic: KnowledgeTopic = {
  id: 'kt-1',
  name: 'LangGraph',
  aliases: [],
  status: 'learning',
  summary: '',
  evidence: [],
  createdAt: '2026-11-02T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z'
};

test('shows knowledge written by a chat tool before the turn finishes', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoachPrototype = { reset: vi.fn() };
  let topics: KnowledgeTopic[] = [topic];
  let finishTurn!: () => void;
  const turn = new Promise<void>((resolve) => {
    finishTurn = resolve;
  });

  const listKnowledge = vi.fn(async () => topics);
  window.studyCoach = {
    ...api,
    listKnowledgeTopics: listKnowledge,
    stream: async (
      _input: unknown,
      onEvent: (event: ButlerStreamEvent) => void
    ): Promise<SendMessageResult> => {
      onEvent({ type: 'tool-start', id: 'tool-1', name: 'record_knowledge', label: '记录知识' });
      topics = [
        {
          ...topic,
          evidence: [
            { id: 'kev-1', kind: 'chat', title: '今天学了 LangGraph 的状态图', date: '2026-11-02' }
          ]
        }
      ];
      onEvent({
        type: 'tool-result',
        id: 'tool-1',
        name: 'record_knowledge',
        ok: true,
        label: '记录知识'
      });
      await turn;
      onEvent({ type: 'done', text: '已记录' });
      return { text: '已记录' };
    }
  } as never;

  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  await screen.findByText('早上好，xiaolai。');

  await sendPrompt('我今天中午学习了 LangGraph 的状态图');
  expect(await screen.findByText('记录知识')).toBeInTheDocument();

  await userEvent.click(
    within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', {
      name: '知识库'
    })
  );
  // The turn is still open; the tool result must already be reflected.
  await waitFor(() => expect(listKnowledge.mock.calls.length).toBeGreaterThan(1));
  expect(
    await screen.findByText(
      (_content, element) => element?.tagName === 'P' && element.textContent === '证据 1 条'
    )
  ).toBeInTheDocument();
  expect(
    await screen.findByText(/今天学了 LangGraph 的状态图/)
  ).toBeInTheDocument();

  finishTurn();
  // Let the turn settle in the chat view so teardown has nothing pending.
  await userEvent.click(
    within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', {
      name: '日常'
    })
  );
  await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument());
});
