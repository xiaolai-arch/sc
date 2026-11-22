import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_DISPLAY_NAME } from '../src/main/settings/defaults';
import {
  createIsolatedEnvironment,
  launchStudyCoach,
  type IsolatedEnvironment,
  type LaunchedStudyCoach
} from './support/launch';

/**
 * iter30 · 问责功能 e2e（基线 master c73e721，分支 xiaolai/iter30-e2e-accountability）
 *
 * 覆盖「今日只做一件」与「我卡住了」两项功能在真机 UI 上的行为：
 *
 * 1. 今日只做一件：今日页打开开关 → 每行出现「只做这件」；选中第二件后
 *    折叠成 1 行 + 「还有 2 件（展开）」；展开/收起可用；刷新页面选择保留；
 *    勾掉选中的那件后文案变成「做完了。要不要再选一件？」，其余任务继续
 *    折叠，且任务在 vault 里真的变成 done。
 * 2. 我卡住了：任务行的「我卡住了」按钮把「我卡住了：「任务」」作为用户
 *    消息发进日常对话（走真实 fake CLI 链路），并收到回复。
 *
 * 种子只写 app 自己的 vault 版式：workspaces/<id>/workspace.md 与
 * workspaces/<id>/tasks/<今天>.md，三件 pending 任务，无 startAt。
 */

const GREETING = new RegExp(`^(早上好|中午好|下午好|晚上好|夜深了)，${DEFAULT_DISPLAY_NAME}。$`);
const WORKSPACE_ID = 'qa-one-thing';
const TASKS = ['任务甲：整理错题', '任务乙：背 20 个单词', '任务丙：精读一篇'];

/** Local calendar date `YYYY-MM-DD`, offset by whole days from today. */
function localDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

async function writeVaultFile(vault: string, relative: string, body: string): Promise<void> {
  const file = join(vault, relative);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body, 'utf8');
}

function workspaceBody(): string {
  return `---
type: profile
source: user
id: ${WORKSPACE_ID}
name: 只做一件演练
kind: study
color: '#34c759'
goal: 验证今日只做一件与我卡住了
description: 由 e2e/iter30-today-focus.spec.ts 写入的隔离数据
checkIn: daily
createdAt: '2026-01-01T00:00'
updatedAt: '2026-01-01T00:00'
---

# 只做一件演练

- 类型：学习
- 目标：验证今日只做一件与我卡住了
`;
}

/** 三件 pending 任务，顺序即页面顺序（都无 startAt、无 due）。 */
function tasksBody(): string {
  const today = localDate(0);
  const items = TASKS.map(
    (title, index) => `  - id: task-${index + 1}
    title: ${title}
    subject: 数学
    durationMin: ${30 + index * 10}
    materialRefs: []
    acceptance: 完成「${title}」
    status: pending
    due: '${today}'
    created: '2026-01-01T00:00'
    updated: '2026-01-01T00:00'`
  ).join('\n');
  return `---
type: plan
source: user
date: '${today}'
tasks:
${items}
---

# ${today}

${TASKS.map((title) => `- [ ] ${title}`).join('\n')}
`;
}

async function launchWithSeeds(): Promise<{
  launched: LaunchedStudyCoach;
  environment: IsolatedEnvironment;
}> {
  const environment = await createIsolatedEnvironment();
  await writeVaultFile(environment.vault, `workspaces/${WORKSPACE_ID}/workspace.md`, workspaceBody());
  await writeVaultFile(
    environment.vault,
    `workspaces/${WORKSPACE_ID}/tasks/${localDate(0)}.md`,
    tasksBody()
  );
  const launched = await launchStudyCoach(environment);
  return { launched, environment };
}

async function openToday(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name: '今日', exact: true })
    .click();
  await expect(page.locator('header').getByText('今日', { exact: true })).toBeVisible();
}

test.describe('今日只做一件', () => {
  test('开关、折叠、展开、刷新保留、做完后的诚实文案', async () => {
    const { launched, environment } = await launchWithSeeds();
    const { page } = launched;
    try {
      await expect(page.getByText(GREETING)).toBeVisible();
      await openToday(page);

      await test.step('默认三件任务都在，没有折叠文案', async () => {
        for (const title of TASKS) {
          await expect(page.getByRole('checkbox', { name: `完成任务：${title}` })).toBeVisible();
        }
        await expect(page.getByText('今天只做这一件。做完再选下一件。')).toHaveCount(0);
      });

      await test.step('打开开关后每行出现「只做这件」', async () => {
        const toggle = page.getByRole('switch', { name: '今日只做一件' });
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        for (const title of TASKS) {
          await expect(page.getByRole('button', { name: `只做这件：${title}` })).toBeVisible();
        }
      });

      await test.step('选第二件 → 只剩它，其余折叠成「还有 2 件」', async () => {
        await page.getByRole('button', { name: `只做这件：${TASKS[1]}` }).click();
        await expect(page.getByText('今天只做这一件。做完再选下一件。')).toBeVisible();
        await expect(page.getByRole('checkbox', { name: `完成任务：${TASKS[1]}` })).toBeVisible();
        await expect(page.getByRole('checkbox', { name: `完成任务：${TASKS[0]}` })).toHaveCount(0);
        await expect(page.getByRole('checkbox', { name: `完成任务：${TASKS[2]}` })).toHaveCount(0);
        await expect(
          page.getByRole('button', { name: '还有 2 件（展开）', exact: true })
        ).toBeVisible();
      });

      await test.step('展开/收起可用', async () => {
        await page.getByRole('button', { name: '还有 2 件（展开）', exact: true }).click();
        for (const title of TASKS) {
          await expect(page.getByRole('checkbox', { name: `完成任务：${title}` })).toBeVisible();
        }
        await page.getByRole('button', { name: '收起', exact: true }).click();
        await expect(page.getByRole('checkbox', { name: `完成任务：${TASKS[0]}` })).toHaveCount(0);
      });

      await test.step('刷新后选择保留，仍是同一件', async () => {
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByText(GREETING)).toBeVisible();
        await openToday(page);
        await expect(page.getByText('今天只做这一件。做完再选下一件。')).toBeVisible();
        await expect(page.getByRole('checkbox', { name: `完成任务：${TASKS[1]}` })).toBeVisible();
        await expect(
          page.getByRole('button', { name: '还有 2 件（展开）', exact: true })
        ).toBeVisible();
      });

      await test.step('做完选中的那件 → 「做完了。要不要再选一件？」，vault 里真的 done', async () => {
        await page.getByRole('checkbox', { name: `完成任务：${TASKS[1]}` }).click();
        await expect(page.getByText('做完了。要不要再选一件？')).toBeVisible();
        await expect(page.getByRole('checkbox', { name: `完成任务：${TASKS[0]}` })).toHaveCount(0);
        await expect(
          page.getByRole('button', { name: '还有 2 件（展开）', exact: true })
        ).toBeVisible();

        const raw = await readFile(
          join(environment.vault, `workspaces/${WORKSPACE_ID}/tasks/${localDate(0)}.md`),
          'utf8'
        );
        expect(raw).toContain(`- [x] ${TASKS[1]}`);
      });
    } finally {
      await launched.close();
    }
  });
});

test.describe('我卡住了', () => {
  test('点「我卡住了」把原话发进日常对话并得到回复', async () => {
    const { launched } = await launchWithSeeds();
    const { page } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    try {
      await expect(page.getByText(GREETING)).toBeVisible();
      await openToday(page);

      await page.getByRole('button', { name: `我卡住了：${TASKS[0]}` }).click();

      // 页面切到日常对话，用户消息是按钮文案的原话。
      await expect(page.getByText(`我卡住了：「${TASKS[0]}」`).first()).toBeVisible();
      // fake CLI 的固定回复（走真实的本地 CLI 链路）。
      await expect(page.getByText('假模型回复：还没有看到今天的任务。')).toBeVisible({
        timeout: 30_000
      });
      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });
});