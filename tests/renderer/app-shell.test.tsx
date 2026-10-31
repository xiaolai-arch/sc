// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../src/renderer/App';
import { createMockApi } from '../../web/mock-api';

test('saving an API key clears the unconfigured banner when returning via nav', async () => {
  localStorage.clear();
  window.studyCoach = createMockApi(localStorage);
  window.studyCoachPrototype = { reset: vi.fn() };

  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: '先看看示例' }));
  expect(await screen.findByText('未配置模型，当前使用模板计划。')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(await screen.findByLabelText('模型名称')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('API Key'), 'sk-test');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  await userEvent.click(screen.getByRole('button', { name: '管家' }));
  await waitFor(() =>
    expect(screen.queryByText('未配置模型，当前使用模板计划。')).not.toBeInTheDocument()
  );
});
