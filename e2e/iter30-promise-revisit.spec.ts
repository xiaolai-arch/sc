import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { DEFAULT_DISPLAY_NAME } from '../src/main/settings/defaults';
import {
  serializeCommitmentsFile,
  type Commitment
} from '../src/main/commitments/records';
import {
  createIsolatedEnvironment,
  launchStudyCoach,
  type IsolatedEnvironment,
  type LaunchedStudyCoach
} from './support/launch';

/**
 * iter30 · 承诺回访 e2e（基线 master c73e721，分支 xiaolai/iter30-e2e-accountability）
 *
 * 之前「承诺回访」只有单测（proactive-check-in / commitments）。这条用例在
 * 真机上走完整链路：
 *
 *   种子 vault（项目 checkIn: daily + 昨天到期的一条承诺）
 *   + state.json 把晨检时间拨到 00:00、关掉 DND 窗口（start==end）和
 *     周复盘/落后提醒，只留晨检这一路
 *   → 应用启动，真实 Scheduler 立即 tick
 *   → 创建「今天的检查 · MM-DD」对话并追问那条承诺
 *   → 侧边栏出现对话、点开后用户能看到那句追问文案。
 *
 * 断言全部是用户可见的事实：对话标题、追问原话。
 */

const GREETING = new RegExp(`^(早上好|中午好|下午好|晚上好|夜深了)，${DEFAULT_DISPLAY_NAME}。$`);
const WORKSPACE_ID = 'qa-revisit';
const PROMISE_TEXT = '背 20 个单词';

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
name: 承诺回访演练
kind: study
color: '#34c759'
goal: 验证晨检会回访昨天的承诺
description: 由 e2e/iter30-promise-revisit.spec.ts 写入的隔离数据
checkIn: daily
createdAt: '2026-01-01T00:00'
updatedAt: '2026-01-01T00:00'
---

# 承诺回访演练

- 类型：学习
- 目标：验证晨检会回访昨天的承诺
`;
}

function commitment(): Commitment {
  return {
    id: 'cm-revisit',
    text: PROMISE_TEXT,
    due: localDate(-1),
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z'
  };
}

/** 只留晨检一路：时间拨到 00:00，DND 窗口 start==end 即关闭。 */
async function enableMorningCheckIn(userData: string): Promise<void> {
  const file = join(userData, 'state.json');
  const state = JSON.parse(await readFile(file, 'utf8')) as {
    settings: Record<string, unknown>;
  };
  state.settings.notifications = {
    enabled: true,
    morning: '00:00',
    evening: '23:59',
    weekly: '23:59',
    weeklyEnabled: false,
    behindSchedule: '23:59',
    behindScheduleEnabled: false,
    dndStart: '00:00',
    dndEnd: '00:00'
  };
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8' });
}

test.describe('承诺回访', () => {
  test('昨天的承诺出现在今天晨检的追问里', async () => {
    const environment: IsolatedEnvironment = await createIsolatedEnvironment();
    const today = localDate(0);
    await writeVaultFile(
      environment.vault,
      `workspaces/${WORKSPACE_ID}/workspace.md`,
      workspaceBody()
    );
    await writeVaultFile(
      environment.vault,
      'commitments.md',
      serializeCommitmentsFile([commitment()])
    );
    await enableMorningCheckIn(environment.userData);

    const launched: LaunchedStudyCoach = await launchStudyCoach(environment);
    const { page } = launched;
    try {
      await expect(page.getByText(GREETING)).toBeVisible();

      // 真实 Scheduler 启动即 tick：晨检对话落盘需要一次 fake CLI 调用。
      // 侧边栏的对话列表只在挂载时读取一次，所以等文件落盘后刷新一次页面。
      const conversationsDir = join(environment.userData, 'conversations');
      await expect
        .poll(
          async () => {
            try {
              return (await readdir(conversationsDir)).length;
            } catch {
              return 0;
            }
          },
          { timeout: 45_000, intervals: [1_000] }
        )
        .toBeGreaterThan(0);

      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      const checkIn = page
        .getByRole('button', { name: `今天的检查 · ${today.slice(5)}` })
        .first();
      await expect(checkIn).toBeVisible({ timeout: 15_000 });

      await checkIn.click();
      // 晨检对「昨天到期」的承诺用这句原话追问（src/main/check-ins/prompt.ts）。
      await expect(
        page.getByText(
          `昨天你说要做「${PROMISE_TEXT}」，做了吗？没做的话，挪到今天还是先放一放？`
        )
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await launched.close();
    }
  });
});