import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_DISPLAY_NAME } from '../src/main/settings/defaults';
import { launchStudyCoach, type LaunchedStudyCoach } from './support/launch';

/**
 * iter30 · 问责功能 e2e（基线 master c73e721，分支 xiaolai/iter30-e2e-accountability）
 *
 * 覆盖两项此前只有单测、没有端到端证明的问责功能：
 *
 * 1. 静音（settings.notifications.snoozedUntil）：提醒页的「主动检查」卡片
 *    点「暂停 3 天」→ 文案变成「已静音至 M月D日」且日期=今天+3；重启后仍在；
 *    点「恢复提醒」回到三个按钮，state.json 里的 snoozedUntil 清空。
 * 2. 问责对象（settings.accountabilityName）：设置页填入、保存、重启仍在，
 *    且这个名字只进 state.json，从不写进 vault 任何文件（实现里承诺
 *    「never touches the records」，这里在真机目录上核实）。
 *
 * 全部走隔离环境（createIsolatedEnvironment：临时 userData + 临时 vault +
 * fake CLI），断言的都是用户能在界面上看到的文案与状态。
 */

const GREETING = new RegExp(`^(早上好|中午好|下午好|晚上好|夜深了)，${DEFAULT_DISPLAY_NAME}。$`);

/** Local calendar date `YYYY-MM-DD`, offset by whole days from today. */
function localDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** src/shared/date.ts formatMonthDay 的同款格式。 */
function monthDay(isoDate: string): string {
  const [, month, day] = isoDate.split('-').map(Number);
  return `${month}月${day}日`;
}

async function navTo(page: Page, name: string): Promise<void> {
  await page
    .getByRole('navigation', { name: '主导航' })
    .getByRole('button', { name, exact: true })
    .click();
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByText('个人、模型与数据')).toBeVisible();
}

test.describe('静音与问责对象', () => {
  test('提醒页静音 3 天：文案、日期、重启保持、恢复', async () => {
    const launched: LaunchedStudyCoach = await launchStudyCoach();
    const { page, environment } = launched;
    try {
      await expect(page.getByText(GREETING)).toBeVisible();

      await test.step('提醒页默认可静音', async () => {
        await navTo(page, '提醒');
        await expect(page.locator('header').getByText('提醒', { exact: true })).toBeVisible();
        await expect(page.getByText('主动检查', { exact: true })).toBeVisible();
        await expect(page.getByText('仅暂停主动检查，不影响你设的提醒。')).toBeVisible();
        for (const name of ['今天别再提醒我', '暂停 3 天', '暂停 7 天']) {
          await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
        }
      });

      const target = localDate(3);
      await test.step('点「暂停 3 天」→ 已静音至 今天+3', async () => {
        await page.getByRole('button', { name: '暂停 3 天', exact: true }).click();
        await expect(page.getByText(`已静音至 ${monthDay(target)}`, { exact: true })).toBeVisible();
        await expect(
          page.getByRole('button', { name: '今天别再提醒我', exact: true })
        ).toHaveCount(0);
      });

      await test.step('重启后仍然静音', async () => {
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByText(GREETING)).toBeVisible();
        await navTo(page, '提醒');
        await expect(page.getByText(`已静音至 ${monthDay(target)}`, { exact: true })).toBeVisible();
      });

      await test.step('state.json 记的是最后静音的那天', async () => {
        const state = JSON.parse(
          await readFile(join(environment.userData, 'state.json'), 'utf8')
        ) as { settings: { notifications: { snoozedUntil?: string } } };
        expect(state.settings.notifications.snoozedUntil).toBe(target);
      });

      await test.step('点「恢复提醒」回到默认三按钮，state 清空', async () => {
        await page.getByRole('button', { name: '恢复提醒', exact: true }).click();
        for (const name of ['今天别再提醒我', '暂停 3 天', '暂停 7 天']) {
          await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
        }
        await expect(page.getByText(/已静音至/)).toHaveCount(0);
        const state = JSON.parse(
          await readFile(join(environment.userData, 'state.json'), 'utf8')
        ) as { settings: { notifications: { snoozedUntil?: string } } };
        expect(state.settings.notifications.snoozedUntil).toBe('');
      });
    } finally {
      await launched.close();
    }
  });

  test('今天别再提醒我 → 今天已静音，明天恢复', async () => {
    const launched: LaunchedStudyCoach = await launchStudyCoach();
    const { page } = launched;
    try {
      await expect(page.getByText(GREETING)).toBeVisible();
      await navTo(page, '提醒');
      await page.getByRole('button', { name: '今天别再提醒我', exact: true }).click();
      await expect(page.getByText('今天已静音，明天恢复', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '恢复提醒', exact: true }).click();
      await expect(page.getByRole('button', { name: '暂停 7 天', exact: true })).toBeVisible();
    } finally {
      await launched.close();
    }
  });

  test('问责对象：保存进 state.json，重启仍在，且从不写进 vault', async () => {
    const name = '小林';
    const launched: LaunchedStudyCoach = await launchStudyCoach();
    const { page, environment } = launched;
    try {
      await expect(page.getByText(GREETING)).toBeVisible();

      await test.step('设置页填入并保存', async () => {
        await openSettings(page);
        const input = page.locator('#settings-accountability');
        await expect(input).toBeVisible();
        await expect(input).toHaveValue('');
        await input.fill(name);
        await page.getByRole('button', { name: '保存设置', exact: true }).click();
        await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
      });

      await test.step('重启后设置页仍然显示', async () => {
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByText(GREETING)).toBeVisible();
        await openSettings(page);
        await expect(page.locator('#settings-accountability')).toHaveValue(name);
      });

      await test.step('名字只进 state.json，不进 vault 任何文件', async () => {
        const state = JSON.parse(
          await readFile(join(environment.userData, 'state.json'), 'utf8')
        ) as { settings: { accountabilityName?: string } };
        expect(state.settings.accountabilityName).toBe(name);

        const files: string[] = [];
        const walk = async (dir: string): Promise<void> => {
          for (const entry of await readdir(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) await walk(full);
            else files.push(full);
          }
        };
        await walk(environment.vault);
        for (const file of files) {
          const raw = await readFile(file, 'utf8').catch(() => '');
          expect(raw.includes(name), `${file} 不应包含问责对象的名字`).toBe(false);
        }
      });
    } finally {
      await launched.close();
    }
  });

  test('问责对象清空：清掉后 state.json 也不再有名字', async () => {
    const name = '小林';
    const launched: LaunchedStudyCoach = await launchStudyCoach();
    const { page, environment } = launched;
    try {
      await expect(page.getByText(GREETING)).toBeVisible();
      await openSettings(page);
      await page.locator('#settings-accountability').fill(name);
      await page.getByRole('button', { name: '保存设置', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();

      await page.getByRole('button', { name: '清空', exact: true }).click();
      await expect(page.locator('#settings-accountability')).toHaveValue('');
      await page.getByRole('button', { name: '保存设置', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();

      const state = JSON.parse(
        await readFile(join(environment.userData, 'state.json'), 'utf8')
      ) as { settings: { accountabilityName?: string } };
      const stored = state.settings.accountabilityName;
      expect(stored === undefined || stored === '').toBe(true);
    } finally {
      await launched.close();
    }
  });
});
