// @vitest-environment jsdom
import { homeGreeting } from '../../src/shared/greeting';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MEMORY_KIND_LABELS,
  memorySourceLabel,
  memoryWhyRemembered
} from '../../src/renderer/shell/ProjectSections';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

test('renders memory cards with kind, source and why', async () => {
  setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await userEvent.click(screen.getByRole('button', { name: '记忆' }));

  expect(screen.getByText('极限定义还不稳，建议先复习再做新题。')).toBeInTheDocument();
  expect(screen.getAllByText('薄弱点').length).toBeGreaterThan(0);
  expect(screen.getByText('来自 10月30日复盘')).toBeInTheDocument();
  expect(screen.getByText('薄弱点 · 来自 10月30日复盘')).toBeInTheDocument();
});

test('edits text and kind, then keeps the change after reload', async () => {
  const api = setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await userEvent.click(screen.getByRole('button', { name: '记忆' }));
  expect(screen.getByText('2 个薄弱点')).toBeInTheDocument();

  const text = '极限定义还不稳，建议先复习再做新题。';
  await userEvent.click(screen.getByRole('button', { name: `编辑记忆：${text}` }));
  const textarea = screen.getByLabelText('记忆内容');
  expect((textarea as HTMLTextAreaElement).value).toBe(text);

  await userEvent.clear(textarea);
  expect(screen.getByRole('button', { name: '保存记忆' })).toBeDisabled();
  await userEvent.type(textarea, '极限定义已经稳住');
  await userEvent.selectOptions(screen.getByLabelText('记忆类型'), 'strength');
  await userEvent.click(screen.getByRole('button', { name: '保存记忆' }));

  expect(await screen.findByText('极限定义已经稳住')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText('1 个薄弱点')).toBeInTheDocument());
  expect((await api.listMemory()).find((record) => record.id === 'm1')).toMatchObject({
    text: '极限定义已经稳住',
    kind: 'strength'
  });
  const profile = await api.getMemoryProfile();
  expect(profile.strengths).toContain('极限定义已经稳住');
  expect(profile.weaknesses).not.toContain('极限定义已经稳住');
});

test('deletes a memory after confirmation and refreshes the profile', async () => {
  const api = setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await userEvent.click(screen.getByRole('button', { name: '记忆' }));
  const text = '极限定义还不稳，建议先复习再做新题。';
  const before = (await api.getMemoryProfile()).memoryCount;
  expect(screen.getByText('2 个薄弱点')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: `删除记忆：${text}` }));
  expect(screen.getByRole('button', { name: `确认删除记忆：${text}` })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: `确认删除记忆：${text}` }));

  await waitFor(() => expect(screen.queryByText(text)).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByText('1 个薄弱点')).toBeInTheDocument());
  expect((await api.listMemory()).some((record) => record.id === 'm1')).toBe(false);
  expect((await api.getMemoryProfile()).memoryCount).toBe(before - 1);
});

test('keeps the edit input and shows an error when saving fails', async () => {
  const api = setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await userEvent.click(screen.getByRole('button', { name: '记忆' }));
  const spy = vi.spyOn(api, 'updateMemory').mockRejectedValueOnce(new Error('保存失败'));

  const text = '极限定义还不稳，建议先复习再做新题。';
  await userEvent.click(screen.getByRole('button', { name: `编辑记忆：${text}` }));
  const textarea = screen.getByLabelText('记忆内容');
  await userEvent.clear(textarea);
  await userEvent.type(textarea, '新的记忆内容');
  await userEvent.click(screen.getByRole('button', { name: '保存记忆' }));

  expect(await screen.findByText('保存失败')).toBeInTheDocument();
  expect(screen.getByLabelText('记忆内容')).toHaveValue('新的记忆内容');
  spy.mockRestore();
});

test('adds a memory manually and refreshes the profile', async () => {
  const api = setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await userEvent.click(screen.getByRole('button', { name: '记忆' }));
  const before = (await api.getMemoryProfile()).memoryCount;

  await userEvent.click(screen.getByRole('button', { name: '新增记忆' }));
  await userEvent.type(screen.getByLabelText('新记忆内容'), '我更喜欢早上背单词');
  await userEvent.selectOptions(screen.getByLabelText('新记忆类型'), 'preference');
  await userEvent.click(screen.getByRole('button', { name: '保存新记忆' }));

  expect(await screen.findByText('我更喜欢早上背单词')).toBeInTheDocument();
  expect((await api.listMemory()).find((record) => record.text === '我更喜欢早上背单词')).toMatchObject({
    kind: 'preference',
    source: 'manual'
  });
  await waitFor(async () =>
    expect((await api.getMemoryProfile()).memoryCount).toBeGreaterThan(before)
  );
});

test('shows the empty state when there are no memories', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  const records = await api.listMemory();
  for (const record of records) {
    await api.deleteMemory({ workspaceId: record.workspaceId, id: record.id });
  }
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await userEvent.click(screen.getByRole('button', { name: '记忆' }));

  expect(
    screen.getByText('还没有记忆。完成一次复盘后，阿咲会记住你的卡点和偏好。')
  ).toBeInTheDocument();
});

test('formats review sources deterministically', () => {
  expect(MEMORY_KIND_LABELS).toEqual({
    weakness: '薄弱点',
    strength: '优势',
    preference: '偏好',
    plan: '计划',
    fact: '事实'
  });
  expect(memorySourceLabel('review:2026-11-01')).toBe('来自 2026-11-01 复盘');
  expect(memorySourceLabel('10月30日复盘')).toBe('来自 10月30日复盘');
  expect(
    memoryWhyRemembered({
      id: 'm1',
      workspaceId: 'kaoyan',
      text: '卡住',
      kind: 'weakness',
      source: 'review:2026-11-01'
    })
  ).toBe('薄弱点 · 来自 11-01 复盘里提到的卡点');
});
