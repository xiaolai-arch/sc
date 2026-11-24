// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MIGRATION_STEP_LINE_SETTINGS_ADOPTED,
  MIGRATION_STEP_LINE_SETTINGS_UNCHANGED
} from '../../src/shared/backup-copy';
import { FirstRunDialog } from '../../src/renderer/shell/FirstRunDialog';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

/** The spec's 首启确认语, quoted verbatim. */
const FIRST_RUN_CONFIRM =
  '选择备份文件夹后，阿咲会把里面的项目、记录和对话恢复到这台电脑；备份里带设置时会一起还原（API Key 不会）。';

const RESTORED_FULL = {
  path: '/tmp/my-backup',
  safetyPath: '/tmp/safety',
  restored: { vault: true, conversations: true, usage: true, state: true }
};
const RESTORED_WITHOUT_SETTINGS = {
  ...RESTORED_FULL,
  restored: { vault: true, conversations: true, usage: true, state: false }
};

function stubApi(restoreBackup: ReturnType<typeof vi.fn>) {
  window.studyCoach = { restoreBackup } as never;
}

async function clickRestoreEntry() {
  await userEvent.click(screen.getByRole('button', { name: '从备份恢复…' }));
}

// --- the entry (验收 27) -------------------------------------------------------

test('the restore entry is a ghost secondary under the form; create keeps the primary slot', () => {
  stubApi(vi.fn());
  render(
    <FirstRunDialog open onComplete={vi.fn()} onSkip={vi.fn()} onRestoreComplete={vi.fn()} />
  );

  const entry = screen.getByRole('button', { name: '从备份恢复…' });
  // ghost = transparent background, accent text; never the primary fill.
  expect(entry).toHaveClass('bg-transparent');
  expect(entry).not.toHaveClass('bg-[#0071e3]');
  expect(entry).toBeEnabled();

  const primary = screen.getByRole('button', { name: '创建项目并开始' });
  expect(primary).toHaveClass('bg-[#0071e3]');
  // The entry sits below the form, so the create button keeps the visual 主位.
  expect(entry.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('clicking the entry confirms with the first-run sentence, then calls restoreBackup (验收 27)', async () => {
  const restoreBackup = vi.fn().mockResolvedValue(RESTORED_WITHOUT_SETTINGS);
  stubApi(restoreBackup);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <FirstRunDialog open onComplete={vi.fn()} onSkip={vi.fn()} onRestoreComplete={vi.fn()} />
  );

  await clickRestoreEntry();

  // 首启确认语单独写：no 「会覆盖」 scare copy from the settings page.
  expect(confirm).toHaveBeenCalledWith(FIRST_RUN_CONFIRM);
  await vi.waitFor(() => expect(restoreBackup).toHaveBeenCalledTimes(1));
  confirm.mockRestore();
});

test('declining the confirmation never reaches the picker', async () => {
  const restoreBackup = vi.fn();
  stubApi(restoreBackup);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(
    <FirstRunDialog open onComplete={vi.fn()} onSkip={vi.fn()} onRestoreComplete={vi.fn()} />
  );

  await clickRestoreEntry();

  expect(restoreBackup).not.toHaveBeenCalled();
  expect(screen.queryByText(/已恢复/)).not.toBeInTheDocument();
  confirm.mockRestore();
});

// --- busy mode (验收 34) -------------------------------------------------------

test('while a restore runs, closing, 稍后再说 and creating are locked', async () => {
  let resolveRestore: (value: unknown) => void = () => undefined;
  const restoreBackup = vi.fn().mockReturnValue(
    new Promise((resolve) => {
      resolveRestore = resolve;
    })
  );
  stubApi(restoreBackup);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <FirstRunDialog open onComplete={vi.fn()} onSkip={vi.fn()} onRestoreComplete={vi.fn()} />
  );

  await clickRestoreEntry();

  expect(screen.getByRole('button', { name: '正在恢复…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '稍后再说' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '创建项目并开始' })).toBeDisabled();
  expect(screen.getByLabelText('项目名称')).toBeDisabled();

  resolveRestore(null);
});

// --- success panels (验收 28/30/31 的文案半边) ----------------------------------

test('an adopted restore shows the items and the settings-restored line (P3 版)', async () => {
  const restoreBackup = vi.fn().mockResolvedValue(RESTORED_FULL);
  stubApi(restoreBackup);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <FirstRunDialog open onComplete={vi.fn()} onSkip={vi.fn()} onRestoreComplete={vi.fn()} />
  );

  await clickRestoreEntry();

  expect(await screen.findByText('已恢复：项目、记录、对话、设置、用量。')).toBeInTheDocument();
  expect(await screen.findByText(MIGRATION_STEP_LINE_SETTINGS_ADOPTED)).toBeInTheDocument();
  expect(screen.queryByText(MIGRATION_STEP_LINE_SETTINGS_UNCHANGED)).not.toBeInTheDocument();
});

test('a restore without adoption shows the settings-unchanged line (P2 版)', async () => {
  const restoreBackup = vi.fn().mockResolvedValue(RESTORED_WITHOUT_SETTINGS);
  stubApi(restoreBackup);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <FirstRunDialog open onComplete={vi.fn()} onSkip={vi.fn()} onRestoreComplete={vi.fn()} />
  );

  await clickRestoreEntry();

  expect(await screen.findByText(MIGRATION_STEP_LINE_SETTINGS_UNCHANGED)).toBeInTheDocument();
  expect(screen.queryByText(MIGRATION_STEP_LINE_SETTINGS_ADOPTED)).not.toBeInTheDocument();
});

test('omitted sources are left out of the restored-items line', async () => {
  const restoreBackup = vi.fn().mockResolvedValue({
    ...RESTORED_FULL,
    restored: { vault: true, conversations: false, usage: false, state: true }
  });
  stubApi(restoreBackup);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <FirstRunDialog open onComplete={vi.fn()} onSkip={vi.fn()} onRestoreComplete={vi.fn()} />
  );

  await clickRestoreEntry();

  expect(await screen.findByText('已恢复：项目、记录、设置。')).toBeInTheDocument();
});

// --- cancel and failure (验收 33/34) -------------------------------------------

test('a dismissed picker returns to the form with no result and no error', async () => {
  const restoreBackup = vi.fn().mockResolvedValue(null);
  stubApi(restoreBackup);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <FirstRunDialog open onComplete={vi.fn()} onSkip={vi.fn()} onRestoreComplete={vi.fn()} />
  );

  await clickRestoreEntry();
  await vi.waitFor(() => expect(restoreBackup).toHaveBeenCalled());

  expect(screen.queryByText(/已恢复/)).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '创建项目并开始' })).toBeEnabled();
});

test('a failed restore shows one line and the form stays usable for a retry (验收 33)', async () => {
  const restoreBackup = vi
    .fn()
    .mockRejectedValueOnce(new Error('所选目录不是 ASAKI 备份：缺少 vault 文件夹。'))
    .mockResolvedValueOnce(RESTORED_FULL);
  stubApi(restoreBackup);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <FirstRunDialog open onComplete={vi.fn()} onSkip={vi.fn()} onRestoreComplete={vi.fn()} />
  );

  await clickRestoreEntry();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '所选目录不是 ASAKI 备份：缺少 vault 文件夹。'
  );

  // The form is still usable; the same entry can retry and succeed.
  await clickRestoreEntry();
  expect(await screen.findByText(MIGRATION_STEP_LINE_SETTINGS_ADOPTED)).toBeInTheDocument();
});

// --- closing after a restore (验收 34) ------------------------------------------

test('closing after a restore completes the restore path, not onboarding', async () => {
  const restoreBackup = vi.fn().mockResolvedValue(RESTORED_FULL);
  stubApi(restoreBackup);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const onComplete = vi.fn();
  const onSkip = vi.fn();
  const onRestoreComplete = vi.fn();
  render(
    <FirstRunDialog
      open
      onComplete={onComplete}
      onSkip={onSkip}
      onRestoreComplete={onRestoreComplete}
    />
  );

  await clickRestoreEntry();
  await screen.findByText(MIGRATION_STEP_LINE_SETTINGS_ADOPTED);
  await userEvent.click(screen.getByRole('button', { name: '稍后再说' }));

  expect(onRestoreComplete).toHaveBeenCalledTimes(1);
  expect(onSkip).not.toHaveBeenCalled();
  expect(onComplete).not.toHaveBeenCalled();
});

test('closing without a restore still dismisses for the session only (回归 35)', async () => {
  stubApi(vi.fn());
  const onComplete = vi.fn();
  const onSkip = vi.fn();
  const onRestoreComplete = vi.fn();
  render(
    <FirstRunDialog
      open
      onComplete={onComplete}
      onSkip={onSkip}
      onRestoreComplete={onRestoreComplete}
    />
  );

  await userEvent.click(screen.getByRole('button', { name: '稍后再说' }));

  expect(onSkip).toHaveBeenCalledTimes(1);
  expect(onRestoreComplete).not.toHaveBeenCalled();
  expect(onComplete).not.toHaveBeenCalled();
});

test('creating a project after a restore still takes the normal completion path', async () => {
  const api = createMockApi(localStorage, { streamPace: 0.01 });
  api.restoreBackup = vi.fn().mockResolvedValue(RESTORED_FULL);
  const onboarding = vi.spyOn(api, 'completeWorkspaceOnboarding');
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  const onComplete = vi.fn();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <FirstRunDialog open onComplete={onComplete} onSkip={vi.fn()} onRestoreComplete={vi.fn()} />
  );

  await clickRestoreEntry();
  await screen.findByText(MIGRATION_STEP_LINE_SETTINGS_ADOPTED);
  await userEvent.type(screen.getByLabelText('项目名称'), '恢复后的新项目');
  await userEvent.click(screen.getByRole('button', { name: '创建项目并开始' }));

  // 不阻止、不代填：the user's own creation goes through unchanged.
  await vi.waitFor(() => expect(onboarding).toHaveBeenCalledTimes(1));
  expect(onComplete).toHaveBeenCalledWith('我的学习恢复后的新项目');
});

// --- the Workspace wiring (验收 34 的刷新半边) -----------------------------------

test('closing the dialog after a restore refreshes without creating a workspace', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.01 });
  api.restoreBackup = vi.fn().mockResolvedValue(RESTORED_FULL);
  const onboarding = vi.spyOn(api, 'completeWorkspaceOnboarding');
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  const onRefresh = vi.fn();
  render(<Workspace hasApiKey={false} needsOnboarding onRefresh={onRefresh} />);

  await screen.findByText('欢迎使用阿咲');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await clickRestoreEntry();
  await screen.findByText(MIGRATION_STEP_LINE_SETTINGS_ADOPTED);
  await userEvent.click(screen.getByRole('button', { name: '稍后再说' }));

  await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  expect(screen.queryByText('欢迎使用阿咲')).not.toBeInTheDocument();
  // 未创建任何多余工作区：completeWorkspaceOnboarding was never called.
  expect(onboarding).not.toHaveBeenCalled();
});

test('plain 稍后再说 without a restore keeps the 1.2.0 behavior (回归 35)', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.01 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  const onRefresh = vi.fn();
  render(<Workspace hasApiKey={false} needsOnboarding onRefresh={onRefresh} />);

  await screen.findByText('欢迎使用阿咲');
  await userEvent.click(screen.getByRole('button', { name: '稍后再说' }));

  expect(screen.queryByText('欢迎使用阿咲')).not.toBeInTheDocument();
  expect(onRefresh).not.toHaveBeenCalled();
});
