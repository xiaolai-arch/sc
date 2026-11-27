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
 * iter30 · M2 语义回归用例（当前 master ebfd0fd）
 *
 * ## 语义依据（为什么断言方向是这样）
 *
 * 主人 2026-11-22 裁定：**承诺跟人走，不跟项目走**。用户亲口说出的承诺，即使
 * 记在「关闭主动检查」的项目里，晨检照样要问——项目检查开关管的是任务/记忆/
 * 话题的收件范围，管不到用户自己说过的话。
 *
 * iter39 据此落地（报告 docs/superpowers/reports/2026-11-22-iter39-m1m2.md §3/§4）：
 * - src/main/context.ts `readDueCommitment()`（现 :682-690）删掉「收集
 *   checkIn==='off' 项目并跳过其承诺」的整段过滤，直接取 commitments.pending()
 *   的最早一条；任务/记忆/话题的 off 过滤原样保留（:549-551/:591-593 仍在）。
 * - 周复盘映射（context.ts:641-659）不再丢弃 workspaceId。注意 iter39 报告 §4
 *   自己写明：这个字段**没有消费方**——accountabilityLine 只用
 *   text/due/status/resolvedAt。所以在新语义下，周复盘点名关闭项目里的承诺
 *   就是正确行为，不是缺陷。
 *
 * 本文件在分支 d8f4195（基线 c73e721）上断言的是旧语义「关掉的项目里的承诺
 * 不进晨检/复盘」，合入 master 后会红。本次按新语义改写为正向断言。
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

describe('M2 承诺跟人走，不跟项目走（主人 2026-11-22 裁定 + iter39 落地）', () => {
  test('晨检照样问关闭检查项目里的承诺（承诺跟人走）', async () => {
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

      // 新语义：关掉检查的项目里的承诺照样要问（readDueCommitment 已无 off 过滤）。
      // 两条都到期时问最早的一条（pending 按 due 再 createdAt 排序），这里是最早的
      // 「关掉项目里的承诺」——它不会被项目的检查开关挡住。
      expect(text).toContain('你说今天要做「关掉项目里的承诺」，做了吗？');
      // 晨检一次只问一条承诺（最早到期的那条），不是把所有到期承诺都堆进消息。
      expect(text).not.toContain('没有归属的承诺');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('周复盘点名关闭检查项目里已完成的承诺（承诺跟人走；iter39 后这是正确行为）', async () => {
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

      // 新语义：承诺跟人走。周复盘的 accountability 一句如实点名本周兑现的承诺，
      // 不因其项目关闭检查而隐去（context.ts:651-657 投影保留 workspaceId，
      // accountabilityLine 本就不按项目过滤——这是「跟人走」的一部分，不是漏网）。
      expect(text).toContain('关掉项目里已经做完的承诺');
      expect(text).toContain('你告诉过 小林 的时间是 2026-11-21');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('旧语义守卫：无归属的承诺到期时晨检照问（off 过滤删除不改变无项目承诺的行为）', async () => {
    const dir = await tempDir();
    try {
      const model = new FakeModelClient(['早上好，今天先做极限基础。']);
      const context = await createContext(dir, model);
      await createOffProject(context, '关掉检查的项目');
      await context.api.completeWorkspaceOnboarding({
        name: '在用的项目',
        kind: 'study',
        goal: '每天两小时',
        description: ''
      });

      await writeCommitments(dir, [
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
      expect(text).toContain('你说今天要做「没有归属的承诺」，做了吗？');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
