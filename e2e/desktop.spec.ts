import { expect, test } from '@playwright/test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchStudyCoach, type LaunchedStudyCoach } from './support/launch';

test.describe('ASAKI desktop', () => {
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
        await page.getByRole('button', { name: '打开项目：考研' }).click();
        await expect(page.getByRole('heading', { name: '考研', exact: true })).toBeVisible();
        await expect(page.getByText('2027 考研上岸')).toBeVisible();
      });

      await test.step('persists the conversation and project across reload', async () => {
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByText('早上好，xiaolai。')).toBeVisible();

        await page.getByRole('button', { name: '考研', exact: true }).click();
        await page.getByRole('button', { name: /我想考研/ }).click();
        await expect(page.getByText(/已创建项目「考研」/).last()).toBeVisible({
          timeout: 30_000
        });
        await page.getByRole('button', { name: '打开项目：考研' }).click();
        await expect(page.getByRole('heading', { name: '考研', exact: true })).toBeVisible();
        await expect(page.getByText('2027 考研上岸')).toBeVisible();
      });

      await test.step('creates a long-term plan and schedules today’s row', async () => {
        await page.getByRole('button', { name: '长期计划' }).click();
        await expect(page.getByText('还没有长期计划。')).toBeVisible();
        await page.getByRole('button', { name: '新建长期计划' }).click();
        await page.getByLabel('目标').fill('系统学习 AI Agent，能独立做项目');
        await page.getByLabel('总周数').fill('2');
        await page.getByRole('button', { name: '生成计划' }).click({ timeout: 60_000 });

        const detail = page.getByRole('region', { name: '计划详情' });
        await expect(
          detail.getByRole('heading', { name: '系统学习 AI Agent，能独立做项目' })
        ).toBeVisible({ timeout: 60_000 });
        await expect(detail.getByText(/通用框架/)).toBeVisible();

        await detail.getByRole('button', { name: '重排剩余安排' }).click();
        await expect(page.getByText(/会保留已经勾选进度的周/)).toBeVisible();
        await page.getByRole('button', { name: '取消' }).click();

        await detail.getByRole('button', { name: '加入今日安排' }).click();
        await expect(detail.getByText('已加入今日安排')).toBeVisible();

        await page.getByRole('button', { name: '今日安排' }).click();
        await expect(page.getByText('今天的时间表')).toBeVisible();
        await expect(page.getByText('明确本周目标，列出 3 个要解决的问题')).toBeVisible();

        const plans = await readdir(join(environment.vault, 'workspaces'));
        const planFiles = await Promise.all(
          plans.map((id) => readdir(join(environment.vault, 'workspaces', id, 'plans')).catch(() => []))
        );
        expect(planFiles.flat().some((name) => name.endsWith('.md'))).toBe(true);
      });

      await test.step('adds a knowledge topic, writes a note and persists both', async () => {
        await page.getByRole('button', { name: '知识库' }).click();
        await expect(page.getByText('还没有知识主题。', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: '新增主题' }).click();
        await page.getByLabel('主题名称').fill('LangChain');
        await page.getByRole('button', { name: '保存' }).click();
        await expect(
          page.getByRole('button', { name: 'LangChain', exact: true })
        ).toBeVisible();
        await expect(
          page.locator('[aria-label="知识内容"]').getByText('在学', { exact: true })
        ).toBeVisible();

        const files = await readdir(join(environment.vault, 'knowledge', 'topics')).catch(
          () => [] as string[]
        );
        expect(files.some((name) => name.endsWith('.md'))).toBe(true);

        const editor = page.getByLabel('知识笔记');
        await expect(editor).toBeVisible();
        await editor.fill('会搭 AgentExecutor');
        await editor.blur();
        await expect(page.getByText('已保存')).toBeVisible();

        const notesDir = join(environment.vault, 'knowledge', 'notes');
        const noteFiles = await readdir(notesDir).catch(() => [] as string[]);
        const notes = await Promise.all(
          noteFiles.map((name) => readFile(join(notesDir, name), 'utf8'))
        );
        expect(notes.some((text) => text.includes('会搭 AgentExecutor'))).toBe(true);
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
