import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  createIsolatedEnvironment,
  launchStudyCoach,
  type IsolatedEnvironment,
  type LaunchedStudyCoach
} from './support/launch';

/**
 * End-to-end guard for the learning-science flows shipped across the last
 * three rounds: 简答（自判对错）, 把握度校准, 任务触发线索, 交错混练 and
 * 掌握门控. Unit tests cover each helper in isolation; this spec drives the
 * real Electron window so the *composition* is guarded — state resets between
 * questions, the mixed session writing mistakes through the real submit path,
 * cue rows reflowing on 今日, and gate copy updating live when a check is
 * ticked.
 *
 * Safety: every launch goes through the isolated harness
 * (`createIsolatedEnvironment()`: temp userData + temp vault + fake CLI). The
 * app never sees the real userData directory or the real vault.
 *
 * Seeding: each test writes the app's own vault files before launch, using
 * the layout from `src/main/workspace/paths.ts`. No model call is involved:
 *
 *   workspaces/qa-learning/workspace.md                      the project
 *   workspaces/qa-learning/practice/sets/<set>.md            practice sets
 *   workspaces/qa-learning/plans/<plan>.md                   long plans
 *
 * Tasks are created and cleared through the UI in the cue test so the form's
 * 触发时机 field is exercised end to end.
 */

const WORKSPACE_ID = 'qa-learning';
const WORKSPACE_NAME = '学习流演练';
const GREETING = /^(早上好|中午好|下午好|晚上好|夜深了)，xiaolai。$/;

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

function workspaceBody(name: string, goal: string): string {
  return `---
type: profile
source: user
id: ${WORKSPACE_ID}
name: ${name}
kind: study
color: '#34c759'
goal: ${goal}
description: 由 e2e/qa-learning-flows.spec.ts 写入的隔离数据
checkIn: daily
createdAt: '2026-01-01T00:00'
updatedAt: '2026-01-01T00:00'
---

# ${name}

- 类型：学习
- 目标：${goal}
`;
}

type FixtureQuestion =
  | {
      id: string;
      kind: 'choice';
      prompt: string;
      options: string[];
      answer: number;
      explanation?: string;
    }
  | {
      id: string;
      kind: 'short';
      prompt: string;
      referenceAnswer: string;
      explanation?: string;
    };

/** Writes a `kind: practice-set` note in the exact shape `records.ts` reads. */
function practiceSetBody(set: {
  id: string;
  title: string;
  subject: string;
  questions: FixtureQuestion[];
}): string {
  const questions = set.questions
    .map((question) => {
      if (question.kind === 'short') {
        return `  - id: ${question.id}
    kind: short
    prompt: '${question.prompt}'
    options: []
    answer: 0
    referenceAnswer: '${question.referenceAnswer}'
    explanation: '${question.explanation ?? ''}'`;
      }
      return `  - id: ${question.id}
    prompt: '${question.prompt}'
    options:
${question.options.map((option) => `      - '${option}'`).join('\n')}
    answer: ${question.answer}
    explanation: '${question.explanation ?? ''}'`;
    })
    .join('\n');

  return `---
type: qa
source: user
kind: practice-set
id: ${set.id}
workspaceId: ${WORKSPACE_ID}
title: ${set.title}
subject: ${set.subject}
created: '2026-01-01T00:00'
updated: '2026-01-01T00:00'
questions:
${questions}
---

# ${set.title}

${WORKSPACE_ID} · ${set.subject} · ${set.questions.length} 题
`;
}

/** Writes the vault, then launches the app against the same isolated env. */
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

async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByText(GREETING)).toBeVisible();
}

async function openProjects(page: Page): Promise<void> {
  await page.getByRole('button', { name: '全部工作区' }).click();
  await expect(page.locator('header').getByText('项目', { exact: true })).toBeVisible();
}

async function openPractice(page: Page): Promise<void> {
  await openProjects(page);
  await page.getByRole('button', { name: '练习', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭练习' })).toBeVisible();
}

function navButton(page: Page, name: string) {
  return page.getByRole('navigation', { name: '主导航' }).getByRole('button', {
    name,
    exact: true
  });
}

/** The ConfidencePicker is a labelled group above the question. */
function confidence(page: Page) {
  return page.getByRole('group', { name: '答题前的把握度' });
}

test.describe('learning-science flows', () => {
  test('简答题: reveal, 没答对, mistake book and exported review sheet', async () => {
    const prompt = '用自己的话说说为什么间隔复习更有效。';
    const reference = '间隔复习让每次回忆都发生在快要遗忘时，记忆被重新加固。';
    const explanation = '提取本身会强化记忆，间隔拉长了遗忘的起点。';
    const response = '因为每次想起来都会把记忆再巩固一遍。';
    const today = localDate(0);

    const { launched, environment } = await launchWith({
      [`workspaces/${WORKSPACE_ID}/workspace.md`]: workspaceBody(
        WORKSPACE_NAME,
        '端到端验证简答自判流程'
      ),
      [`workspaces/${WORKSPACE_ID}/practice/sets/set-short.md`]: practiceSetBody({
        id: 'set-short',
        title: '简答练习',
        subject: '学习方法',
        questions: [
          { id: 'q-short', kind: 'short', prompt, referenceAnswer: reference, explanation }
        ]
      })
    });
    const { page } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await waitForShell(page);
      await openPractice(page);

      // The set is auto-selected; the free-recall composer is on screen.
      await expect(page.getByRole('heading', { name: prompt })).toBeVisible();
      const composer = page.getByLabel('用你自己的话回答');
      await expect(composer).toBeVisible();
      await composer.fill(response);

      // 提交 only reveals the model answer — nothing is recorded yet.
      await page.getByRole('button', { name: '提交', exact: true }).click();
      await expect(page.getByText(`参考答案：${reference}`)).toBeVisible();
      await expect(page.getByText(`你写的是：${response}`)).toBeVisible();
      await expect(page.getByText('对照参考答案自评，这一步会决定下次复习时间。')).toBeVisible();

      // 没答对 is the verdict that reaches the scheduler.
      await page.getByRole('button', { name: '没答对' }).click();
      await expect(page.getByText('回答错误').first()).toBeVisible();
      await expect(page.getByText(/已加入错题本/)).toBeVisible();

      // The mistake book now carries the short mistake AND its reference answer.
      await expect(page.getByText(/错题本 · 1 道待复习/)).toBeVisible();
      const shortMistakeRow = page
        .locator('li')
        .filter({ hasText: prompt })
        .filter({ hasText: '参考答案' });
      await expect(shortMistakeRow).toHaveCount(1);
      await expect(shortMistakeRow.getByText(`参考答案：${reference}`)).toBeVisible();

      // Exporting writes the printable sheet into the (temp) vault.
      await page.getByRole('button', { name: '导出复习单' }).click();
      const relativePath = `workspaces/${WORKSPACE_ID}/practice/review-sheets/${today}.md`;
      await expect(page.getByText(`已保存：${relativePath}`)).toBeVisible();

      const sheet = await readFile(join(environment.vault, ...relativePath.split('/')), 'utf8');
      expect(sheet, 'the sheet title').toContain(`# 错题复习单 · ${today}`);
      expect(sheet, 'the short mistake heading').toContain(`## 1. ${prompt}`);
      expect(sheet, 'a short question spells out its model answer').toContain(
        `参考答案：${reference}`
      );
      expect(sheet, 'the explanation is carried over').toContain(`解析：${explanation}`);

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('把握度校准: a confidently wrong answer is counted, an unmarked one is not', async () => {
    const q1 = { prompt: '有把握题的题干：2 的平方是多少？', options: ['4', '2'], answer: 0 };
    const q2 = {
      prompt: '未标记题的题干：3 的平方是多少？',
      options: ['6', '9'],
      answer: 1
    };

    const { launched } = await launchWith({
      [`workspaces/${WORKSPACE_ID}/workspace.md`]: workspaceBody(
        WORKSPACE_NAME,
        '端到端验证把握度校准'
      ),
      [`workspaces/${WORKSPACE_ID}/practice/sets/set-calibration.md`]: practiceSetBody({
        id: 'set-calibration',
        title: '校准练习',
        subject: '数学',
        questions: [
          {
            id: 'q-sure',
            kind: 'choice',
            prompt: q1.prompt,
            options: q1.options,
            answer: q1.answer,
            explanation: '2 的平方是 4。'
          },
          {
            id: 'q-unmarked',
            kind: 'choice',
            prompt: q2.prompt,
            options: q2.options,
            answer: q2.answer,
            explanation: '3 的平方是 9。'
          }
        ]
      })
    });
    const { page } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await waitForShell(page);
      await openPractice(page);

      // Question 1: mark 有把握, then pick the wrong option (B) and submit.
      await expect(page.getByRole('heading', { name: q1.prompt })).toBeVisible();
      await confidence(page).getByRole('button', { name: '有把握' }).click();
      await expect(
        confidence(page).getByRole('button', { name: '有把握' })
      ).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: `B. ${q1.options[1]}` }).click();
      await page.getByRole('button', { name: '检查答案' }).click();
      await expect(page.getByText('回答错误').first()).toBeVisible();
      await page.getByRole('button', { name: '下一题' }).click();

      // Question 2: deliberately leave the picker alone, then answer.
      await expect(page.getByRole('heading', { name: q2.prompt })).toBeVisible();
      await expect(
        confidence(page).getByRole('button', { name: '有把握' })
      ).toHaveAttribute('aria-pressed', 'false');
      await page.getByRole('button', { name: `B. ${q2.options[1]}` }).click();
      await page.getByRole('button', { name: '检查答案' }).click();
      await expect(page.getByText('回答正确').first()).toBeVisible();

      // Calibration lives on 复盘, built from the recorded attempts.
      await page.getByRole('button', { name: '关闭练习' }).click();
      await navButton(page, '复盘').click();

      const card = page.locator('section[aria-label="把握度校准"]');
      await expect(card).toBeVisible();
      // Only the one 有把握 attempt counts; the unmarked attempt stays out,
      // so the line is exactly 1/1 rather than 2/1 or a 不确定 segment.
      await expect(card).toContainText('近 8 周：有把握的 1 题错 1 道（100%）');
      await expect(card).not.toContainText('不确定');
      await expect(card.getByText('自认有把握却答错的，正是要重点练的')).toBeVisible();

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('触发线索: 今日 renders the if-then line and it disappears when the cue is cleared', async () => {
    const taskTitle = '晚饭后的复盘';
    const cue = '晚饭后';
    const { launched } = await launchWith({
      [`workspaces/${WORKSPACE_ID}/workspace.md`]: workspaceBody(
        WORKSPACE_NAME,
        '端到端验证任务触发线索'
      )
    });
    const { page } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await waitForShell(page);
      await openProjects(page);

      // Select the project so the task form is available.
      await page.getByRole('combobox', { name: '切换项目' }).click();
      await page.getByRole('option', { name: WORKSPACE_NAME }).click();

      await page.getByRole('button', { name: '新增任务' }).click();
      await page.getByLabel('新任务标题').fill(taskTitle);
      await page.getByLabel('新任务触发时机').fill(cue);
      await page.getByRole('button', { name: '保存任务' }).click();

      // The plan list shows the cue chip once the task is stored.
      await expect(
        page.getByText(taskTitle, { exact: true })
      ).toBeVisible();
      await expect(page.getByText(cue, { exact: true })).toBeVisible();

      // 今日 turns the cue into the implementation-intention sentence.
      await navButton(page, '今日').click();
      const cueLine = `如果 ${cue}，就先做「${taskTitle}」`;
      await expect(page.getByText(cueLine)).toBeVisible();

      // Clicking the task title goes back to 项目 with the workspace selected.
      await page.getByRole('button', { name: taskTitle, exact: true }).click();
      await page.getByRole('button', { name: `编辑任务：${taskTitle}` }).click();
      const cueField = page.getByLabel('编辑任务触发时机');
      await expect(cueField).toHaveValue(cue);
      await cueField.fill('');
      await page.getByRole('button', { name: '保存修改' }).click();

      // The task stays, the if-then line is gone.
      await navButton(page, '今日').click();
      await expect(page.getByRole('button', { name: taskTitle, exact: true })).toBeVisible();
      await expect(page.getByText(cueLine)).toHaveCount(0);
      await expect(page.getByText(new RegExp(`如果 ${cue}，`))).toHaveCount(0);

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('交错混练: two sets alternate, state resets, mistakes land on the real sets', async () => {
    const subject = '数学';
    const titleA = '甲组练习';
    const titleB = '乙组练习';
    const promptA1 = '甲组第一题：三角形的内角和是多少？';
    const promptB1 = '乙组第一题：正方形的内角和是多少？';
    const promptA2 = '甲组第二题：用自己的话说说勾股定理。';
    const promptB2 = '乙组第二题：用自己的话说说平行线。';

    const { launched, environment } = await launchWith({
      [`workspaces/${WORKSPACE_ID}/workspace.md`]: workspaceBody(
        WORKSPACE_NAME,
        '端到端验证交错混练'
      ),
      [`workspaces/${WORKSPACE_ID}/practice/sets/set-a.md`]: practiceSetBody({
        id: 'set-a',
        title: titleA,
        subject,
        questions: [
          {
            id: 'q-a1',
            kind: 'choice',
            prompt: promptA1,
            options: ['180 度', '360 度'],
            answer: 0
          },
          {
            id: 'q-a2',
            kind: 'short',
            prompt: promptA2,
            referenceAnswer: '直角三角形两条直角边的平方和等于斜边的平方。'
          }
        ]
      }),
      [`workspaces/${WORKSPACE_ID}/practice/sets/set-b.md`]: practiceSetBody({
        id: 'set-b',
        title: titleB,
        subject,
        questions: [
          {
            id: 'q-b1',
            kind: 'choice',
            prompt: promptB1,
            options: ['360 度', '180 度'],
            answer: 0
          },
          {
            id: 'q-b2',
            kind: 'short',
            prompt: promptB2,
            referenceAnswer: '同一平面内不相交的两条直线互相平行。'
          }
        ]
      })
    });
    const { page } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await waitForShell(page);
      await openPractice(page);

      // Two same-subject sets make the pane offer 交错混练.
      await expect(page.getByText(/把「数学」的多份练习交错着做/)).toBeVisible();
      await page.getByRole('button', { name: '交错混练' }).click();
      await expect(page.getByText(`交错混练 · ${subject}`)).toBeVisible();
      await expect(page.getByText('1 / 4')).toBeVisible();

      // Question 1 and 2 come from different sets, each labelled 来自：…
      const sourceLine = page.getByText(/^来自：/);
      await expect(sourceLine).toHaveCount(1);
      const firstSource = (await sourceLine.textContent())?.trim() ?? '';
      expect([`来自：${titleA}`, `来自：${titleB}`]).toContain(firstSource);

      // Q1: both sets' first questions are choice questions with B as wrong.
      await page.getByRole('button', { name: /^B\. / }).click();
      await page.getByRole('button', { name: '检查答案' }).click();
      await expect(page.getByText('回答错误').first()).toBeVisible();
      await page.getByRole('button', { name: '下一题' }).click();

      // Q2: a different source, and every per-question bit of state reset.
      await expect(page.getByText('2 / 4')).toBeVisible();
      await expect(sourceLine).toHaveCount(1);
      const secondSource = (await sourceLine.textContent())?.trim() ?? '';
      expect(secondSource).not.toBe(firstSource);
      expect([`来自：${titleA}`, `来自：${titleB}`]).toContain(secondSource);
      await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '检查答案' })).toBeDisabled();

      // Answer Q2 wrong too, then land on Q3 — a short question with a
      // cleared response and no revealed reference answer.
      await page.getByRole('button', { name: /^B\. / }).click();
      await page.getByRole('button', { name: '检查答案' }).click();
      await expect(page.getByText('回答错误').first()).toBeVisible();
      await page.getByRole('button', { name: '下一题' }).click();

      await expect(page.getByText('3 / 4')).toBeVisible();
      const composer = page.locator('#practice-short-response');
      await expect(composer).toBeVisible();
      await expect(composer).toHaveValue('');
      await expect(page.getByText(/^参考答案：/)).toHaveCount(0);
      await expect(page.getByRole('button', { name: '提交', exact: true })).toBeDisabled();

      // Both wrong answers were recorded against their REAL sets, and the
      // mistake book shows both prompts.
      await expect(page.getByText(/错题本 · 2 道待复习/)).toBeVisible();
      // Each prompt also appears once in 答题历史, so target the first match.
      await expect(page.getByText(promptA1).first()).toBeVisible();
      await expect(page.getByText(promptB1).first()).toBeVisible();

      const mistakes = await readFile(
        join(environment.vault, 'workspaces', WORKSPACE_ID, 'practice', 'mistakes.md'),
        'utf8'
      );
      expect(mistakes).toContain('setId: set-a');
      expect(mistakes).toContain('setId: set-b');
      expect(mistakes, 'no synthetic mix set leaks into the vault').not.toContain('mix-');

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });

  test('掌握门控: phase two stays locked until every earlier check is ticked', async () => {
    const today = localDate(0);
    const gatedGoal = '掌握门控演练';
    const openGoal = '无门控演练';
    const checkA = '阶段一验收甲';
    const checkB = '阶段一验收乙';

    const gatedPlan = `---
type: plan
source: user
kind: long-plan
id: plan-gated
workspaceId: ${WORKSPACE_ID}
goal: ${gatedGoal}
startDate: '${today}'
weeks: 2
weeklyHours: 5
generatedBy: template
created: '2026-01-01T00:00'
updated: '2026-01-01T00:00'
phases:
  - id: phase-one
    title: 第一阶段
    subtitle: 打基础
    goal: 完成基础验收
    weeks:
      - id: pw-1
        number: 1
        title: 第 1 周
        goal: 打基础
        startDate: '${today}'
        endDate: '${localDate(6)}'
        days:
          - id: pw-1-day-1
            date: '${today}'
            tasks:
              - 完成基础练习
            output: 基础验收可勾选
            done: false
        checks:
          - id: check-one-a
            text: ${checkA}
            done: false
          - id: check-one-b
            text: ${checkB}
            done: false
  - id: phase-two
    title: 第二阶段
    subtitle: 拔高
    goal: 完成拔高验收
    weeks:
      - id: pw-2
        number: 2
        title: 第 2 周
        goal: 拔高
        startDate: '${localDate(7)}'
        endDate: '${localDate(13)}'
        days:
          - id: pw-2-day-1
            date: '${localDate(7)}'
            tasks:
              - 完成拔高练习
            output: 拔高验收
            done: false
        checks:
          - id: check-two-a
            text: 阶段二验收已达标
            done: true
---

# ${gatedGoal} · 长期计划

- 周期：2 周 · 每周约 5 小时
- 开始：${today}
`;

    const openPlan = `---
type: plan
source: user
kind: long-plan
id: plan-open
workspaceId: ${WORKSPACE_ID}
goal: ${openGoal}
startDate: '${today}'
weeks: 2
weeklyHours: 5
generatedBy: template
created: '2026-01-01T00:00'
updated: '2026-01-01T00:00'
phases:
  - id: open-phase-one
    title: 第一阶段
    subtitle: 无验收
    goal: 只做任务
    weeks:
      - id: open-w-1
        number: 1
        title: 第 1 周
        goal: 只做任务
        startDate: '${today}'
        endDate: '${localDate(6)}'
        days:
          - id: open-w-1-day-1
            date: '${today}'
            tasks:
              - 完成第一周任务
            output: 无
            done: false
  - id: open-phase-two
    title: 第二阶段
    subtitle: 无验收
    goal: 继续做任务
    weeks:
      - id: open-w-2
        number: 2
        title: 第 2 周
        goal: 继续做任务
        startDate: '${localDate(7)}'
        endDate: '${localDate(13)}'
        days:
          - id: open-w-2-day-1
            date: '${localDate(7)}'
            tasks:
              - 完成第二周任务
            output: 无
            done: false
---

# ${openGoal} · 长期计划

- 周期：2 周 · 每周约 5 小时
- 开始：${today}
`;

    const { launched } = await launchWith({
      [`workspaces/${WORKSPACE_ID}/workspace.md`]: workspaceBody(
        WORKSPACE_NAME,
        '端到端验证掌握门控'
      ),
      [`workspaces/${WORKSPACE_ID}/plans/plan-gated.md`]: gatedPlan,
      [`workspaces/${WORKSPACE_ID}/plans/plan-open.md`]: openPlan
    });
    const { page } = launched;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await waitForShell(page);
      await navButton(page, '长期计划').click();
      await page.getByRole('button', { name: `查看计划：${gatedGoal}` }).click();

      const detail = page.getByRole('region', { name: '计划详情' });
      await expect(detail.getByRole('heading', { name: gatedGoal })).toBeVisible();

      const phaseTwo = page
        .getByRole('heading', { name: '第二阶段' })
        .locator('xpath=ancestor::section[1]');
      await expect(
        phaseTwo.getByText('解锁条件：完成「第一阶段」的验收项，还差 2 项')
      ).toBeVisible();
      await expect(
        detail.getByText('阶段推进看验收，不看日期：下一阶段还差 2 项验收')
      ).toBeVisible();

      // Ticking both phase-one checks unlocks phase two live.
      for (const text of [checkA, checkB]) {
        const box = page.getByRole('checkbox', { name: `完成验收：${text}` });
        await box.click();
        await expect(box).toHaveAttribute('aria-checked', 'true');
      }

      await expect(phaseTwo.getByText(/解锁条件/)).toHaveCount(0);
      await expect(detail.getByText(/阶段推进看验收/)).toHaveCount(0);
      await expect(phaseTwo.getByText('已达标', { exact: true })).toBeVisible();

      // A plan whose phases carry no checks shows no gate copy at all.
      await page.getByRole('button', { name: `查看计划：${openGoal}` }).click();
      await expect(detail.getByRole('heading', { name: openGoal })).toBeVisible();
      await expect(detail.getByText(/阶段推进看验收/)).toHaveCount(0);
      await expect(detail.getByText(/解锁条件/)).toHaveCount(0);
      await expect(detail.getByText('已达标', { exact: true })).toHaveCount(0);

      expect(pageErrors).toEqual([]);
    } finally {
      await launched.close();
    }
  });
});