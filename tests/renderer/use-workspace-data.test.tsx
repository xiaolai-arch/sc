// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import type { KnowledgeTopic } from '../../src/shared/knowledge';
import type {
  CreateNoteInput,
  UpdateWorkspaceTaskInput
} from '../../src/shared/workspace';
import { useWorkspaceData } from '../../src/renderer/shell/useWorkspaceData';
import { createMockApi } from '../../web/mock-api';

function topicWithTask(refId: string): KnowledgeTopic {
  return {
    id: 'kt-1',
    name: 'LangChain',
    aliases: [],
    status: 'learning',
    summary: '',
    evidence: [{ id: 'kev-1', kind: 'task', refId, title: 'LangChain 练习', date: '2026-11-02' }],
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z'
  };
}

test('refreshes knowledge topics after a task is completed', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  const [workspace] = await api.listWorkspaces();
  const task = await api.createTask({
    workspaceId: workspace!.id,
    title: 'LangChain 练习',
    subject: '',
    durationMin: 30,
    acceptance: ''
  });
  let topics: KnowledgeTopic[] = [];
  window.studyCoach = {
    ...api,
    listKnowledgeTopics: async () => topics,
    updateWorkspaceTask: async (input: UpdateWorkspaceTaskInput) => {
      const updated = await api.updateWorkspaceTask(input);
      if (updated.status === 'done') topics = [topicWithTask(task.id)];
      return updated;
    }
  } as never;

  const { result } = renderHook(() => useWorkspaceData());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.knowledgeTopics).toEqual([]);

  await act(async () => {
    await result.current.updateTask({ taskId: task.id, status: 'done' });
  });

  await waitFor(() => expect(result.current.knowledgeTopics.map((topic) => topic.id)).toEqual(['kt-1']));
});

test('refreshes knowledge topics after a note is written', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  const [workspace] = await api.listWorkspaces();
  let topics: KnowledgeTopic[] = [];
  window.studyCoach = {
    ...api,
    listKnowledgeTopics: async () => topics,
    createNote: async (input: CreateNoteInput) => {
      const note = await api.createNote(input);
      topics = [
        {
          ...topicWithTask('n1'),
          evidence: [
            { id: 'kev-1', kind: 'note', refId: note.id, title: 'LangChain 笔记', date: '2026-11-02' }
          ]
        }
      ];
      return note;
    }
  } as never;

  const { result } = renderHook(() => useWorkspaceData());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.knowledgeTopics).toEqual([]);

  await act(async () => {
    await result.current.createNote({
      workspaceId: workspace!.id,
      title: 'LangChain 笔记',
      subject: '',
      body: ''
    });
  });

  await waitFor(() => expect(result.current.knowledgeTopics.map((topic) => topic.id)).toEqual(['kt-1']));
});
