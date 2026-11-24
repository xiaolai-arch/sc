import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { serializeWeekAvailabilityFile } from '../src/main/availability/records';
import { parseTaskFile } from '../src/main/workspace/records/tasks';
import { parseWorkspaceFile } from '../src/main/workspace/records/workspace';
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
 *
 * 同步点都绑在真实状态上，不等固定时长：
 *   - 建项目：轮询 vault 里真的出现了「考研」项目的 workspace.md（工具写盘
 *     成功），再看模型确认文本；模型文案本身不能证明工具成功。
 *   - 两轮之间：等「停止生成」按钮消失，说明上一轮 run 已结束、composer
 *     会接受下一条（不是靠碰运气的点击）。
 *   - 发计划请求后：等「停止生成」按钮出现，说明发送真的被接受并开了 run；
 *     被拒/丢失的发送会得到明确的失败，而不是 30 秒后一句对不上的超时。
 *   - 任务断言：按「这次计划写入的那一天」读盘，并与测试播种的今天比对，
 *     日期在两个地方各自取一次时钟、跨午夜时会明确失败而不是静默错位。
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

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * Absent means "not written yet" and is safe to poll past. Any other failure
 * (Windows answers EPERM/EBUSY while a just-written file is still being
 * scanned) is rethrown so the polling wrapper retries it and a persistent
 * problem fails with the real error instead of reading as "no tasks".
 */
async function readdirOrMissing(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

async function readFileOrMissing(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/** Workspace directories in the vault, skipping bookkeeping dirs like .trash. */
async function workspaceDirs(vault: string): Promise<string[]> {
  const dirs = await readdirOrMissing(join(vault, 'workspaces'));
  return dirs.filter((dir) => !dir.startsWith('.'));
}

async function readWorkspaceName(vault: string, dir: string): Promise<string | null> {
  const raw = await readFileOrMissing(join(vault, 'workspaces', dir, 'workspace.md'));
  if (raw === null) return null;
  return parseWorkspaceFile(raw, dir)?.name ?? null;
}

/** True once the create_workspace tool has really written the project to disk. */
async function workspaceNamed(vault: string, name: string): Promise<boolean> {
  for (const dir of await workspaceDirs(vault)) {
    if ((await readWorkspaceName(vault, dir)) === name) return true;
  }
  return false;
}

type PlannedDay = {
  date: string;
  tasks: Array<{ title: string; durationMin: number }>;
};

/**
 * Every day the plan wrote into the workspace named `name`, read from the task
 * files themselves. A fresh vault has no task files here until the plan runs.
 */
async function plannedDays(vault: string, workspaceName: string): Promise<PlannedDay[]> {
  const days: PlannedDay[] = [];
  for (const dir of await workspaceDirs(vault)) {
    if ((await readWorkspaceName(vault, dir)) !== workspaceName) continue;
    const files = await readdirOrMissing(join(vault, 'workspaces', dir, 'tasks'));
    for (const file of files) {
      const match = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(file);
      if (!match) continue;
      const raw = await readFileOrMissing(join(vault, 'workspaces', dir, 'tasks', file));
      if (raw === null) continue;
      days.push({
        date: match[1]!,
        tasks: parseTaskFile(raw).map((task) => ({
          title: task.title,
          durationMin: task.durationMin
        }))
      });
    }
  }
  return days.sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * Creates the 考研 project through the conversation (so the conversation is
 * linked to it), then sends the plan request in the same conversation.
 */
/**
 * Types one message and proves it went out: the composer is a controlled
 * input that unmounts/remounts while a turn settles, so a draft typed exactly
 * across that commit can be dropped and leave 发送 disabled forever. Retry the
 * *typing* until the draft sticks and the send is enabled, then wait for the
 * run itself (the stop button) before returning. This is a state wait, not a
 * test retry: nothing downstream is retried or weakened.
 */
async function sendMessage(page: LaunchedStudyCoach['page'], text: string): Promise<void> {
  const draft = page.getByLabel('向阿咲提问');
  const send = page.getByRole('button', { name: '发送' });
  await expect(async () => {
    await draft.fill(text);
    await expect(draft).toHaveValue(text);
    await expect(send).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await send.click();
  await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible({
    timeout: 30_000
  });
}

async function createProjectThenAskToPlan(
  page: LaunchedStudyCoach['page'],
  vault: string,
  request: string
): Promise<void> {
  await sendMessage(page, '我想考研');

  // The tool writes the project before the model's confirmation text exists:
  // poll the vault so a tool failure that the model still narrates as success
  // fails here, at its real cause. `toPass` also retries transient read errors
  // from a file that was just written.
  await expect(async () => {
    expect(await workspaceNamed(vault, '考研')).toBe(true);
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText(/已创建项目「考研」/).last()).toBeVisible({
    timeout: 30_000
  });

  // Wait for the first run to finish (the stop button is the visible state of
  // an active run) before typing the next message.
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0, {
    timeout: 30_000
  });

  // The plan request only goes out once the previous run has settled; typing
  // while it settles is the window where the draft could be dropped.
  await sendMessage(page, request);
}

/**
 * The single day the plan wrote. Polls the vault instead of reading once: the
 * tool row means the write returned, but a just-renamed file can still be
 * briefly unreadable on Windows, and a one-shot read that swallowed that error
 * used to look exactly like "the plan wrote nothing".
 */
async function plannedDayOfPlan(
  vault: string,
  today: string
): Promise<PlannedDay> {
  let planned: PlannedDay | undefined;
  await expect(async () => {
    const days = await plannedDays(vault, '考研');
    expect(days).toHaveLength(1);
    const [day] = days;
    // The e2e path omits `date`, so the app resolves today itself. Compare the
    // app's day to the one the test seeded for: a disagreement means the plan
    // ran across midnight, which must fail loudly, not as a wrong-file read.
    expect(day?.date).toBe(today);
    planned = day;
  }).toPass({ timeout: 10_000 });
  if (!planned) throw new Error('计划工具行已出现，但项目里没有任何任务文件。');
  return planned;
}

test.describe('busy-day override through the plan_workspace tool path', () => {
  test('满日只排一件 ≤10 分钟的小任务，来源是一周安排', async () => {
    const today = new Date();
    const { launched, environment } = await launchWithBusyDay(today);
    const { page } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await createProjectThenAskToPlan(page, environment.vault, '帮我排一下今天的计划');

      // The 生成计划 tool row the user sees: budget 10, source 一周安排.
      await expect(
        page.getByRole('button', {
          name: '生成计划：每天可用 10 分钟 · 来自你说的一周安排'
        })
      ).toBeVisible({ timeout: 30_000 });

      // Exactly one task reached the vault for today, and it is small.
      const day = await plannedDayOfPlan(environment.vault, localDate(today));
      expect(day.tasks).toHaveLength(1);
      expect(day.tasks[0]?.durationMin).toBeGreaterThan(0);
      expect(day.tasks[0]?.durationMin).toBeLessThanOrEqual(10);

      // The same task is visible on the today page.
      await page.getByRole('button', { name: '今日安排' }).click();
      await expect(page.getByText('满日小事：整理一张错题卡').first()).toBeVisible();

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('平常日保持默认预算，任务不被压成 10 分钟', async () => {
    const today = new Date();
    // Only tomorrow is marked busy, so today plans normally with the record
    // present — proving the override is per-day, not per-file.
    const { launched, environment } = await launchWithBusyDay(shiftDays(today, 1));
    const { page } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await createProjectThenAskToPlan(page, environment.vault, '帮我排一下今天的计划');

      await expect(
        page.getByRole('button', {
          name: '生成计划：每天可用 120 分钟 · 默认值'
        })
      ).toBeVisible({ timeout: 30_000 });

      const day = await plannedDayOfPlan(environment.vault, localDate(today));
      expect(day.tasks).toHaveLength(1);
      // The fake model's normal-day task is 30 minutes: no busy-day clamp.
      expect(day.tasks[0]?.durationMin).toBe(30);

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('钉死 45 分钟时来源是本次指定，不是一周安排', async () => {
    const today = new Date();
    // Today is marked busy, yet the caller's own budget must win.
    const { launched, environment } = await launchWithBusyDay(today);
    const { page } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await createProjectThenAskToPlan(page, environment.vault, '只给我排 45 分钟');

      await expect(
        page.getByRole('button', {
          name: '生成计划：每天可用 45 分钟 · 本次指定'
        })
      ).toBeVisible({ timeout: 30_000 });

      // Exactly one planned task landed; the zero-read guarantee for this
      // pinned call is pinned in qa-busy-day-tool.spec.ts.
      const day = await plannedDayOfPlan(environment.vault, localDate(today));
      expect(day.tasks).toHaveLength(1);

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });
});
