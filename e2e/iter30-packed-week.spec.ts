import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_DISPLAY_NAME } from '../src/main/settings/defaults';
import { serializeWeekAvailabilityFile, type WeekAvailability } from '../src/main/availability/records';
import {
  createIsolatedEnvironment,
  launchStudyCoach,
  type IsolatedEnvironment,
  type LaunchedStudyCoach
} from './support/launch';

/**
 * iter30 · 下周哪天满 e2e（基线 master c73e721，分支 xiaolai/iter30-e2e-accountability）
 *
 * 功能链路：周复盘问「下周哪几天会特别满？」→ 记进 vault 的
 * week-availability.md → 之后给那天排计划时只排一件 10 分钟的小事。
 *
 * 在 c73e721 上「只排一件小事」这步**没有任何用户可见的入口**：
 * 唯一应用周可用时间覆盖的调用是 `api.planWorkspace`（src/main/context.ts），
 * 而 UI 没有按钮调它；对话里的 plan_workspace 工具直接调 services.planner，
 * 会绕过覆盖（这是缺陷，缺陷记录见交付报告）。
 *
 * 所以这条 e2e 在真实 app + 真实 IPC 上断言计划层的用户可见事实
 * （来源标记 week、总可用 10 分钟、只排一件），等 UI 落地后即可换成
 * 界面断言；对照组证明「用户自己说 60 分钟」时来源是 input 而不是 week。
 */

const GREETING = new RegExp(`^(早上好|中午好|下午好|晚上好|夜深了)，${DEFAULT_DISPLAY_NAME}。$`);
const WORKSPACE_ID = 'qa-packed-week';

/** Local calendar date `YYYY-MM-DD`, offset by whole days from today. */
function localDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 本周一（week-availability 的 weekStart 必须是周一）。 */
function mondayOfThisWeek(): string {
  const offset = (new Date().getDay() + 6) % 7;
  return localDate(-offset);
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
name: 特别满演练
kind: study
color: '#34c759'
goal: 验证特别满的那天只排一件小事
description: 由 e2e/iter30-packed-week.spec.ts 写入的隔离数据
checkIn: daily
createdAt: '2026-01-01T00:00'
updatedAt: '2026-01-01T00:00'
---

# 特别满演练

- 类型：学习
- 目标：验证特别满的那天只排一件小事
`;
}

type PlanSummary = {
  availableMinutes: number;
  availableMinutesSource: string;
  tasks: Array<{ title: string; durationMin: number }>;
};

async function planViaApp(page: Page, input: { availableMinutes?: number }): Promise<PlanSummary> {
  return page.evaluate(async (args) => {
    const api = (
      window as unknown as {
        studyCoach: {
          listWorkspaces: () => Promise<Array<{ id: string; name: string }>>;
          planWorkspace: (input: unknown) => Promise<{
            availableMinutes: number;
            availableMinutesSource: string;
            tasks: Array<{ title: string; durationMin: number }>;
          }>;
        };
      }
    ).studyCoach;
    const workspaces = await api.listWorkspaces();
    const workspace = workspaces.find((entry) => entry.name === '特别满演练');
    if (!workspace) throw new Error('workspace 特别满演练 not found');
    const plan = await api.planWorkspace({ workspaceId: workspace.id, ...args });    return {
      availableMinutes: plan.availableMinutes,
      availableMinutesSource: plan.availableMinutesSource,
      tasks: plan.tasks.map((task) => ({ title: task.title, durationMin: task.durationMin }))
    };
  }, input);
}

test.describe('下周哪天满', () => {
  test('用户说满的那天：计划来源是 week、只给 10 分钟；自己报的时间仍以 input 为准', async () => {
    const environment: IsolatedEnvironment = await createIsolatedEnvironment();
    const busyRecord: WeekAvailability = {
      id: 'wa-e2e',
      weekStart: mondayOfThisWeek(),
      busyDates: [localDate(0)],
      createdAt: '2026-01-01T00:00:00.000Z'
    };
    await writeVaultFile(
      environment.vault,
      `workspaces/${WORKSPACE_ID}/workspace.md`,
      workspaceBody()
    );
    await writeVaultFile(
      environment.vault,
      'week-availability.md',
      serializeWeekAvailabilityFile([busyRecord])
    );

    const launched: LaunchedStudyCoach = await launchStudyCoach(environment);
    const { page } = launched;
    try {
      await expect(page.getByText(GREETING)).toBeVisible();

      // 用户说「今天特别满」→ 规划走 week 覆盖：10 分钟、一件小事。
      const busy = await planViaApp(page, {});
      expect(busy.availableMinutesSource).toBe('week');
      expect(busy.availableMinutes).toBe(10);
      expect(busy.tasks).toHaveLength(1);

      // 对照：用户自己在对话里报了可用时间 → 以 input 为准，覆盖不生效。
      const pinned = await planViaApp(page, { availableMinutes: 60 });
      expect(pinned.availableMinutesSource).toBe('input');
      expect(pinned.availableMinutes).toBe(60);
    } finally {
      await launched.close();
    }
  });
});