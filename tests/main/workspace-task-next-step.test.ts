import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import {
  parseTaskFile,
  serializeTaskFile
} from '../../src/main/workspace/records/tasks';
import { MAX_TASK_NEXT_STEP_LENGTH, normalizeTaskNextStep } from '../../src/shared/workspace';
import { formatLocalDate } from '../../src/shared/date';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workspace-task-next-step-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function taskFilePath(workspaceId: string, date: string): string {
  return join(root, 'workspaces', workspaceId, 'tasks', `${date}.md`);
}

test('the normalizer folds to one line, trims, truncates at 80 code points', () => {
  expect(normalizeTaskNextStep('  先把例题抄一遍  ')).toBe('先把例题抄一遍');
  // 单行: line breaks fold into spaces.
  expect(normalizeTaskNextStep('先抄例题\n再做错题')).toBe('先抄例题 再做错题');
  expect(normalizeTaskNextStep('先抄例题\r\n再做错题')).toBe('先抄例题 再做错题');
  // Empty and blank read as not set.
  expect(normalizeTaskNextStep('')).toBeUndefined();
  expect(normalizeTaskNextStep('   \n\t  ')).toBeUndefined();
  // Exactly 80 code points embeds unchanged; 81 cuts to 80.
  const exact = '一'.repeat(MAX_TASK_NEXT_STEP_LENGTH);
  expect(normalizeTaskNextStep(exact)).toBe(exact);
  expect(normalizeTaskNextStep(`${exact}一`)).toBe(exact);
  // Code-point slicing never splits an astral character.
  const astral = '𠮷'.repeat(81);
  expect([...(normalizeTaskNextStep(astral) ?? '')]).toHaveLength(80);
});

test('createTask round-trips the next step through the vault', async () => {
  const service = createWorkspaceService(root);
  const today = formatLocalDate(new Date());
  const created = await service.createTask({
    workspaceId: 'kaoyan',
    title: '极限基础',
    subject: '数学',
    durationMin: 45,
    acceptance: '完成 10 题',
    nextStep: '  先翻到教材第 42 页  '
  });
  expect(created.nextStep).toBe('先翻到教材第 42 页');

  // The step is stored in the frontmatter, not the checklist line.
  const raw = await fs.readFile(taskFilePath('kaoyan', today), 'utf8');
  expect(raw).toContain('nextStep: 先翻到教材第 42 页');
  expect(parseTaskFile(raw).find((entry) => entry.id === created.id)?.nextStep).toBe(
    '先翻到教材第 42 页'
  );

  const reopened = await createWorkspaceService(root).getWorkspaceSnapshot('kaoyan');
  expect(reopened.tasks.find((entry) => entry.id === created.id)?.nextStep).toBe(
    '先翻到教材第 42 页'
  );
});

test('updateWorkspaceTask sets, replaces, truncates and clears the next step (验收 21)', async () => {
  const service = createWorkspaceService(root);
  const today = formatLocalDate(new Date());
  const created = await service.createTask({
    workspaceId: 'kaoyan',
    title: '真题',
    subject: '数学',
    durationMin: 60,
    acceptance: '一套'
  });
  expect(created.nextStep).toBeUndefined();

  const set = await service.updateWorkspaceTask({
    taskId: created.id,
    nextStep: '先做选择错题'
  });
  expect(set.nextStep).toBe('先做选择错题');

  const replaced = await service.updateWorkspaceTask({
    taskId: created.id,
    nextStep: '先抄例题\n再对答案'
  });
  expect(replaced.nextStep).toBe('先抄例题 再对答案');

  // Overlong input truncates instead of rejecting.
  const truncated = await service.updateWorkspaceTask({
    taskId: created.id,
    nextStep: '一'.repeat(100)
  });
  expect([...(truncated.nextStep ?? '')]).toHaveLength(MAX_TASK_NEXT_STEP_LENGTH);

  // null clears; an empty string clears too — the key is deleted, never ''.
  await service.updateWorkspaceTask({ taskId: created.id, nextStep: null });
  const raw = await fs.readFile(taskFilePath('kaoyan', today), 'utf8');
  expect(parseTaskFile(raw).find((entry) => entry.id === created.id)?.nextStep).toBeUndefined();
  expect(raw).not.toContain('nextStep');

  await service.updateWorkspaceTask({ taskId: created.id, nextStep: '再记一步' });
  const emptyClears = await service.updateWorkspaceTask({ taskId: created.id, nextStep: '   ' });
  expect(emptyClears.nextStep).toBeUndefined();
});

test('a legacy task without a next step keeps its bytes (零迁移)', async () => {
  const service = createWorkspaceService(root);
  const today = formatLocalDate(new Date());
  await service.createTask({
    workspaceId: 'kaoyan',
    title: '背单词',
    subject: '英语',
    durationMin: 20,
    acceptance: '30 个'
  });

  const raw = await fs.readFile(taskFilePath('kaoyan', today), 'utf8');
  expect(raw).not.toContain('nextStep');
  // Parsing then serializing adds no nextStep key and changes nothing else.
  expect(serializeTaskFile(today, parseTaskFile(raw))).toBe(raw);
});

test('a task file with a next step survives parse and serialize unchanged', async () => {
  const service = createWorkspaceService(root);
  const today = formatLocalDate(new Date());
  await service.createTask({
    workspaceId: 'kaoyan',
    title: '复盘',
    subject: '数学',
    durationMin: 15,
    acceptance: '',
    nextStep: '把今天的错题收进册子'
  });

  const raw = await fs.readFile(taskFilePath('kaoyan', today), 'utf8');
  const tasks = parseTaskFile(raw);
  expect(tasks.find((entry) => entry.title === '复盘')?.nextStep).toBe('把今天的错题收进册子');
  expect(serializeTaskFile(today, tasks)).toBe(raw);
});

test('a hand-edited junk next step reads as not set', async () => {
  const today = formatLocalDate(new Date());
  const dir = taskFilePath('kaoyan', today);
  await fs.mkdir(join(dir, '..'), { recursive: true });
  await fs.writeFile(
    dir,
    [
      '---',
      'type: plan',
      "source: 'user'",
      `date: ${today}`,
      'tasks:',
      '  - id: t1',
      '    title: 手编任务',
      '    subject: 数学',
      '    durationMin: 30',
      "    acceptance: ''",
      '    status: pending',
      '    nextStep: ""',
      '---',
      '',
      `# ${today} 任务`,
      '',
      '- [ ] 手编任务',
      ''
    ].join('\n'),
    'utf8'
  );
  const tasks = parseTaskFile(await fs.readFile(dir, 'utf8'));
  expect(tasks.find((entry) => entry.id === 't1')?.nextStep).toBeUndefined();
});
