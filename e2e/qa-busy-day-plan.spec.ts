import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { serializeWeekAvailabilityFile } from '../src/main/availability/records';
import { parseTaskFile } from '../src/main/workspace/records/tasks';
import {
  createIsolatedEnvironment,
  launchStudyCoach,
  type IsolatedEnvironment,
  type LaunchedStudyCoach
} from './support/launch';

/**
 * 满日覆盖（iter27 / busy-day override）的用户可见断言，走 butler 工具路径：
 *
 * 用户在阿咲对话里说「帮我排计划」→ 模型（fake CLI）调用 `plan_workspace`
 * 工具 → 真实 butler 服务执行工具、真实 planner 出计划、任务写进真实 vault。
 * 断言钉在用户能看见的东西上：对话里的「生成计划」工具行及其
 * 「每天可用 N 分钟 · 来源」明细，以及写入项目今日任务的那一份任务。
 *
 *   - 满日（week-availability.md 标了今天）：恰好 1 件任务、≤10 分钟，
 *     工具行明细是「每天可用 10 分钟 · 来自你说的一周安排」；
 *   - 平常日（记录里只标了明天）：不注入满日覆盖，工具行明细是
 *     「每天可用 120 分钟 · 默认值」，任务保持 30 分钟不被压缩；
 *   - 调用方钉死 availableMinutes: 45：工具行明细是
 *     「每天可用 45 分钟 · 本次指定」（可用性读取为零由
 *     qa-busy-day-tool.spec.ts 用计数桩钉住）。
 *
 * 一周安排按运行当天的本地日历播种（与 iter30 同一做法），断言在任何
 * 机器、任何运行日期都成立。
 */

/** Local YYYY-MM-DD, the same calendar the app formats with. */
function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

/** The Monday starting `date`'s local week. */
function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

async function launchWithBusyDay(reference: Date): Promise<{
  launched: LaunchedStudyCoach;
  environment: IsolatedEnvironment;
}> {
  const environment = await createIsolatedEnvironment();
  await writeFileAt(
    join(environment.vault, 'week-availability.md'),
    serializeWeekAvailabilityFile([
      {
        id: 'wa-qa-busy-day',
        weekStart: localDate(mondayOf(reference)),
        busyDates: [localDate(reference)],
        createdAt: '2026-11-20T20:30:00.000Z'
      }
    ])
  );
  const launched = await launchStudyCoach(environment);
  return { launched, environment };
}

async function writeFileAt(file: string, body: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body, 'utf8');
}

/**
 * Creates the 考研 project through the conversation (so the conversation is
 * linked to it), then sends the plan request in the same conversation.
 */
async function createProjectThenAskToPlan(page: LaunchedStudyCoach['page'], request: string): Promise<void> {
  await page.getByLabel('向阿咲提问').fill('我想考研');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText(/已创建项目「考研」/).last()).toBeVisible({
    timeout: 30_000
  });

  await page.getByLabel('向阿咲提问').fill(request);
  await page.getByRole('button', { name: '发送' }).click();
}

/** Every task the plan wrote into any workspace's file for `date`. */
async function tasksWrittenForDate(
  vault: string,
  date: string
): Promise<Array<{ title: string; durationMin: number }>> {
  const workspaceDirs = await readdir(join(vault, 'workspaces')).catch(() => [] as string[]);
  const tasks: Array<{ title: string; durationMin: number }> = [];
  for (const dir of workspaceDirs) {
    const raw = await readFile(
      join(vault, 'workspaces', dir, 'tasks', `${date}.md`),
      'utf8'
    ).catch(() => null);
    if (raw === null) continue;
    for (const task of parseTaskFile(raw)) {
      tasks.push({ title: task.title, durationMin: task.durationMin });
    }
  }
  return tasks;
}

test.describe('busy-day override through the plan_workspace tool path', () => {
  test('满日只排一件 ≤10 分钟的小任务，来源是一周安排', async () => {
    const today = localDate(new Date());
    const { launched, environment } = await launchWithBusyDay(new Date());
    const { page } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await createProjectThenAskToPlan(page, '帮我排一下今天的计划');

      // The 生成计划 tool row the user sees: budget 10, source 一周安排.
      await expect(
        page.getByRole('button', {
          name: '生成计划：每天可用 10 分钟 · 来自你说的一周安排'
        })
      ).toBeVisible({ timeout: 30_000 });

      // Exactly one task reached the vault for today, and it is small.
      const tasks = await tasksWrittenForDate(environment.vault, today);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.durationMin).toBeGreaterThan(0);
      expect(tasks[0]?.durationMin).toBeLessThanOrEqual(10);

      // The same task is visible on the today page.
      await page.getByRole('button', { name: '今日安排' }).click();
      await expect(page.getByText('满日小事：整理一张错题卡').first()).toBeVisible();

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('平常日保持默认预算，任务不被压成 10 分钟', async () => {
    const today = localDate(new Date());
    // Only tomorrow is marked busy, so today plans normally with the record
    // present — proving the override is per-day, not per-file.
    const { launched, environment } = await launchWithBusyDay(shiftDays(new Date(), 1));
    const { page } = launched;

    try {
      await createProjectThenAskToPlan(page, '帮我排一下今天的计划');

      await expect(
        page.getByRole('button', {
          name: '生成计划：每天可用 120 分钟 · 默认值'
        })
      ).toBeVisible({ timeout: 30_000 });

      const tasks = await tasksWrittenForDate(environment.vault, today);
      expect(tasks).toHaveLength(1);
      // The fake model's normal-day task is 30 minutes: no busy-day clamp.
      expect(tasks[0]?.durationMin).toBe(30);
    } finally {
      await launched.close();
    }
  });

  test('钉死 45 分钟时来源是本次指定，不是一周安排', async () => {
    const today = localDate(new Date());
    // Today is marked busy, yet the caller's own budget must win.
    const { launched, environment } = await launchWithBusyDay(new Date());
    const { page } = launched;

    try {
      await createProjectThenAskToPlan(page, '只给我排 45 分钟');

      await expect(
        page.getByRole('button', {
          name: '生成计划：每天可用 45 分钟 · 本次指定'
        })
      ).toBeVisible({ timeout: 30_000 });

      // Exactly one planned task landed; the zero-read guarantee for this
      // pinned call is pinned in qa-busy-day-tool.spec.ts.
      const tasks = await tasksWrittenForDate(environment.vault, today);
      expect(tasks).toHaveLength(1);
    } finally {
      await launched.close();
    }
  });
});
