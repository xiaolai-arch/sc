import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { createAppContext } from '../../src/main/context';
import { InMemorySecretStore } from '../../src/main/settings/secret-store';
import {
  serializeCommitmentsFile,
  type Commitment
} from '../../src/main/commitments/records';
import { commitmentsFile } from '../../src/main/workspace/paths';

/**
 * iter30 · M2 回归用例（基线 master c73e721）
 *
 * 任务书里的 M2：「关闭检查的项目里的承诺不进次日晨检」。
 *
 * 实测结论：在 c73e721 上 M2 **已经不复现**。晨检取承诺的入口
 * `src/main/context.ts` `readDueCommitment()` 先把 `checkIn === 'off'` 的项目
 * 收成集合，再用 `entry.workspaceId === undefined || !off.has(entry.workspaceId)`
 * 过滤。所以下面第一条是**绿色回归用例**（守住主路径，防止以后又漏），
 * 不是预期失败用例。
 *
 * 但同一批数据在**周复盘**里仍然会漏：`readWeeklyHonest()` 过滤了项目本身，
 * 却把 `commitments.list()` 全量映射成周复盘用的形状，映射时丢掉了
 * `workspaceId`，`weekly-honest.ts` 的 `accountabilityLine` 也就无法再按项目
 * 排除。结果是：用户明确关掉检查的项目，里面的承诺在周复盘里仍会被点名
 * （「你说过要做「X」，你告诉过 小林 的时间是 …」）。第二条 `test.fails`
 * 固定这个缺陷，等 sc-build 决定是否在 iter30 一起修。
 */

const NOW = new Date(2026, 10, 22, 9, 0, 0); // 2026-11-22 09:00（周日）
const TODAY = '2026-11-22';
/** 本周一，用于周复盘的 resolvedAt 窗口。 */
const MONDAY_IN_WEEK = new Date(2026, 10, 16);

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'asaki-m2-checkin-'));
}

async function createContext(dir: string, model: FakeModelClient, now: () => Date = () => NOW) {
  return createAppContext({
    userDataPath: join(dir, 'user-data'),
    defaultVaultPath: join(dir, 'vault'),
    secretStore: new InMemorySecretStore(),
    modelClient: model,
    now
  });
}

/** Onboards one project and turns its proactive check-in off. */
async function createOffProject(
  context: Awaited<ReturnType<typeof createContext>>,
  name: string
): Promise<string> {
  await context.api.completeWorkspaceOnboarding({
    name,
    kind: 'study',
    goal: '安静地推进',
    description: '关闭主动检查的项目'
  });
  const workspace = (await context.api.listWorkspaces()).find((entry) => entry.name === name);
  if (!workspace) throw new Error(`workspace ${name} was not created`);
  // api 类型把 updateWorkspace 声明为可选（取决于存储实现）；真实 vault 实现一定有。
  await context.api.updateWorkspace!({ workspaceId: workspace.id, checkIn: 'off' } as never);
  return workspace.id;
}

async function writeCommitments(
  dir: string,
  entries: readonly Commitment[]
): Promise<void> {
  await writeFile(commitmentsFile(join(dir, 'vault')), serializeCommitmentsFile(entries), 'utf8');
}

describe('M2 关闭检查的项目与承诺的边界', () => {
  test('晨检跳过关闭项目里的承诺，问下一条不属于它的承诺', async () => {
    const dir = await tempDir();
    try {
      const model = new FakeModelClient(['早上好，今天先做极限基础。']);
      const context = await createContext(dir, model);
      const offId = await createOffProject(context, '关掉检查的项目');
      // 保证还有至少一个参与检查的项目，否则整次晨检会被跳过。
      await context.api.completeWorkspaceOnboarding({
        name: '在用的项目',
        kind: 'study',
        goal: '每天两小时',
        description: ''
      });

      await writeCommitments(dir, [
        {
          id: 'cm-off',
          text: '关掉项目里的承诺',
          due: TODAY,
          status: 'open',
          createdAt: '2026-11-20T08:00:00.000Z',
          workspaceId: offId
        },
        {
          id: 'cm-free',
          text: '没有归属的承诺',
          due: TODAY,
          status: 'open',
          createdAt: '2026-11-21T08:00:00.000Z'
        }
      ]);

      const notification = await context.checkIns.check('morning', TODAY);
      expect(notification).not.toBeNull();
      const conversation = await context.conversationStore.get(notification!.conversationId!);
      const text = conversation?.messages[0]?.text ?? '';

      // 用户能看到的那一行：只问未归属的那条。
      expect(text).toContain('你说今天要做「没有归属的承诺」，做了吗？');
      // 关闭检查的项目里的承诺不能借晨检回到用户眼前。
      expect(text).not.toContain('关掉项目里的承诺');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test.fails(
    'M2 相邻：周复盘不应点名已关闭项目里的承诺（基线的 accountabilityLine 仍会带上它）',
    async () => {
      const dir = await tempDir();
      try {
        const model = new FakeModelClient(['这周辛苦了，我们看看数字。']);
        const context = await createContext(dir, model);
        const offId = await createOffProject(context, '关掉检查的项目');
        await context.api.completeWorkspaceOnboarding({
          name: '在用的项目',
          kind: 'study',
          goal: '每天两小时',
          description: ''
        });
        await context.api.updateSettings({ accountabilityName: '小林' });
        await writeCommitments(dir, [
          {
            id: 'cm-off-done',
            text: '关掉项目里已经做完的承诺',
            due: '2026-11-21',
            status: 'done',
            createdAt: '2026-11-18T08:00:00.000Z',
            resolvedAt: new Date(MONDAY_IN_WEEK.getTime() + 5 * 86_400_000 + 8 * 3_600_000)
              .toISOString(),
            workspaceId: offId
          }
        ]);

        const notification = await context.checkIns.check('weekly', TODAY);
        expect(notification).not.toBeNull();
        const conversation = await context.conversationStore.get(notification!.conversationId!);
        const text = conversation?.messages[0]?.text ?? '';

        // 基线：这句会出现在周复盘里 —— 用户被点名的是一个他已经关掉检查的项目。
        expect(text).not.toContain('关掉项目里已经做完的承诺');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  );
});