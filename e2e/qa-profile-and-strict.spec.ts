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
 * End-to-end guard for the two gaps called out in
 * `docs/superpowers/reports/2026-11-22-qa-sweep.md` §5 item ③:
 *
 * 1. 我的资料 (the `profile` navigation destination) was the only page no e2e
 *    spec ever opened. This spec adds a fact through the real form, checks the
 *    model-inferred entry keeps its 待确认 state, and relaunches the same
 *    isolated environment to prove the fact survives a restart.
 * 2. The opt-in 更严的掌握判定 setting was covered by renderer unit tests but had
 *    no end-to-end proof. This spec ticks it in 设置, saves, and then answers a
 *    spaced mistake in 学习: a correct *choice* answer stays active and the
 *    mistake book states 更严判定生效中：需要简答题复证, while a correct *short*
 *    answer resolves it (已掌握 in `mistakes.md`). It unties the setting,
 *    restarts, and shows a fresh spaced choice answer resolves again.
 *
 * Safety: every launch goes through the isolated harness
 * (`createIsolatedEnvironment()`: temp userData + temp vault + fake CLI). The
 * app never sees the real userData directory or the real vault.
 *
 * Seeding uses the app's own on-disk layout (src/main/workspace/paths.ts):
 *   profile.md                                              vault-wide profile
 *   workspaces/<id>/workspace.md                            the project
 *   workspaces/<id>/practice/sets/<set>.md                  one practice set
 *   workspaces/<id>/practice/mistakes.md                    active mistakes
 * Settings live in `<userData>/state.json`, so the strict flag is asserted on
 * that file rather than through a snapshot.
 */

const WORKSPACE_ID = 'qa-strict';
const WORKSPACE_NAME = '更严判定演练';
const SET_ID = 'set-strict';
const CHOICE_PROMPT = '更严判定：间隔复习的选择题，答对就掌握了吗？';
const SHORT_PROMPT = '用自己的话说说为什么更严判定要求简答题复证。';
const CHOICE_EXPLANATION = '默认答对就掌握；更严判定要求隔过几天后再用简答复证。';
const SHORT_REFERENCE = '因为再认比回忆容易，只有自己说出来才算真的记得。';
const GREETING = /^(早上好|中午好|下午好|晚上好|夜深了)，xiaolai。$/;
/** The one verbatim clause shared by every strict-mode surface. */
const STRICT_NOTE = '更严判定生效中：需要简答题复证';
/** The model-inferred fact seeded into profile.md. */
const CANDIDATE_TEXT = '我习惯在晚上九点后复盘一天的学习。';

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
description: 由 e2e/qa-profile-and-strict.spec.ts 写入的隔离数据
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

type MistakeFixture = {
  id: string;
  questionId: string;
  kind: 'choice' | 'short';
  prompt: string;
  options: string[];
  answer: number;
  referenceAnswer?: string;
  explanation: string;
  /** The interval that just elapsed; >= 3 makes the run "spaced". */
  intervalDays: number;
  /** A past due date is what makes answering today prove the late review. */
  due: string;
};

function mistakeMetaBlock(mistake: MistakeFixture): string {
  return `  - id: ${mistake.id}
    workspaceId: ${WORKSPACE_ID}
    setId: ${SET_ID}
    questionId: ${mistake.questionId}${
      mistake.kind === 'short' ? '\n    kind: short' : ''
    }
    prompt: '${mistake.prompt}'
    options:${mistake.options.length === 0 ? ' []' : `\n${mistake.options.map((option) => `      - '${option}'`).join('\n')}`}
    answer: ${mistake.answer}
    ${mistake.kind === 'short' ? `referenceAnswer: '${mistake.referenceAnswer ?? ''}'\n    ` : ''}explanation: '${mistake.explanation}'
    wrongCount: 1
    correctStreak: 0
    priority: 1
    intervalDays: ${mistake.intervalDays}
    stability: ${mistake.intervalDays}
    difficulty: 0.3
    due: '${mistake.due}'
    status: active
    createdAt: '${localDate(-20)}T09:00:00.000Z'
    updatedAt: '${mistake.due}T09:00:00.000Z'
    lastAnsweredAt: '${mistake.due}T09:00:00.000Z'`;
}

/**
 * Writes the mistake book. `entries` is exactly the active set the spec wants
 * the app to see, so the second launch can reset one record without touching
 * any product code.
 */
function mistakesBody(entries: MistakeFixture[]): string {
  const sections = entries.map((mistake) => {
    const answer =
      mistake.kind === 'short' ? `- 参考答案：${mistake.referenceAnswer ?? ''}\n` : '';
    return `## ${mistake.questionId} · ${mistake.prompt}

${answer}- 错误次数：1
- 优先级：1
- 间隔：${mistake.intervalDays} 天
- 下次复习 ${mistake.due}`;
  });
  return `---
type: qa
source: user
kind: practice-mistakes
workspaceId: ${WORKSPACE_ID}
updated: '${localDate(-1)}T09:00'
entries:
${entries.map(mistakeMetaBlock).join('\n')}
---

# ${WORKSPACE_ID} 错题本

${sections.join('\n\n')}
`;
}

/** `profile.md` with one model guess, so the page can show its 待确认 badge. */
function profileBody(): string {
  return `---
type: profile
source: user
items:
  - id: p-candidate
    category: constraints
    text: '${CANDIDATE_TEXT}'
    source: model
    confidence: candidate
    status: active
    origin: '对话 2026-11-20'
    createdAt: '2026-11-20T08:00:00.000Z'
    updatedAt: '2026-11-20T08:00:00.000Z'
---

# 个人档案

## 偏好与约束

- ${CANDIDATE_TEXT}（待确认）（来源：对话 2026-11-20）
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

/**
 * Closes the app but keeps the isolated environment, then starts a new process
 * against the same temp directories. `close()` would delete them, so this is
 * how a restart is expressed without leaving the harness.
 */
async function relaunch(launched: LaunchedStudyCoach): Promise<LaunchedStudyCoach> {
  await launched.app.close().catch(() => undefined);
  const next = await launchStudyCoach(launched.environment);
  return next;
}

async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByText(GREETING)).toBeVisible();
}

function navButton(page: Page, name: string) {
  return page.getByRole('navigation', { name: '主导航' }).getByRole('button', {
    name,
    exact: true
  });
}

async function openProfile(page: Page): Promise<void> {
  await navButton(page, '我的资料').click();
  await expect(page.getByText('对阿咲长期有效')).toBeVisible();
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '打开设置' }).click();
  await expect(page.getByText('个人、模型与数据')).toBeVisible();
}

function strictCheckbox(page: Page) {
  return page.locator('#settings-learning').getByRole('checkbox');
}

async function saveSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已保存' })).toBeVisible();
}

async function openPractice(page: Page): Promise<void> {
  await page.getByRole('button', { name: '全部工作区' }).click();
  await expect(page.locator('header').getByText('项目', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '练习', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭练习' })).toBeVisible();
}

/** Splits `mistakes.md` into one block per entry so a status can be located. */
function mistakeBlock(raw: string, questionId: string): string {
  const blocks = raw.split(/\n  - id: /).slice(1);
  return blocks.find((block) => block.includes(`questionId: ${questionId}`)) ?? '';
}

async function readStateFile(environment: IsolatedEnvironment): Promise<{
  settings: { strictMastery?: boolean } & Record<string, unknown>;
}> {
  return JSON.parse(await readFile(join(environment.userData, 'state.json'), 'utf8')) as {
    settings: { strictMastery?: boolean } & Record<string, unknown>;
  };
}

test.describe('我的资料 and 更严的掌握判定', () => {
  test('我的资料: add a fact, show a model guess as 待确认, persist across restart', async () => {
    const addedFact = '工作日每天最多安排 1 小时练习。';

    const { launched, environment } = await launchWith({
      'profile.md': profileBody()
    });
    let current = launched;
    const pageErrors: string[] = [];
    current.page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await waitForShell(current.page);
      await openProfile(current.page);

      // The seeded model guess is rendered as an unconfirmed candidate.
      const candidateRow = current.page.locator('li').filter({ hasText: CANDIDATE_TEXT });
      await expect(candidateRow).toHaveCount(1);
      await expect(candidateRow.getByText('待确认', { exact: true })).toBeVisible();
      await expect(candidateRow.getByText('模型推测', { exact: true })).toBeVisible();
      await expect(
        candidateRow.getByRole('button', { name: '确认', exact: true })
      ).toBeVisible();

      // Add one fact through the page's own form: category + text + 添加.
      await current.page.getByLabel('资料分类').selectOption('constraints');
      await current.page.getByLabel('新的资料').fill(addedFact);
      await current.page.getByRole('button', { name: '添加', exact: true }).click();

      const addedRow = current.page.locator('li').filter({ hasText: addedFact });
      await expect(addedRow).toHaveCount(1);
      await expect(addedRow.getByText('你提供', { exact: true })).toBeVisible();
      await expect(addedRow.getByText('手动添加', { exact: true })).toBeVisible();

      // The vault holds it as a confirmed user fact.
      const profileFile = await readFile(join(environment.vault, 'profile.md'), 'utf8');
      expect(profileFile).toContain(addedFact);
      expect(profileFile, 'a manually added fact is confirmed').toContain(
        'confidence: confirmed'
      );
      expect(profileFile, 'the model guess keeps its candidate state').toContain(
        'confidence: candidate'
      );

      // Restart the same isolated environment: the fact and the candidate
      // both come back from `profile.md`, not from renderer state.
      current = await relaunch(current);
      current.page.on('pageerror', (error) => pageErrors.push(error.message));
      await waitForShell(current.page);
      await openProfile(current.page);

      await expect(
        current.page.locator('li').filter({ hasText: addedFact })
      ).toHaveCount(1);
      await expect(
        current.page.locator('li').filter({ hasText: CANDIDATE_TEXT }).getByText('待确认', {
          exact: true
        })
      ).toBeVisible();

      expect(pageErrors).toEqual([]);
    } finally {
      await current.close();
    }
  });

  test('更严掌握判定: choice stays active under strict, short resolves, off persists after restart', async () => {
    const pastDue = localDate(-1);
    const choiceMistake: MistakeFixture = {
      id: 'pm-choice',
      questionId: 'q-choice',
      kind: 'choice',
      prompt: CHOICE_PROMPT,
      options: ['不会，仍算待复习', '会，直接算已掌握'],
      answer: 0,
      explanation: CHOICE_EXPLANATION,
      intervalDays: 4,
      due: pastDue
    };
    const shortMistake: MistakeFixture = {
      id: 'pm-short',
      questionId: 'q-short',
      kind: 'short',
      prompt: SHORT_PROMPT,
      options: [],
      answer: 0,
      referenceAnswer: SHORT_REFERENCE,
      explanation: '',
      intervalDays: 4,
      due: pastDue
    };

    const { launched, environment } = await launchWith({
      [`workspaces/${WORKSPACE_ID}/workspace.md`]: workspaceBody(
        WORKSPACE_NAME,
        '端到端验证更严的掌握判定'
      ),
      [`workspaces/${WORKSPACE_ID}/practice/sets/set-strict.md`]: practiceSetBody({
        id: SET_ID,
        title: '更严判定练习',
        subject: '学习方法',
        questions: [
          {
            id: 'q-choice',
            kind: 'choice',
            prompt: CHOICE_PROMPT,
            options: ['不会，仍算待复习', '会，直接算已掌握'],
            answer: 0,
            explanation: CHOICE_EXPLANATION
          },
          {
            id: 'q-short',
            kind: 'short',
            prompt: SHORT_PROMPT,
            referenceAnswer: SHORT_REFERENCE
          }
        ]
      }),
      [`workspaces/${WORKSPACE_ID}/practice/mistakes.md`]: mistakesBody([
        choiceMistake,
        shortMistake
      ])
    });
    let current = launched;
    const pageErrors: string[] = [];
    current.page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await waitForShell(current.page);

      // Settings: the opt-in starts off, gets ticked and saved to state.json.
      await openSettings(current.page);
      await expect(strictCheckbox(current.page)).not.toBeChecked();
      await strictCheckbox(current.page).check();
      await saveSettings(current.page);
      const savedOn = await readStateFile(environment);
      expect(savedOn.settings.strictMastery).toBe(true);

      // 返回对话 refreshes the shell's strict flag, then open 学习.
      await current.page.getByRole('button', { name: '返回对话' }).click();
      await openPractice(current.page);

      // Both seeded mistakes qualify as spaced and are due in the past.
      await expect(current.page.getByText('错题本 · 2 道待复习')).toBeVisible();
      await expect(current.page.getByText(STRICT_NOTE, { exact: true })).toBeVisible();

      // Choice question: a correct answer grows the interval but, under the
      // stricter rule, cannot resolve the mistake.
      await expect(
        current.page.getByRole('heading', { name: CHOICE_PROMPT })
      ).toBeVisible();
      await current.page
        .getByRole('button', { name: `A. ${choiceMistake.options[0]}` })
        .click();
      await current.page.getByRole('button', { name: '检查答案' }).click();
      await expect(current.page.getByText('回答正确').first()).toBeVisible();
      await expect(current.page.getByText(/已加入错题本/)).toBeVisible();
      await expect(current.page.getByText('错题本 · 2 道待复习')).toBeVisible();
      await expect(current.page.getByText(STRICT_NOTE, { exact: true })).toBeVisible();

      await current.page.getByRole('button', { name: '下一题' }).click();

      // Short question: free recall is the proof strict mode demands, so this
      // one resolves the mistake.
      await expect(
        current.page.getByRole('heading', { name: SHORT_PROMPT })
      ).toBeVisible();
      await current.page
        .getByLabel('用你自己的话回答')
        .fill('再说一次比只是认出来更难，也更接近真正掌握。');
      await current.page.getByRole('button', { name: '提交', exact: true }).click();
      await expect(
        current.page.getByText(`参考答案：${SHORT_REFERENCE}`).first()
      ).toBeVisible();
      await current.page.getByRole('button', { name: '答对了' }).click();
      await expect(current.page.getByText('回答正确').first()).toBeVisible();
      await expect(current.page.getByText('错题本 · 1 道待复习')).toBeVisible();
      await expect(current.page.getByText(STRICT_NOTE, { exact: true })).toBeVisible();
      await current.page.getByRole('button', { name: '关闭练习' }).click();

      // Vault: choice still active, short resolved with the 已掌握 status line.
      const mistakesPath = join(
        environment.vault,
        'workspaces',
        WORKSPACE_ID,
        'practice',
        'mistakes.md'
      );
      const afterStrict = await readFile(mistakesPath, 'utf8');
      expect(mistakeBlock(afterStrict, 'q-choice')).toContain('status: active');
      expect(mistakeBlock(afterStrict, 'q-short')).toContain('status: resolved');
      expect(afterStrict, 'the short mistake is the mastered one').toContain('- 已掌握');

      // Untick in 设置 and save: the flag disappears from state.json entirely.
      await openSettings(current.page);
      await expect(strictCheckbox(current.page)).toBeChecked();
      await strictCheckbox(current.page).uncheck();
      await saveSettings(current.page);
      const savedOff = await readStateFile(environment);
      expect(savedOff.settings.strictMastery).toBeUndefined();

      // Give the choice mistake the same spaced, overdue state again so the
      // second launch isolates exactly one variable: the persisted flag.
      await writeVaultFile(
        environment.vault,
        `workspaces/${WORKSPACE_ID}/practice/mistakes.md`,
        mistakesBody([choiceMistake])
      );

      current = await relaunch(current);
      current.page.on('pageerror', (error) => pageErrors.push(error.message));
      await waitForShell(current.page);

      // The setting came back off on both the settings page and disk.
      await openSettings(current.page);
      await expect(strictCheckbox(current.page)).not.toBeChecked();
      const reloaded = await readStateFile(environment);
      expect(reloaded.settings.strictMastery).toBeUndefined();
      await current.page.getByRole('button', { name: '返回对话' }).click();

      await openPractice(current.page);
      await expect(current.page.getByText('错题本 · 1 道待复习')).toBeVisible();
      await expect(current.page.getByText(STRICT_NOTE, { exact: true })).toHaveCount(0);

      // A fresh spaced choice-correct resolves as it did before the option.
      await expect(
        current.page.getByRole('heading', { name: CHOICE_PROMPT })
      ).toBeVisible();
      await current.page
        .getByRole('button', { name: `A. ${choiceMistake.options[0]}` })
        .click();
      await current.page.getByRole('button', { name: '检查答案' }).click();
      await expect(current.page.getByText('回答正确').first()).toBeVisible();
      await expect(current.page.getByText(/已加入错题本/)).toHaveCount(0);
      await expect(current.page.getByText(/错题本 ·/)).toHaveCount(0);

      const afterRestart = await readFile(mistakesPath, 'utf8');
      expect(mistakeBlock(afterRestart, 'q-choice')).toContain('status: resolved');
      expect(afterRestart).toContain('- 已掌握');

      expect(pageErrors).toEqual([]);
    } finally {
      await current.close();
    }
  });
});