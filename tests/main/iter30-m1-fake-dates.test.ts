import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommitmentService } from '../../src/main/commitments/service';
import {
  isCommitmentDate,
  resolveCommitmentDue
} from '../../src/main/commitments/records';

/**
 * iter30 · M1 回归用例（基线 master c73e721，当前 master ebfd0fd 已修）
 *
 * 缺陷：`isCommitmentDate` 曾只做「格式 + Date 可解析」两步校验，
 * `new Date('2026-02-30T00:00:00Z')` 会被 JavaScript 滚到 2026-03-02，
 * 于是 2 月 30 日这类不存在的日期被当成合法承诺日期原样保存。
 *
 * 处置变更（iter39）：iter39 M1 已修 —— `isCommitmentDate` 改为委托
 * `src/shared/date.ts` 的 `isLocalDate`（精确形状正则 + 回卷检查），
 * `src/main/availability/records.ts` 的 `isIsoDate` 同样委托它。
 * 因此原来的两个 `test.fails` 在 master 上会「意外通过」而亮红：它们标记的
 * 缺陷已修，守卫应当翻成普通 `test` 并断言**应当拒绝**。
 *
 * 依据：`docs/superpowers/reports/2026-11-22-iter39-m1m2.md` §1（M1）。
 */

const NOW = new Date('2026-11-22T09:00:00');

async function withVault(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-m1-dates-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('M1 假日期：格式正确但日历上不存在的日期', () => {
  test('对照：格式错误或月份越界的日期被拒绝', () => {
    expect(isCommitmentDate('2026-11-22')).toBe(true);
    expect(isCommitmentDate('2026-1-1')).toBe(false);
    expect(isCommitmentDate('2026-13-01')).toBe(false);
    expect(isCommitmentDate('not-a-date')).toBe(false);
    expect(isCommitmentDate(undefined)).toBe(false);
    expect(resolveCommitmentDue('2026-13-01', NOW)).toBeUndefined();
  });

  test('M1-a: 不存在的 2026-02-30 / 2026-11-31 被 isCommitmentDate 拒绝（iter39 已修）', () => {
    // 曾放行并滚到 3 月 2 日 / 12 月 1 日；iter39 委托 isLocalDate 后为 false。
    expect(isCommitmentDate('2026-02-30')).toBe(false);
    expect(isCommitmentDate('2026-11-31')).toBe(false);
    // 闰年 2 月 29 日是真实存在的日子，不能被一刀切拒绝。
    expect(isCommitmentDate('2024-02-29')).toBe(true);
    expect(isCommitmentDate('2026-02-29')).toBe(false);
  });

  test('M1-b: 承诺入口拒绝 2026-02-30，而不是原样保存或悄悄滚日期（iter39 已修）', async () => {
    await withVault(async (root) => {
      const service = createCommitmentService({ root, now: () => NOW });
      // 显式传入日历上不存在的日期：服务层抛错，且不写盘。
      await expect(
        service.create({ text: '背 20 个单词', due: '2026-02-30' })
      ).rejects.toThrow('承诺日期必须是 YYYY-MM-DD');
      expect(await service.list()).toEqual([]);
      // 合法日期照常写入。
      const ok = await service.create({ text: '背 20 个单词', due: '2026-11-23' });
      expect(ok.due).toBe('2026-11-23');
    });
  });
});
