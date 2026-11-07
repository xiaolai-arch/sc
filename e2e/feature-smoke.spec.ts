import { expect, test } from '@playwright/test';
import { launchStudyCoach, type LaunchedStudyCoach } from './support/launch';

/**
 * Walks every navigation destination and creates one record of each kind
 * through the real UI. The model layer stays offline: the workspace is created
 * through the exposed API and the remaining features are local-first.
 */
test.describe('ASAKI feature smoke', () => {
  test('all pages render and reminders, memories, reviews and topics persist', async () => {
    const launched: LaunchedStudyCoach = await launchStudyCoach();
    const { page, environment } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await test.step('create a workspace through the API and reload', async () => {
        const workspaceId = await page.evaluate(async () => {
          const api = (window as unknown as { studyCoach: { createWorkspace: (input: unknown) => Promise<{ id: string }> } })
            .studyCoach;
          const workspace = await api.createWorkspace({
            name: '烟雾项目',
            kind: 'study',
            goal: '验证所有页面',
            description: 'e2e smoke'
          });
          return workspace.id;
        });
        expect(workspaceId).toBeTruthy();
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByText(/，xiaolai。$/)).toBeVisible();
      });

      await test.step('every navigation destination renders', async () => {
        await page.getByRole('button', { name: '今日安排', exact: true }).click();
        await expect(page.locator('header').getByText('今日安排', { exact: true })).toBeVisible();
        await expect(page.getByText('今天还没有安排')).toBeVisible();

        await page.getByRole('button', { name: '长期计划', exact: true }).click();
        await expect(page.locator('header').getByText('长期计划', { exact: true })).toBeVisible();
        await expect(page.getByText('还没有长期计划。')).toBeVisible();

        await page.getByRole('button', { name: '日常', exact: true }).click();
        await expect(page.getByLabel('向阿咲提问')).toBeVisible();

        await page.getByRole('button', { name: '知识库', exact: true }).click();
        await expect(page.locator('header').getByText('知识库', { exact: true })).toBeVisible();
        await expect(page.getByText('还没有知识主题。').first()).toBeVisible();

        await page.getByRole('button', { name: '记忆', exact: true }).click();
        await expect(page.locator('header').getByText('记忆', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '新增记忆' })).toBeVisible();

        await page.getByRole('button', { name: '复盘', exact: true }).click();
        await expect(page.locator('header').getByText('复盘', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '补录复盘' })).toBeVisible();

        await page.getByRole('button', { name: '提醒', exact: true }).click();
        await expect(page.locator('header').getByText('提醒', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '添加提醒' })).toBeVisible();
      });

      await test.step('creates a reminder', async () => {
        await page.getByLabel('提醒内容').fill('喝水');
        await page.getByRole('button', { name: '添加提醒' }).click();
        await expect(page.getByRole('button', { name: '编辑提醒：喝水' })).toBeVisible();
      });

      await test.step('creates a memory', async () => {
        await page.getByRole('button', { name: '记忆', exact: true }).click();
        await page.getByRole('button', { name: '新增记忆' }).click();
        await page.getByLabel('新记忆内容').fill('偏好早上学习');
        await page.getByRole('button', { name: '保存新记忆' }).click();
        await expect(page.getByText('偏好早上学习')).toBeVisible();
      });

      await test.step('backfills a review', async () => {
        await page.getByRole('button', { name: '复盘', exact: true }).click();
        await page.getByRole('button', { name: '补录复盘' }).click();
        await page.getByLabel('完成', { exact: true }).fill('完成极限练习');
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await expect(page.getByText('完成极限练习')).toBeVisible();
      });

      await test.step('creates a knowledge topic', async () => {
        await page.getByRole('button', { name: '知识库', exact: true }).click();
        await page.getByRole('button', { name: '新增主题' }).click();
        await page.getByLabel('主题名称').fill('LangChain');
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await expect(page.getByRole('button', { name: 'LangChain', exact: true })).toBeVisible();
      });

      await test.step('opens practice from the project page', async () => {
        await page.getByRole('button', { name: '日常', exact: true }).click();
        await page.getByRole('button', { name: '全部工作区' }).click();
        await expect(page.locator('header').getByText('项目', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: '练习', exact: true }).click();
        await expect(page.getByText('新建练习集')).toBeVisible();
        await page.getByRole('button', { name: '关闭练习' }).click();
      });

      await test.step('saves settings and addresses the user by name', async () => {
        await page.getByLabel('打开设置').click();
        await expect(page.getByText('保存设置')).toBeVisible();
        await page.getByLabel('称呼').fill('测试同学');
        await page.getByRole('button', { name: '保存设置' }).click();
        await expect(page.getByRole('status')).toHaveText('已保存');

        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByText(/，测试同学。$/)).toBeVisible();
      });

      await test.step('writes reminders, memory and review to the vault', async () => {
        const reminders = await import('node:fs/promises').then((fs) =>
          fs.readFile(`${environment.vault}/reminders.md`, 'utf8')
        );
        expect(reminders).toContain('喝水');
      });

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });
});