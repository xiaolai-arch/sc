import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_DISPLAY_NAME } from '../src/main/settings/defaults';
import {
  createIsolatedEnvironment,
  launchStudyCoach,
  type LaunchedStudyCoach
} from './support/launch';

/**
 * End-to-end guard for the learning surfaces added in rounds four to seven:
 * the 复盘页 study heatmap + 8-week accuracy trend, the 错题本「导出复习单」
 * flow, and the project-target countdown on 今日 / 长期计划. These are layout-
 * and file-shaped features that the 2026-11-21 runtime QA sweep
 * (docs/superpowers/reports/2026-11-21-runtime-qa.md) showed unit tests cannot
 * see, so this spec drives the real Electron window.
 *
 * Safety: every launch goes through the isolated harness
 * (`createIsolatedEnvironment()`: temp userData + temp vault + fake CLI). The
 * app never sees the real userData directory or the real vault.
 *
 * Seeding: each test writes a small deterministic vault through the app's own
 * files before launch — the exact layout of src/main/workspace/paths.ts — and
 * then boots the app. Dates are computed relative to the launch day, so the
 * fixtures always land inside the heatmap/trend windows. The demo vault never
 * appears (its seed only runs when `workspaces/` is missing), and the offline
 * practice seed only fills workspaces named kaoyan/english, so the vault holds
 * exactly the workspace below; no model call is involved anywhere:
 *
 *   workspaces/qa-learning/workspace.md          project 学习面板演练 with
 *                                                targetDate = today + 30 days
 *   workspaces/qa-learning/tasks/<day>.md        three done tasks with
 *                                                actualMin on today (45),
 *                                                yesterday (20), today-3 (5)
 *                                                → 共 70 分钟, 最长连续 2 天
 *   workspaces/qa-learning/practice/sets/ps-qa.md      two choice questions
 *   workspaces/qa-learning/practice/attempts/<today>.md five answers today
 *                                                      (4 correct) → 80%
 *   workspaces/qa-learning/practice/mistakes.md        one active choice
 *                                                      mistake, due today
 *   workspaces/qa-learning/plans/plan-qa.md            one-week plan so the
 *                                                      长期计划 header renders
 *                                                      the countdown
 */

const WORKSPACE_ID = 'qa-learning';
const SET_ID = 'ps-qa';
const MISTAKE_PROMPT = 'ASAKI 学习热力图一次覆盖最近多少天？';
const MISTAKE_EXPLANATION = '学习热力图按 12 周窗口汇总，共 84 天。';
/** src/renderer/shell/heatmap.ts HEATMAP_WINDOW_DAYS: 12 weeks = 84 cells. */
const HEATMAP_CELLS = 84;
/** src/renderer/shell/accuracy-trend.ts ACCURACY_TREND_WEEKS. */
const TREND_BARS = 8;
/** The project target date is seeded this many days ahead of the launch day. */
const TARGET_OFFSET_DAYS = 30;
const GREETING = new RegExp(
  `^(早上好|中午好|下午好|晚上好|夜深了)，${DEFAULT_DISPLAY_NAME}。$`
);

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

/**
 * Writes the fixture vault described in the file comment. Returns the dates
 * the assertions key on: the app stamps exported sheets and countdown labels
 * with its own clock on the same machine, so "today" matches.
 */
async function seedLearningVault(vault: string): Promise<{
  today: string;
  targetDate: string;
}> {
  const today = localDate(0);
  const targetDate = localDate(TARGET_OFFSET_DAYS);
  const workspaceDir = `workspaces/${WORKSPACE_ID}`;

  await writeVaultFile(
    vault,
    `${workspaceDir}/workspace.md`,
    `---
type: profile
source: user
id: ${WORKSPACE_ID}
name: 学习面板演练
kind: study
color: '#34c759'
goal: 端到端验证学习热力图、正确率趋势、错题本与倒计时
description: 由 e2e/qa-learning-surfaces.spec.ts 写入的隔离数据
checkIn: daily
targetDate: '${targetDate}'
createdAt: '2026-01-01T00:00'
updatedAt: '2026-01-01T00:00'
---

# 学习面板演练

- 类型：学习
- 目标：端到端验证学习热力图、正确率趋势、错题本与倒计时
`
  );

  // Heatmap fixture: 45 + 20 + 5 = 70 minutes across today / yesterday /
  // today-3. The two most recent days are consecutive, so 最长连续 = 2.
  const studyDays = [
    { offset: 0, minutes: 45, title: '真题精读', id: 'task-today' },
    { offset: -1, minutes: 20, title: '错题复盘', id: 'task-yesterday' },
    { offset: -3, minutes: 5, title: '单词速览', id: 'task-earlier' }
  ];
  for (const studyDay of studyDays) {
    const day = localDate(studyDay.offset);
    await writeVaultFile(
      vault,
      `${workspaceDir}/tasks/${day}.md`,
      `---
type: plan
source: user
date: '${day}'
tasks:
  - id: ${studyDay.id}
    title: ${studyDay.title}
    subject: 数学
    durationMin: ${studyDay.minutes}
    materialRefs: []
    acceptance: 计时满 ${studyDay.minutes} 分钟
    status: done
    actualMin: ${studyDay.minutes}
    due: '${day}'
    created: '2026-01-01T00:00'
    updated: '2026-01-01T00:00'
---

# ${day} 任务

- [x] ${studyDay.title}（数学 · ${studyDay.minutes} 分钟） — 计时满 ${studyDay.minutes} 分钟
`
    );
  }

  await writeVaultFile(
    vault,
    `${workspaceDir}/practice/sets/${SET_ID}.md`,
    `---
type: qa
source: user
kind: practice-set
id: ${SET_ID}
workspaceId: ${WORKSPACE_ID}
title: 端到端练习集
subject: 数学
created: '2026-01-01T00:00'
updated: '2026-01-01T00:00'
questions:
  - id: q-heat
    prompt: '${MISTAKE_PROMPT}'
    options:
      - '84 天'
      - '30 天'
    answer: 0
    explanation: '${MISTAKE_EXPLANATION}'
  - id: q-trend
    prompt: 'ASAKI 正确率趋势一次展示最近几周？'
    options:
      - '4 周'
      - '8 周'
    answer: 1
    explanation: '正确率趋势按最近 8 周汇总。'
---

# 端到端练习集

${WORKSPACE_ID} · 数学 · 2 题
`
  );

  // A second practice set in another subject, so the 复习单 summary line has
  // two real buckets (数学 + 政治) regardless of when the suite runs.
  await writeVaultFile(
    vault,
    `${workspaceDir}/practice/sets/ps-pol.md`,
    `---
type: qa
source: user
kind: practice-set
id: ps-pol
workspaceId: ${WORKSPACE_ID}
title: 政治演练
subject: 政治
created: '2026-01-01T00:00'
updated: '2026-01-01T00:00'
questions:
  - id: q-pol
    prompt: '矛盾的两种基本属性是？'
    options:
      - '普遍性和特殊性'
      - '同一性和斗争性'
    answer: 1
    explanation: '同一性和斗争性。'
---

# 政治演练

${WORKSPACE_ID} · 政治 · 1 题
`
  );

  // Accuracy fixture: every answer is dated today, so it always lands in the
  // current (rightmost) trend week regardless of when the suite runs.
  // 5 answers, 4 correct → 最近 8 周做 5 题 · 正确率 80%, with no earlier
  // scored week, so the summary carries no 比上周 comparison.
  const answers = [
    { id: 'pa-1', questionId: 'q-heat', choice: 1, correct: false, time: '09:30' },
    { id: 'pa-2', questionId: 'q-trend', choice: 1, correct: true, time: '09:31' },
    { id: 'pa-3', questionId: 'q-trend', choice: 1, correct: true, time: '09:32' },
    { id: 'pa-4', questionId: 'q-trend', choice: 1, correct: true, time: '09:33' },
    { id: 'pa-5', questionId: 'q-trend', choice: 1, correct: true, time: '09:34' }
  ];
  await writeVaultFile(
    vault,
    `${workspaceDir}/practice/attempts/${today}.md`,
    `---
type: log
source: user
kind: practice-attempts
date: '${today}'
entries:
${answers
  .map(
    (answer) => `  - id: ${answer.id}
    workspaceId: ${WORKSPACE_ID}
    setId: ${SET_ID}
    questionId: ${answer.questionId}
    choice: ${answer.choice}
    correct: ${answer.correct}
    answeredAt: '${today}T${answer.time}'`
  )
  .join('\n')}
---

# ${today} 练习记录

${answers
  .map(
    (answer) =>
      `- ${answer.time} · ${answer.questionId} · 选择 ${answer.choice} · ${
        answer.correct ? '✅' : '❌'
      }`
  )
  .join('\n')}
`
  );

  await writeVaultFile(
    vault,
    `${workspaceDir}/practice/mistakes.md`,
    `---
type: qa
source: user
kind: practice-mistakes
workspaceId: ${WORKSPACE_ID}
updated: '${today}T09:30'
entries:
  - id: pm-heat
    workspaceId: ${WORKSPACE_ID}
    setId: ${SET_ID}
    questionId: q-heat
    prompt: '${MISTAKE_PROMPT}'
    options:
      - '84 天'
      - '30 天'
    answer: 0
    explanation: '${MISTAKE_EXPLANATION}'
    wrongCount: 1
    correctStreak: 0
    priority: 1
    intervalDays: 1
    due: '${today}'
    status: active
    createdAt: '${today}T09:30'
    updatedAt: '${today}T09:30'
    lastAnsweredAt: '${today}T09:30'
  - id: pm-pol
    workspaceId: ${WORKSPACE_ID}
    setId: ps-pol
    questionId: q-pol
    prompt: '矛盾的两种基本属性是？'
    options:
      - '普遍性和特殊性'
      - '同一性和斗争性'
    answer: 1
    explanation: '同一性和斗争性。'
    wrongCount: 1
    correctStreak: 0
    priority: 1
    intervalDays: 1
    due: '${today}'
    status: active
    createdAt: '${today}T09:31'
    updatedAt: '${today}T09:31'
    lastAnsweredAt: '${today}T09:31'
  - id: pm-done
    workspaceId: ${WORKSPACE_ID}
    setId: ${SET_ID}
    questionId: q-trend
    prompt: '已掌握错题：正确率趋势展示几周？'
    options:
      - '4 周'
      - '8 周'
    answer: 1
    explanation: '正确率趋势按最近 8 周汇总。'
    cause: '记混了窗口长度'
    wrongCount: 2
    correctStreak: 2
    priority: 0
    intervalDays: 8
    due: '${localDate(TARGET_OFFSET_DAYS)}'
    status: resolved
    createdAt: '${today}T09:30'
    updatedAt: '${today}T09:40'
    lastAnsweredAt: '${today}T09:40'
---

# ${WORKSPACE_ID} 错题本

## q-heat · ${MISTAKE_PROMPT}

- 错误次数：1
- 优先级：1
- 间隔：1 天
- 下次复习 ${today}
`
  );

  await writeVaultFile(
    vault,
    `${workspaceDir}/plans/plan-qa.md`,
    `---
type: plan
source: user
kind: long-plan
id: plan-qa
workspaceId: ${WORKSPACE_ID}
goal: 端到端验证倒计时
startDate: '${today}'
weeks: 1
weeklyHours: 5
generatedBy: template
created: '2026-01-01T00:00'
updated: '2026-01-01T00:00'
phases:
  - id: phase-1
    title: 第一阶段
    subtitle: 演练
    goal: 让长期计划页渲染倒计时
    weeks:
      - id: week-1
        number: 1
        title: 第 1 周
        goal: 让长期计划页渲染倒计时
        startDate: '${today}'
        endDate: '${localDate(6)}'
        days:
          - id: week-1-day-1
            date: '${today}'
            tasks:
              - 查看今日页的目标倒计时
            output: 倒计时可见
            done: false
        checks:
          - id: week-1-check-1
            text: 今日页显示倒计时
            done: false
---

# 端到端验证倒计时 · 长期计划

- 周期：1 周 · 每周约 5 小时
- 开始：${today}
`
  );

  return { today, targetDate };
}

/** Seeds the vault, then launches the app against the same isolated env. */
async function launchSeeded(): Promise<{
  launched: LaunchedStudyCoach;
  today: string;
  targetDate: string;
}> {
  const environment = await createIsolatedEnvironment();
  const dates = await seedLearningVault(environment.vault);
  const launched = await launchStudyCoach(environment);
  return { launched, ...dates };
}

/** Layout geometry of one 复盘 card, for the no-horizontal-overflow guard. */
async function cardGeometry(
  page: Page,
  ariaLabel: string
): Promise<{ clientWidth: number; scrollWidth: number }> {
  return page
    .locator(`section[aria-label="${ariaLabel}"]`)
    .evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }));
}

test.describe('learning surfaces (heatmap, accuracy trend, mistake sheet, countdown)', () => {
  test('复盘 shows the study heatmap and the 8-week accuracy trend without horizontal overflow', async () => {
    const { launched } = await launchSeeded();
    const { page } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await expect(page.getByText(GREETING)).toBeVisible();

      await page
        .getByRole('navigation', { name: '主导航' })
        .getByRole('button', { name: '复盘', exact: true })
        .click();

      const heatmap = page.locator('section[aria-label="学习热力图"]');
      await expect(heatmap).toBeVisible();
      // The fixture sums to 70 minutes and its two most recent days are
      // consecutive, so the summary line is pinned.
      await expect(
        heatmap.getByText('最近 12 周共学习 70 分钟 · 最长连续 2 天')
      ).toBeVisible();
      // Every real day is a cell (level-0 days included) with role="img";
      // the head padding cells are aria-hidden and carry no role.
      await expect(heatmap.locator('[role="img"]')).toHaveCount(HEATMAP_CELLS);

      const trend = page.locator('section[aria-label="正确率趋势"]');
      await expect(trend).toBeVisible();
      // Eight Monday-based weeks; empty weeks draw their placeholder bar,
      // so the bar count equals the window length either way.
      await expect(trend.locator('[role="img"]')).toHaveCount(TREND_BARS);
      await expect(trend.getByText('最近 8 周做 5 题 · 正确率 80%')).toBeVisible();

      // Both cards must fit the default window (900x680 outer, ≈890px of
      // content width) — the overflow class the runtime QA caught on other
      // cards at this exact width.
      for (const label of ['学习热力图', '正确率趋势']) {
        const geometry = await cardGeometry(page, label);
        expect(
          geometry.scrollWidth,
          `the ${label} card must not overflow horizontally`
        ).toBeLessThanOrEqual(geometry.clientWidth + 1);
      }

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('错题本 exports a review sheet under practice/review-sheets/', async () => {
    const { launched, today } = await launchSeeded();
    const { page, environment } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await expect(page.getByText(GREETING)).toBeVisible();

      // 学习 surface: the projects page's 练习 entry opens the pane whose
      // mistake book (错题本) sits at the bottom.
      await page.getByRole('button', { name: '全部项目' }).click();
      await expect(page.locator('header').getByText('项目', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '练习', exact: true }).click();

      // The seeded set is auto-selected and the seeded mistake is listed as
      // due today.
      await expect(page.getByRole('heading', { name: MISTAKE_PROMPT })).toBeVisible();
      await expect(page.getByText(/错题本 · 2 道待复习/)).toBeVisible();
      await expect(page.getByText('今天到期 2 道')).toBeVisible();

      await page.getByRole('button', { name: '导出复习单' }).click();
      const relativePath = `workspaces/${WORKSPACE_ID}/practice/review-sheets/${today}.md`;
      await expect(page.getByText(`已保存：${relativePath}`)).toBeVisible();

      // The sheet lives in the (temp) vault and must carry the question, its
      // spelled-out options and the 参考答案-style line for a choice question.
      const sheet = await readFile(join(environment.vault, ...relativePath.split('/')), 'utf8');
      expect(sheet, 'the review sheet title line').toContain(`# 错题复习单 · ${today}`);
      expect(sheet).toContain(`## 1. ${MISTAKE_PROMPT}`);
      expect(sheet).toContain('A. 84 天');
      expect(sheet).toContain('B. 30 天');
      expect(sheet).toContain('答案：A');
      expect(sheet).toContain(`解析：${MISTAKE_EXPLANATION}`);
      expect(sheet).toContain(`错 1 次 · 优先级 1 · 下次复习 ${today}`);

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('错因/顽疾/科目聚合行/可逆归档', async () => {
    const { launched, today } = await launchSeeded();
    const { page, environment } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await expect(page.getByText(GREETING)).toBeVisible();
      await page.getByRole('button', { name: '全部项目' }).click();
      await expect(page.locator('header').getByText('项目', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '练习', exact: true }).click();
      await expect(page.getByText(/错题本 · 2 道待复习/)).toBeVisible();

      // ① 错因 one-liner: type into the inline editor and save.
      await page.getByRole('button', { name: `补一句错因：${MISTAKE_PROMPT}` }).click();
      const causeInput = page.getByLabel(`错因：${MISTAKE_PROMPT}`);
      await expect(causeInput).toHaveAttribute('placeholder', '哪个概念、为什么（例：导数链没拆完）');
      await causeInput.fill('不知道热力图窗口多久');
      await page.getByRole('button', { name: '保存', exact: true }).click();
      await expect(page.getByText('错因：不知道热力图窗口多久')).toBeVisible();

      const mistakesRaw = await readFile(
        join(environment.vault, 'workspaces', WORKSPACE_ID, 'practice', 'mistakes.md'),
        'utf8'
      );
      expect(mistakesRaw).toContain('cause: 不知道热力图窗口多久');

      // ② 复习单: two subjects ⇒ summary line; the active record itself is not
      // 顽疾 (wrongCount 1) so the mark must be absent.
      await page.getByRole('button', { name: '导出复习单' }).click();
      const sheetRel = `workspaces/${WORKSPACE_ID}/practice/review-sheets/${today}.md`;
      await expect(page.getByText(`已保存：${sheetRel}`)).toBeVisible();
      const sheet = await readFile(join(environment.vault, ...sheetRel.split('/')), 'utf8');
      expect(sheet).toContain('数学 1 · 政治 1');
      expect(sheet).toContain('错因：不知道热力图窗口多久');
      expect(sheet).not.toContain('顽疾');

      // ③ 清空已掌握: the resolved seeded record moves to the archive file.
      await page.getByRole('button', { name: '清空已掌握' }).click();
      await expect(page.getByText('已归档 1 道已掌握错题（可从归档恢复）')).toBeVisible();
      const archiveRel = `workspaces/${WORKSPACE_ID}/practice/mistakes-archive.md`;
      const archive = await readFile(join(environment.vault, ...archiveRel.split('/')), 'utf8');
      expect(archive).toContain('id: pm-done');
      expect(archive).toContain(`archivedAt: '${today}'`);
      expect(archive).toContain('cause: 记混了窗口长度');
      const mistakesAfter = await readFile(
        join(environment.vault, 'workspaces', WORKSPACE_ID, 'practice', 'mistakes.md'),
        'utf8'
      );
      expect(mistakesAfter).not.toContain('id: pm-done');

      // ④ 从归档恢复: the record returns to mistakes.md, still resolved.
      await page.getByRole('button', { name: '从归档恢复' }).click();
      await expect(page.getByText('归档 · 1 道已掌握')).toBeVisible();
      await page.getByRole('button', { name: '从归档恢复：已掌握错题：正确率趋势展示几周？' }).click();
      await expect(page.getByText('已恢复到错题本：已掌握错题：正确率趋势展示几周？')).toBeVisible();
      const restored = await readFile(
        join(environment.vault, 'workspaces', WORKSPACE_ID, 'practice', 'mistakes.md'),
        'utf8'
      );
      expect(restored).toContain('id: pm-done');
      expect(restored).toMatch(/id: pm-done[\s\S]*?status: resolved/);

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('今日 and 长期计划 count down to the project target date', async () => {
    const { launched, targetDate } = await launchSeeded();
    const { page } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const expected = `距离目标 ${targetDate} 还有 ${TARGET_OFFSET_DAYS} 天`;
    try {
      await expect(page.getByText(GREETING)).toBeVisible();

      const nav = page.getByRole('navigation', { name: '主导航' });
      await nav.getByRole('button', { name: '今日', exact: true }).click();
      await expect(page.getByLabel('目标倒计时')).toHaveText(expected);

      await nav.getByRole('button', { name: '长期计划', exact: true }).click();
      const detail = page.getByRole('region', { name: '计划详情' });
      await expect(detail).toBeVisible();
      await expect(detail.getByRole('heading', { name: '端到端验证倒计时' })).toBeVisible();
      // The plan header appends the same countdown after the weekly hours.
      await expect(page.getByTestId('plan-countdown')).toContainText(expected);

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });
});
