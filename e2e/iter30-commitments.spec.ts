import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  createIsolatedEnvironment,
  launchStudyCoach,
  type IsolatedEnvironment,
  type LaunchedStudyCoach
} from './support/launch';

/**
 * iter30 (P0/P1) end to end, against the real vault:
 *
 *   - the 承诺 section lists open promises and 改期 rewrites `commitments.md`
 *     for exactly that entry (status stays open, no resolvedAt);
 *   - 放下 drops it out of the default list and writes `status: dropped` with
 *     a `resolvedAt`, visible again under 显示已结束;
 *   - a recorded week shows 「你说过这周特别满：周二、周四」 on 长期计划 and
 *     clearing it removes only that week's record from `week-availability.md`.
 *
 * Seeding is the app's own on-disk layout (src/main/workspace/paths.ts):
 *   commitments.md, week-availability.md at the vault root.
 *
 * Today is read from the running app's clock so the assertions stay correct on
 * any machine and on any run date.
 */

async function writeVaultFile(vault: string, relative: string, body: string): Promise<void> {
  const file = join(vault, relative);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body, 'utf8');
}

/** Local YYYY-MM-DD `days` from today, so seeded due dates never rot. */
function dueFromToday(days: number): string {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** A commitments.md the app itself could have written. */
function commitmentsBody(
  entries: Array<{ id: string; text: string; due: string; status?: string; resolvedAt?: string }>
): string {
  const items = entries
    .map((entry) =>
      [
        `  - id: ${entry.id}`,
        `    text: ${entry.text}`,
        `    due: '${entry.due}'`,
        `    status: ${entry.status ?? 'open'}`,
        `    createdAt: '2026-11-20T08:00:00.000Z'`,
        ...(entry.resolvedAt ? [`    resolvedAt: '${entry.resolvedAt}'`] : [])
      ].join('\n')
    )
    .join('\n');
  return [
    '---',
    'type: log',
    'source: user',
    'kind: commitments',
    'items:',
    items,
    '---',
    '# 承诺',
    '',
    ''
  ].join('\n');
}

async function launchWith(files: Record<string, string>): Promise<{
  launched: LaunchedStudyCoach;
  environment: IsolatedEnvironment;
}> {
  const environment = await createIsolatedEnvironment();
  for (const [relative, body] of Object.entries(files)) {
    await writeVaultFile(environment.vault, relative, body);
  }
  const launched = await launchStudyCoach(environment);
  return { launched, environment };
}

test.describe('visible commitments (iter30 P0)', () => {
  test('lists open promises, resurfaces an overdue one, and reschedules it on disk', async () => {
    const overdueDue = dueFromToday(-7);
    const openDue = dueFromToday(5);
    const { launched, environment } = await launchWith({
      'commitments.md': commitmentsBody([
        { id: 'cm-overdue', text: '整理错题本', due: overdueDue },
        { id: 'cm-open', text: '背完这一课的单词', due: openDue }
      ])
    });
    const { page } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await page.getByRole('button', { name: '提醒', exact: true }).click();

      // The section and its two promises are visible, overdue first.
      await expect(page.getByRole('heading', { name: '承诺' })).toBeVisible();
      await expect(page.getByText('你说过的、还开着的事。这里能改日期，也能放下。')).toBeVisible();
      await expect(page.getByText('整理错题本')).toBeVisible();
      await expect(page.getByText('背完这一课的单词')).toBeVisible();
      await expect(page.getByText(`原定 ${overdueDue.slice(5)} · 已过期 7 天`)).toBeVisible();
      await expect(page.getByText('这是你答应的事，不是任务。')).toBeVisible();

      // 改期: pick a concrete future date and save.
      const today = await page.evaluate(() => {
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, '0');
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      });
      const [year, month, day] = today.split('-').map(Number);
      const target = new Date(Date.UTC(year, month - 1, day + 10));
      const targetDate = target.toISOString().slice(0, 10);

      await page.getByRole('button', { name: '改期：整理错题本' }).click();
      await page.getByLabel('新日期：整理错题本').fill(targetDate);
      await page.getByRole('button', { name: '保存', exact: true }).click();

      // The row reflects the new day and is no longer tagged overdue.
      await expect(page.getByText(`原定 ${targetDate.slice(5)}`)).toBeVisible();
      await expect(page.getByText(/已过期/)).toHaveCount(0);

      // On disk only that entry moved: still open, no resolvedAt, others intact.
      const raw = await readFile(join(environment.vault, 'commitments.md'), 'utf8');
      expect(raw).toContain(`- [ ] 整理错题本（原定 ${targetDate}）`);
      expect(raw).toContain(`- [ ] 背完这一课的单词（原定 ${openDue}）`);
      expect(raw).not.toContain('resolvedAt');
      expect(raw).not.toMatch(/整理错题本[\s\S]*?resolvedAt/);

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('放下 removes the promise from the default list and records it as dropped', async () => {
    const droppedDue = dueFromToday(-6);
    const { launched, environment } = await launchWith({
      'commitments.md': commitmentsBody([
        { id: 'cm-drop', text: '报个冲刺班', due: droppedDue },
        { id: 'cm-keep', text: '完成极限基础', due: dueFromToday(6) }
      ])
    });
    const { page } = launched;

    try {
      await page.getByRole('button', { name: '提醒', exact: true }).click();
      await expect(page.getByText('报个冲刺班')).toBeVisible();

      await page.getByRole('button', { name: '放下：报个冲刺班' }).click();

      // The row leaves the default (open-only) list; the other stays.
      await expect(page.getByText('报个冲刺班')).toHaveCount(0);
      await expect(page.getByText('完成极限基础')).toBeVisible();

      const raw = await readFile(join(environment.vault, 'commitments.md'), 'utf8');
      expect(raw).toContain(`- [-] 报个冲刺班（原定 ${droppedDue}）`);
      expect(raw).toMatch(/status: dropped/);
      expect(raw).toMatch(/resolvedAt: '/);

      // 显示已结束 reveals it as read-only history.
      await page.getByRole('switch', { name: '显示已结束' }).click();
      await expect(page.getByText('报个冲刺班')).toBeVisible();
      await expect(page.getByText(/已放下 · \d+月\d+日/)).toBeVisible();
      await expect(page.getByRole('button', { name: '完成：报个冲刺班' })).toHaveCount(0);
    } finally {
      await launched.close();
    }
  });
});

test.describe('week availability (iter30 P1)', () => {
  /** Local YYYY-MM-DD, the same calendar the app formats with. */
  function localDate(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function shift(base: Date, days: number): string {
    return localDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days));
  }

  test('shows this week\'s packed days and clears only that week on disk', async () => {
    // Seed relative to today so the panel has something to show on any run
    // date: the Monday of this week plus that week's Tue/Thu, and a second
    // week so the clear can be shown to touch exactly one entry.
    const now = new Date();
    const mondayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    mondayDate.setDate(mondayDate.getDate() - ((mondayDate.getDay() + 6) % 7));
    const monday = localDate(mondayDate);
    const tuesday = shift(mondayDate, 1);
    const thursday = shift(mondayDate, 3);
    const nextMonday = shift(mondayDate, 7);
    const nextTuesday = shift(mondayDate, 8);

    const { launched, environment } = await launchWith({
      'week-availability.md': [
        '---',
        'type: log',
        'source: user',
        'kind: week-availability',
        'items:',
        '  - id: wa-current',
        `    weekStart: '${monday}'`,
        `    busyDates: ['${tuesday}', '${thursday}']`,
        "    createdAt: '2026-11-20T20:30:00.000Z'",
        '  - id: wa-next',
        `    weekStart: '${nextMonday}'`,
        `    busyDates: ['${nextTuesday}']`,
        "    createdAt: '2026-11-20T20:31:00.000Z'",
        '---',
        '# 一周安排',
        '',
        ''
      ].join('\n')
    });
    const { page } = launched;

    try {
      await page
        .getByRole('navigation', { name: '主导航' })
        .getByRole('button', { name: '长期计划', exact: true })
        .click();

      // One factual line with weekday words, from the stored dates.
      await expect(
        page.getByText('你说过这周特别满：周二、周四（来自周复盘）')
      ).toBeVisible();

      await page.getByRole('button', { name: `清除一周安排：${monday}` }).click();
      await expect(page.getByText(/你说过这周特别满/)).toHaveCount(0);
      await expect(
        page.getByText('已清除。之后排计划会恢复按项目设置的可用时间。')
      ).toBeVisible();

      // Only this week left the file; next week's record is intact.
      const raw = await readFile(join(environment.vault, 'week-availability.md'), 'utf8');
      expect(raw).not.toContain('wa-current');
      expect(raw).not.toContain(`weekStart: '${monday}'`);
      expect(raw).toContain('wa-next');
      expect(raw).toContain(`weekStart: '${nextMonday}'`);
    } finally {
      await launched.close();
    }
  });
});
