import { expect, test } from '@playwright/test';
import { launchStudyCoach, type LaunchedStudyCoach } from './support/launch';

/**
 * Kept from the 2026-11-21 runtime QA sweep (docs/superpowers/reports/2026-11-21-runtime-qa.md).
 *
 * Guards two layout defects seen at the app's default 900x680 window, where the
 * reminder row is its widest at the narrowest supported layout:
 *   D1 — the reminder's text ("喝水") collapses to 0px width: the row shows
 *        only the time, the state chip and the action buttons, and overflows
 *        horizontally because the buttons cannot fit.
 *   D5 — with no reminders, "让阿咲设提醒" is rendered twice, and it is still
 *        rendered when reminders do exist.
 */
test.describe('reminder row layout (runtime QA guard)', () => {
  test('keeps the reminder text readable at the default window size', async () => {
    const launched: LaunchedStudyCoach = await launchStudyCoach();
    const { page } = launched;

    try {
      await page.getByRole('button', { name: '新对话' }).click();
      await page.getByLabel('向阿咲提问').fill('我想考研');
      await page.getByRole('button', { name: '发送' }).click();
      await expect(page.getByText(/已创建项目「考研」/).last()).toBeVisible({ timeout: 60_000 });

      await page.locator('nav[aria-label="主导航"]').getByRole('button', { name: '提醒' }).click();
      await page.getByLabel('提醒时间').fill('09:30');
      await page.getByLabel('提醒内容').fill('喝水');
      await page.getByRole('button', { name: '添加提醒' }).click();

      const label = page.locator('span').filter({ hasText: /^喝水/ }).first();
      await expect(label).toBeVisible({ timeout: 15_000 });
      const width = await label.evaluate((node) => node.getBoundingClientRect().width);
      expect(width, 'the reminder text must keep a readable width').toBeGreaterThan(24);

      // The row must wrap its actions rather than overflow horizontally.
      const row = label.locator('xpath=..');
      const geometry = await row.evaluate((node) => ({
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth
      }));
      expect(
        geometry.scrollWidth,
        'the reminder row must not overflow horizontally'
      ).toBeLessThanOrEqual(geometry.clientWidth + 1);

      // With one reminder on screen, the list-level CTA must not also show.
      await expect(page.getByRole('button', { name: '让阿咲设提醒' })).toHaveCount(0);
    } finally {
      await launched.close();
    }
  });
});