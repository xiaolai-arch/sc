import { expect, test } from '@playwright/test';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launchStudyCoach, type LaunchedStudyCoach } from './support/launch';

test.describe('阿咲 desktop', () => {
  test('conversation-first project creation and persistence', async () => {
    const launched: LaunchedStudyCoach = await launchStudyCoach();
    const { page, environment } = launched;

    try {
      await test.step('starts in the conversation shell', async () => {
        await expect(page.getByText('早上好，xiaolai。')).toBeVisible();
        await expect(page.getByRole('button', { name: '新对话' })).toBeVisible();
        await page.getByRole('button', { name: '新对话' }).click();
      });

      await test.step('creates a project through the conversation', async () => {
        await page.getByLabel('向阿咲提问').fill('我想考研');
        await page.getByRole('button', { name: '发送' }).click();

        const thinking = page.getByRole('button', { name: /思考/ }).first();
        await expect(thinking).toBeVisible({ timeout: 30_000 });
        await thinking.click();
        await expect(page.getByText(/我先创建考研项目/)).toBeVisible();
        await expect(page.getByText(/已创建项目「考研」/).last()).toBeVisible({
          timeout: 30_000
        });
        await page.getByRole('button', { name: '项目', exact: true }).click();
        await expect(page.getByRole('heading', { name: '考研', exact: true })).toBeVisible();
        await expect(page.getByText('2027 考研上岸')).toBeVisible();
      });

      await test.step('persists the conversation and project across reload', async () => {
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByText('早上好，xiaolai。')).toBeVisible();

        await page.getByRole('button', { name: /我想考研/ }).click();
        await expect(page.getByText(/已创建项目「考研」/).last()).toBeVisible({
          timeout: 30_000
        });
        await page.getByRole('button', { name: '项目', exact: true }).click();
        await expect(page.getByRole('heading', { name: '考研', exact: true })).toBeVisible();
        await expect(page.getByText('2027 考研上岸')).toBeVisible();
      });

      await test.step('writes the project to the vault', async () => {
        const workspaces = await readdir(join(environment.vault, 'workspaces'));
        expect(workspaces.length).toBeGreaterThan(0);
      });
    } finally {
      await launched.close();
    }
  });
});
