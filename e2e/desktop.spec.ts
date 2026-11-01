import { expect, test } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launchStudyCoach, type LaunchedStudyCoach } from './support/launch';

const WORKSPACE_NAME = 'E2E 学习';
const TASK_TITLE = 'E2E 任务：完成一课';

async function readVaultTaskMarkdown(vault: string): Promise<string> {
  const workspacesRoot = join(vault, 'workspaces');
  const workspaceIds = await readdir(workspacesRoot);
  let combined = '';
  for (const workspaceId of workspaceIds) {
    const tasksDir = join(workspacesRoot, workspaceId, 'tasks');
    const files = await readdir(tasksDir).catch(() => [] as string[]);
    for (const file of files) {
      combined += `${await readFile(join(tasksDir, file), 'utf8')}\n`;
    }
  }
  return combined;
}

test.describe('Study Coach desktop', () => {
  test('onboarding → today plan → butler chat uses the real app with a fake model', async () => {
    const launched: LaunchedStudyCoach = await launchStudyCoach();
    const { page, environment } = launched;

    try {
      await test.step('onboarding creates a workspace', async () => {
        await expect(page.getByRole('heading', { name: /先告诉我/ })).toBeVisible();
        await page.getByLabel('Workspace 名称').fill(WORKSPACE_NAME);
        await page.getByLabel('你想先达成什么？').fill('完成真实的端到端测试');
        await page.getByLabel('补充说明（可选）').fill('由 Playwright 在临时 vault 中创建');
        await page.getByRole('button', { name: '开始使用' }).click();

        await expect(page.getByRole('button', { name: '管家', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: new RegExp(WORKSPACE_NAME) })).toBeVisible();
      });

      await test.step('today plan persists a task in the selected workspace', async () => {
        await page.getByRole('button', { name: new RegExp(WORKSPACE_NAME) }).click();
        await page.getByRole('button', { name: '今日安排', exact: true }).click();
        await expect(page.getByLabel('任务标题')).toBeVisible();

        await page.getByLabel('任务标题').fill(TASK_TITLE);
        await page.getByLabel('科目').fill('测试');
        await page.getByLabel('时长（分钟）').fill('25');
        await page.getByLabel('验收标准').fill('任务出现在今日安排');
        await page.getByRole('button', { name: '添加任务' }).click();

        await expect(page.getByText('任务已添加')).toBeVisible();
        await expect(page.getByRole('table').getByText(TASK_TITLE, { exact: true })).toBeVisible();
      });

      await test.step('butler chat receives local workspace context from the fake model', async () => {
        await page.getByRole('button', { name: '管家', exact: true }).click();
        await expect(page.getByText('早上好，xiaolai。')).toBeVisible();
        await page.getByRole('button', { name: '帮我排一下今天的优先级' }).click();

        await expect(page.getByText('帮我排一下今天的优先级')).toBeVisible();
        await expect(page.getByText(/假模型回复：已读取本地任务/)).toBeVisible({
          timeout: 30_000
        });
      });

      await test.step('state and vault stay on disk', async () => {
        const state = JSON.parse(
          await readFile(join(environment.userData, 'state.json'), 'utf8')
        ) as { onboarded?: boolean };
        expect(state.onboarded).toBe(true);
        await expect(readVaultTaskMarkdown(environment.vault)).resolves.toContain(TASK_TITLE);
      });
    } finally {
      await launched.close();
    }
  });
});
