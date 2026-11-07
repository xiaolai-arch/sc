// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

test('surfaces a failed data slice instead of showing a false empty state', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.01 });
  api.listMemory = vi.fn().mockRejectedValue(new Error('vault 读取失败'));
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };

  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);

  expect(
    await screen.findByText(/部分数据加载失败：vault 读取失败/)
  ).toBeInTheDocument();
});