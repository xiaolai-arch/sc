#!/usr/bin/env node
/**
 * Real-machine acceptance for the editing modules:
 * tasks, reminders, memories, project edit, plan edit, topic merge,
 * review backfill and practice-set creation.
 *
 * It copies the real vault into a temporary directory and launches the built
 * Electron app with a temporary userData profile. The real vault is never
 * written; the copy is deleted after a successful run unless KEEP=1.
 *
 * Usage:
 *   npm run build
 *   node scripts/acceptance/crud.cjs
 *
 * Optional environment variables:
 *   ASAKI_ACCEPTANCE_VAULT      real vault path (default ~/Documents/StudyCoachVault)
 *   ASAKI_ACCEPTANCE_WORKSPACE  workspace id to exercise (default: first one)
 *   ASAKI_ACCEPTANCE_MERGE_TARGET  existing topic to merge into (default: LangChain or first)
 *   ASAKI_ACCEPTANCE_SHOTS      screenshot directory (default: <tmp>/asaki-accept-shots)
 *   ASAKI_ACCEPTANCE_KEEP=1     keep the temporary vault/profile after success
 */
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const REAL_VAULT =
  process.env.ASAKI_ACCEPTANCE_VAULT ||
  path.join(os.homedir(), 'Documents', 'StudyCoachVault');
const SHOTS =
  process.env.ASAKI_ACCEPTANCE_SHOTS || path.join(os.tmpdir(), 'asaki-accept-shots');
const RUN = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12);
const TODAY = localDate(new Date());
const REVIEW_DATE = localDate(addDays(new Date(), -7));

function localDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function pass(name, detail = '') {
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, error) {
  console.log(`FAIL ${name} — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
async function step(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

function frontmatterValue(raw, key) {
  const match = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(raw);
  if (!match) return null;
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

async function discoverWorkspace(vault) {
  const dir = path.join(vault, 'workspaces');
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const ids = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  if (ids.length === 0) throw new Error(`vault 里没有工作区：${dir}`);
  const preferred = process.env.ASAKI_ACCEPTANCE_WORKSPACE;
  const id = preferred && ids.includes(preferred) ? preferred : ids[0];
  const raw = await fs.readFile(path.join(dir, id, 'workspace.md'), 'utf8');
  const name = frontmatterValue(raw, 'name');
  if (!name) throw new Error(`工作区缺少 name：${id}`);
  const planEntries = await fs
    .readdir(path.join(dir, id, 'plans'), { withFileTypes: true })
    .catch(() => []);
  const planFile = planEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()[0];
  return { id, name, planFile: planFile ?? null };
}

async function readTopics(vault) {
  const dir = path.join(vault, 'knowledge', 'topics');
  const files = (await fs.readdir(dir).catch(() => [])).filter((file) => file.endsWith('.md'));
  const topics = [];
  for (const file of files.sort()) {
    const raw = await fs.readFile(path.join(dir, file), 'utf8').catch(() => null);
    if (!raw) continue;
    const name = frontmatterValue(raw, 'name');
    const id = frontmatterValue(raw, 'id');
    if (name && id) topics.push({ file, name, id, raw });
  }
  return topics;
}

async function findTopicByName(vault, name) {
  const topics = await readTopics(vault);
  return topics.find((topic) => topic.name === name) ?? null;
}

async function makeEnvironment() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'asaki-accept-'));
  const userData = path.join(tmp, 'user-data');
  const vault = path.join(tmp, 'vault');
  await fs.mkdir(userData, { recursive: true });
  await fs.cp(REAL_VAULT, vault, { recursive: true });
  await fs.writeFile(
    path.join(userData, 'state.json'),
    `${JSON.stringify({ onboarded: true, settings: { vaultPath: vault } }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
  return { tmp, userData, vault };
}

async function main() {
  await fs.access(path.join(ROOT, 'out', 'main', 'index.js')).catch(() => {
    throw new Error('找不到 out/main/index.js，请先运行 npm run build。');
  });
  await fs.access(REAL_VAULT).catch(() => {
    throw new Error(
      `找不到真实 vault：${REAL_VAULT}\n用 ASAKI_ACCEPTANCE_VAULT 指向你的 vault。`
    );
  });

  const sourceWorkspace = await discoverWorkspace(REAL_VAULT);
  const topics = await readTopics(REAL_VAULT);
  const preferredTarget = process.env.ASAKI_ACCEPTANCE_MERGE_TARGET;
  const existingTarget =
    topics.find((topic) => topic.name === preferredTarget) ??
    topics.find((topic) => topic.name === 'LangChain') ??
    topics[0] ??
    null;

  await fs.rm(SHOTS, { recursive: true, force: true });
  await fs.mkdir(SHOTS, { recursive: true });
  const env = await makeEnvironment();

  const childEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/(?:API_KEY|TOKEN|SECRET|PASSWORD)$/i.test(key)) continue;
    childEnv[key] = value;
  }
  childEnv.STUDY_COACH_USER_DATA_DIR = env.userData;
  childEnv.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env: childEnv });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1600, 1028);
  });
  await page.setViewportSize({ width: 1600, height: 1028 });
  await page.waitForTimeout(800);

  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));
  console.log(`workspace: ${sourceWorkspace.id} (${sourceWorkspace.name})`);
  console.log(`vault copy: ${env.vault}`);
  console.log(`viewport: ${viewport.width}x${viewport.height}`);

  async function shot(name) {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), scale: 'css' });
  }

  async function nav(label) {
    await page
      .getByRole('navigation', { name: '主导航' })
      .getByRole('button', { name: label, exact: true })
      .click();
  }

  async function openProject() {
    const sidebar = page.locator('aside[aria-label="导航"]');
    await sidebar
      .getByRole('button', { name: sourceWorkspace.name, exact: true })
      .click();
    await sidebar.getByRole('button', { name: '全部工作区' }).click();
    const select = page.getByLabel('切换项目');
    await select.waitFor({ state: 'visible', timeout: 15_000 });
    await select.selectOption({ label: sourceWorkspace.name });
    await page.getByRole('region', { name: '计划' }).waitFor({ timeout: 15_000 });
  }

  async function readVault(...segments) {
    return fs.readFile(path.join(env.vault, ...segments), 'utf8');
  }

  /** Deleting the last task removes its day file, so absence counts as deleted. */
  async function readVaultIfExists(...segments) {
    return fs.readFile(path.join(env.vault, ...segments), 'utf8').catch((error) => {
      if (error && error.code === 'ENOENT') return '';
      throw error;
    });
  }

  /** The practice overlay covers the nav; close it before leaving the page. */
  async function closePracticeIfOpen() {
    const close = page.getByRole('button', { name: '关闭练习' });
    if (await close.isVisible().catch(() => false)) await close.click();
  }

  try {
    const taskTitle = `LangChain 工具调用练习（验收 ${RUN}）`;
    const editedTaskTitle = `工具调用练习（验收 ${RUN}）`;
    const reminderLabel = `整理今日卡点（验收 ${RUN}）`;
    const editedReminderLabel = `复盘当日卡点（验收 ${RUN}）`;
    const memoryText = `早上更适合学新东西，晚上更适合复盘（验收 ${RUN}）`;
    const description = `把学习路径落在 Java/Spring 生态，最终交付可演示的 Agent 项目（验收 ${RUN}）。`;
    const sourceTopicName = `LangChain 表达式（验收 ${RUN}）`;
    const practiceTitle = `工具调用基础 1 题（验收 ${RUN}）`;
    const renamedPracticeTitle = `工具调用进阶 1 题（验收 ${RUN}）`;
    const editedPracticePrompt = `改过的题干：注册工具先提供什么？（验收 ${RUN}）`;
    const recordTitle = `工具调用踩坑记录（验收 ${RUN}）`;
    const editedRecordTitle = `工具调用踩坑复盘（验收 ${RUN}）`;
    const reviewCompleted = `跑通了 LangChain 的 tool calling demo（验收 ${RUN}）`;
    const reviewStuck = `工具参数校验总是漏字段（验收 ${RUN}）`;

    // ---------------------------------------------------------------- tasks
    await step('task create/edit/delete', async () => {
      await openProject();
      await page.getByRole('button', { name: '新增任务', exact: true }).click();
      const form = page.getByRole('form', { name: '新增任务' });
      await form.getByLabel('新任务标题').fill(taskTitle);
      await form.getByLabel('新任务科目').fill('Agent');
      await form.getByLabel('新任务时长').fill('');
      await form.getByLabel('新任务时长').type('25');
      await form.getByRole('button', { name: '保存任务' }).click();

      const plan = page.getByRole('region', { name: '计划' });
      await plan.getByText(taskTitle, { exact: true }).waitFor({ timeout: 15_000 });
      const taskFile = ['workspaces', sourceWorkspace.id, 'tasks', `${TODAY}.md`];
      const createdFile = await readVault(...taskFile);
      if (!createdFile.includes(taskTitle)) throw new Error('任务未写入 vault');
      if (!/durationMin: 25/.test(createdFile)) throw new Error('任务时长未写入 vault');

      await plan.getByRole('button', { name: `编辑任务：${taskTitle}` }).click();
      const editForm = page.getByRole('form', { name: `编辑任务：${taskTitle}` });
      await editForm.getByLabel('编辑任务标题').fill(editedTaskTitle);
      await editForm.getByRole('button', { name: '保存修改' }).click();
      await plan.getByText(editedTaskTitle, { exact: true }).waitFor({ timeout: 15_000 });
      const editedFile = await readVault(...taskFile);
      if (!editedFile.includes(editedTaskTitle)) throw new Error('编辑未写入 vault');

      await plan.getByRole('button', { name: `编辑任务：${editedTaskTitle}` }).click();
      await shot('task-editing');
      await page
        .getByRole('form', { name: `编辑任务：${editedTaskTitle}` })
        .getByRole('button', { name: '取消' })
        .click();

      await plan.getByRole('button', { name: `删除任务：${editedTaskTitle}` }).click();
      await plan
        .getByRole('button', { name: `确认删除任务：${editedTaskTitle}` })
        .click();
      await plan.getByText(editedTaskTitle, { exact: true }).waitFor({ state: 'detached' });
      const deletedFile = await readVaultIfExists(...taskFile);
      if (deletedFile.includes(editedTaskTitle)) throw new Error('删除未写入 vault');
      pass('task vault checks', 'created, edited and deleted on disk');
    });

    // ------------------------------------------------------------ reminders
    await step('reminder create/edit/delete', async () => {
      await nav('提醒');
      await page.getByLabel('提醒时间').fill('09:30');
      await page.getByLabel('提醒内容').fill(reminderLabel);
      await page.getByLabel('提醒重复').selectOption('weekdays');
      await page.getByRole('button', { name: '添加提醒' }).click();
      await page.getByText(reminderLabel, { exact: false }).first().waitFor({
        timeout: 15_000
      });

      const reminderFile = ['reminders.md'];
      const created = await readVault(...reminderFile);
      if (!created.includes(reminderLabel)) throw new Error('提醒未写入 reminders.md');

      await page.getByRole('button', { name: `编辑提醒：${reminderLabel}` }).click();
      const form = page.getByRole('form', { name: `编辑提醒：${reminderLabel}` });
      await form.getByLabel('编辑提醒时间').fill('10:15');
      await form.getByLabel('编辑提醒内容').fill(editedReminderLabel);
      await form.getByLabel('编辑提醒重复').selectOption('weekend');
      await shot('reminder-editing');
      await form.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByText(editedReminderLabel, { exact: false }).first().waitFor({
        timeout: 15_000
      });
      const edited = await readVault(...reminderFile);
      if (!edited.includes(editedReminderLabel)) throw new Error('提醒编辑未写入');
      if (!/^\s*- 0\s*$/m.test(edited) || !/^\s*- 6\s*$/m.test(edited)) {
        throw new Error('周末重复未写入');
      }

      await page.getByRole('button', { name: `删除提醒：${editedReminderLabel}` }).click();
      await page
        .getByRole('button', { name: `确认删除提醒：${editedReminderLabel}` })
        .click();
      await page.getByText(new RegExp(escapeRegExp(editedReminderLabel))).waitFor({
        state: 'detached'
      });
      const deleted = await readVault(...reminderFile);
      if (deleted.includes(editedReminderLabel)) throw new Error('提醒删除未写入');
      pass('reminder vault checks', 'created, edited and deleted on disk');
    });

    // -------------------------------------------------------------- memory
    await step('memory create', async () => {
      await nav('记忆');
      await page.getByRole('button', { name: '新增记忆' }).click();
      const form = page.getByRole('form', { name: '新增记忆' });
      const workspaceSelect = form.getByLabel('新记忆工作区');
      if ((await workspaceSelect.count()) > 0) {
        await workspaceSelect.selectOption({ label: sourceWorkspace.name });
      }
      await form.getByLabel('新记忆内容').fill(memoryText);
      await form.getByLabel('新记忆类型').selectOption('preference');
      await shot('memory-create');
      await form.getByRole('button', { name: '保存新记忆' }).click();
      await page.getByText(memoryText, { exact: false }).first().waitFor({ timeout: 15_000 });
      const memory = await readVault('workspaces', sourceWorkspace.id, 'memory.md');
      if (!memory.includes(memoryText)) throw new Error('记忆未写入 memory.md');
      pass('memory vault checks', 'written to workspace memory.md');
    });

    // ------------------------------------------------------------- project
    await step('project edit', async () => {
      await openProject();
      const before = await readVault('workspaces', sourceWorkspace.id, 'workspace.md');
      await page.getByRole('button', { name: '编辑项目' }).click();
      const form = page.getByRole('form', { name: '编辑项目' });
      await form.getByLabel('项目描述').fill(description);
      await shot('project-edit');
      await form.getByRole('button', { name: '保存项目' }).click();
      await page.getByRole('form', { name: '编辑项目' }).waitFor({ state: 'detached' });
      const after = await readVault('workspaces', sourceWorkspace.id, 'workspace.md');
      if (!after.includes(description)) throw new Error('项目描述未写入 workspace.md');
      if (after === before) throw new Error('项目描述没有变化');
      pass('project vault checks', 'description updated on disk');
    });

    // ---------------------------------------------------------------- plan
    await step('plan edit', async () => {
      if (!sourceWorkspace.planFile) throw new Error('工作区里没有长期计划，跳过前请先建一个');
      await nav('长期计划');
      const detail = page.getByRole('region', { name: '计划详情' });
      await detail.waitFor({ timeout: 30_000 });
      const planPath = ['workspaces', sourceWorkspace.id, 'plans', sourceWorkspace.planFile];
      const before = await readVault(...planPath);
      const goalLine = /^goal:.*$/m.exec(before)?.[0];
      await detail.getByRole('button', { name: '编辑计划' }).click();
      const form = page.getByRole('form', { name: '编辑计划信息' });
      await form.getByLabel('编辑计划每周投入').fill('12');
      await shot('plan-edit');
      await form.getByRole('button', { name: '保存计划信息' }).click();
      await page.getByRole('form', { name: '编辑计划信息' }).waitFor({ state: 'detached' });
      const after = await readVault(...planPath);
      if (!/weeklyHours: 12/.test(after)) throw new Error('每周投入未写入 plan 文件');
      if (goalLine && !after.includes(goalLine)) throw new Error('编辑计划时目标丢失');
      pass('plan vault checks', 'weeklyHours updated, goal preserved');
    });

    // ----------------------------------------------------------- knowledge
    await step('knowledge topic merge', async () => {
      await nav('知识库');
      let target = existingTarget;
      if (!target) {
        const fallbackName = `验收合并目标 ${RUN}`;
        await page.getByRole('button', { name: '新增主题' }).click();
        const create = page.getByRole('dialog', { name: '新增知识主题' });
        await create.getByLabel('主题名称').fill(fallbackName);
        await create
          .getByLabel('所属工作区')
          .selectOption({ label: sourceWorkspace.name });
        await create.getByRole('button', { name: '保存', exact: true }).click();
        await page.getByRole('heading', { name: fallbackName }).waitFor({
          timeout: 15_000
        });
        target = await findTopicByName(env.vault, fallbackName);
        if (!target) throw new Error('新建的合并目标主题未写入 vault');
      }

      await page.getByRole('button', { name: '新增主题' }).click();
      const create = page.getByRole('dialog', { name: '新增知识主题' });
      await create.getByLabel('主题名称').fill(sourceTopicName);
      await create.getByLabel('所属工作区').selectOption({ label: sourceWorkspace.name });
      await create.getByLabel('摘要').fill(`LCEL 的管道组合还没系统练过（验收 ${RUN}）`);
      await create.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByRole('heading', { name: sourceTopicName }).waitFor({
        timeout: 15_000
      });

      const noteBody = `LCEL 用 \`|\` 把提示词、模型和解析器串起来（验收 ${RUN}）。`;
      await page.getByRole('button', { name: '编辑', exact: true }).click();
      const editor = page.getByLabel('知识笔记');
      await editor.fill(noteBody);
      await page.getByRole('heading', { name: sourceTopicName }).click();
      await page.getByText('已保存', { exact: true }).waitFor({ timeout: 15_000 });

      const view = page.getByRole('group', { name: '知识内容视图' });
      await view.getByRole('button', { name: '图谱' }).click();
      await page.getByRole('region', { name: '知识图谱' }).waitFor({ timeout: 15_000 });
      await shot('knowledge-graph');
      await view.getByRole('button', { name: '笔记' }).click();
      await page.getByRole('heading', { name: sourceTopicName }).waitFor({
        timeout: 15_000
      });

      await page
        .getByRole('button', { name: `合并 ${sourceTopicName}` })
        .click();
      const merge = page.getByRole('dialog', { name: '合并知识主题' });
      await merge.getByLabel('合并到').selectOption({ label: target.name });
      await shot('knowledge-merge');
      await merge.getByRole('button', { name: '合并', exact: true }).click();
      await page.getByRole('heading', { name: target.name, exact: true }).waitFor({
        timeout: 15_000
      });

      const mergedTopic = await readVault('knowledge', 'topics', target.file);
      if (!mergedTopic.includes(sourceTopicName)) throw new Error('别名未写入目标主题');
      const mergedNote = await readVault('knowledge', 'notes', `${target.id}.md`);
      if (!mergedNote.includes(noteBody.slice(0, 20))) throw new Error('源笔记正文未合并');
      pass('merge vault checks', 'alias and note kept in target');
    });

    // -------------------------------------------------------------- review
    await step('review backfill', async () => {
      await nav('复盘');
      await page.getByRole('button', { name: '补录复盘' }).click();
      const dialog = page.getByRole('dialog', { name: '补录复盘' });
      await dialog.getByLabel('日期').fill(REVIEW_DATE);
      await dialog.getByLabel('工作区').selectOption({ label: sourceWorkspace.name });
      await dialog.getByLabel('完成').fill(reviewCompleted);
      await dialog.getByLabel('卡点').fill(reviewStuck);
      await dialog.getByLabel('明天').fill(`补齐参数 schema，加两个测试（验收 ${RUN}）`);
      await shot('review-backfill');
      await dialog.getByRole('button', { name: '保存', exact: true }).click();
      await page.getByRole('dialog', { name: '补录复盘' }).waitFor({ state: 'detached' });
      const review = await readVault(
        'workspaces',
        sourceWorkspace.id,
        'reviews',
        `${REVIEW_DATE}.md`
      );
      if (!review.includes(reviewCompleted)) throw new Error('补录复盘未写入');
      if (!review.includes(reviewStuck)) throw new Error('卡点未写入');
      pass('review vault checks', `workspace review file written for ${REVIEW_DATE}`);
    });

    // ------------------------------------------------------------ practice
    await step('practice set create', async () => {
      await openProject();
      await page.getByRole('button', { name: '练习', exact: true }).click();
      await page.getByRole('button', { name: '新建练习集' }).click();
      const dialog = page.getByRole('dialog', { name: '新建练习集' });
      await dialog.getByLabel('标题').fill(practiceTitle);
      await dialog.getByLabel('科目').fill('Agent');
      await dialog.getByLabel('第 1 题题干').fill('给 Agent 注册工具时，最先要提供什么？');
      await dialog.getByLabel('第 1 题选项 1').fill('工具名称和参数 schema');
      await dialog.getByLabel('第 1 题选项 2').fill('模型的温度参数');
      await dialog.getByLabel('第 1 题正确答案').selectOption('0');
      await dialog.getByLabel('第 1 题解析').fill('名称用于选择工具，schema 用于校验参数。');
      await shot('practice-create');
      await dialog.getByRole('button', { name: '创建练习集' }).click();
      await dialog.waitFor({ state: 'detached', timeout: 15_000 });
      await page.getByText('给 Agent 注册工具时，最先要提供什么？').waitFor({
        timeout: 15_000
      });
      const setsDir = path.join(
        env.vault,
        'workspaces',
        sourceWorkspace.id,
        'practice',
        'sets'
      );
      const files = await fs.readdir(setsDir);
      let found = false;
      for (const file of files) {
        const raw = await fs.readFile(path.join(setsDir, file), 'utf8');
        if (raw.includes(practiceTitle)) found = true;
      }
      if (!found) throw new Error('练习集未写入 practice/sets');
      pass('practice vault checks', 'set written under practice/sets');
    });

    await step('practice set rename/delete', async () => {
      await closePracticeIfOpen();
      await openProject();
      await page.getByRole('button', { name: '练习', exact: true }).click();
      await page
        .getByRole('button', { name: new RegExp(`^${escapeRegExp(practiceTitle)}`) })
        .first()
        .click();

      await page
        .getByRole('button', { name: `编辑练习集：${practiceTitle}` })
        .click();
      const editDialog = page.getByRole('dialog', { name: '编辑练习集' });
      await editDialog.getByLabel('标题').fill(renamedPracticeTitle);
      await editDialog.getByLabel('第 1 题题干').fill(editedPracticePrompt);
      await shot('practice-edit');
      await editDialog.getByRole('button', { name: '保存修改', exact: true }).click();
      await page
        .getByRole('button', { name: `编辑练习集：${renamedPracticeTitle}` })
        .waitFor({ timeout: 15_000 });

      const setsDir = path.join(
        env.vault,
        'workspaces',
        sourceWorkspace.id,
        'practice',
        'sets'
      );
      let renamedOnDisk = false;
      for (const file of await fs.readdir(setsDir)) {
        const raw = await fs.readFile(path.join(setsDir, file), 'utf8');
        if (raw.includes(renamedPracticeTitle) && raw.includes(editedPracticePrompt)) {
          renamedOnDisk = true;
        }
      }
      if (!renamedOnDisk) throw new Error('练习集编辑未写入 practice/sets');

      await page
        .getByRole('button', { name: `删除练习集：${renamedPracticeTitle}` })
        .click();
      await page
        .getByRole('button', { name: `确认删除练习集：${renamedPracticeTitle}` })
        .click();
      await page
        .getByRole('button', { name: new RegExp(`^${escapeRegExp(renamedPracticeTitle)}`) })
        .waitFor({ state: 'detached', timeout: 15_000 });

      let stillOnDisk = false;
      for (const file of await fs.readdir(setsDir)) {
        const raw = await fs.readFile(path.join(setsDir, file), 'utf8');
        if (raw.includes(renamedPracticeTitle)) stillOnDisk = true;
      }
      if (stillOnDisk) throw new Error('删除后练习集仍在 practice/sets');
      await closePracticeIfOpen();
      pass('practice set checks', 'renamed and deleted on disk');
    });

    await step('note create/edit/delete', async () => {
      await closePracticeIfOpen();
      await openProject();
      const records = page.getByRole('region', { name: '记录' });
      await records.getByRole('button', { name: '写一条记录' }).click();
      await records.getByLabel('记录标题').fill(recordTitle);
      await records.getByLabel('记录正文').fill(`工具 schema 漏字段，先补再测（验收 ${RUN}）。`);
      await records.getByRole('button', { name: '保存记录' }).click();
      await records.getByText(recordTitle, { exact: true }).waitFor({ timeout: 15_000 });

      const notesDir = path.join(
        env.vault,
        'workspaces',
        sourceWorkspace.id,
        'notes'
      );
      let noteOnDisk = false;
      for (const file of await fs.readdir(notesDir)) {
        const raw = await fs.readFile(path.join(notesDir, file), 'utf8');
        if (raw.includes(recordTitle)) noteOnDisk = true;
      }
      if (!noteOnDisk) throw new Error('记录未写入 notes');

      await records.getByRole('button', { name: `编辑记录：${recordTitle}` }).click();
      await records.getByLabel('编辑记录标题').fill(editedRecordTitle);
      await records
        .getByLabel('编辑记录正文')
        .fill(`补上了参数 schema 校验（验收 ${RUN}）。`);
      await shot('note-edit');
      await records.getByRole('button', { name: '保存修改' }).click();
      await records.getByText(editedRecordTitle, { exact: true }).waitFor({
        timeout: 15_000
      });

      let editedOnDisk = false;
      for (const file of await fs.readdir(notesDir)) {
        const raw = await fs.readFile(path.join(notesDir, file), 'utf8');
        if (raw.includes(editedRecordTitle)) editedOnDisk = true;
      }
      if (!editedOnDisk) throw new Error('编辑未写入 notes');

      await records
        .getByRole('button', { name: `删除记录：${editedRecordTitle}` })
        .click();
      await shot('note-delete');
      await records
        .getByRole('button', { name: `确认删除记录：${editedRecordTitle}` })
        .click();
      await records.getByText(editedRecordTitle, { exact: true }).waitFor({
        state: 'detached',
        timeout: 15_000
      });

      let noteStillOnDisk = false;
      for (const file of await fs.readdir(notesDir)) {
        const raw = await fs.readFile(path.join(notesDir, file), 'utf8');
        if (raw.includes(editedRecordTitle)) noteStillOnDisk = true;
      }
      if (noteStillOnDisk) throw new Error('删除后记录仍在 notes');
      pass('note vault checks', 'record created, edited and deleted on disk');
    });

    await shot('final-state');
  } finally {
    console.log(`screenshots: ${SHOTS}`);
    await app.close().catch(() => {});
    const keep =
      process.env.ASAKI_ACCEPTANCE_KEEP === '1' || (process.exitCode ?? 0) !== 0;
    if (keep) {
      console.log(`kept temporary data: ${env.tmp}`);
    } else {
      await fs.rm(env.tmp, { recursive: true, force: true });
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
