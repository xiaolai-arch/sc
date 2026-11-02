import { friendlyErrorMessage } from '../../src/shared/errors';

test('strips the Electron IPC wrapper from remote errors', () => {
  const cause = new Error(
    "Error invoking remote method 'study-coach:settings:set-api-key': Error: API key不能为空。"
  );
  expect(friendlyErrorMessage(cause)).toBe('API key不能为空。');
});

test('keeps ordinary messages and falls back for empty or non-error values', () => {
  expect(friendlyErrorMessage(new Error('保存失败。'))).toBe('保存失败。');
  expect(friendlyErrorMessage(new Error('   '), '默认提示')).toBe('默认提示');
  expect(friendlyErrorMessage('boom', '默认提示')).toBe('默认提示');
});
