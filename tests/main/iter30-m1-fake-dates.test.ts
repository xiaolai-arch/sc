import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommitmentService } from '../../src/main/commitments/service';
import {
  isCommitmentDate,
  resolveCommitmentDue
} from '../../src/main/commitments/records';

/**
 * iter30 · M1 回归用例（基线 master c73e721）
 *
 * 缺陷：`isCommitmentDate` 只做「格式 + Date 可解析」两步校验。
 * `new Date('2026-02-30T00:00:00Z')` 不是 NaN —— JavaScript 会把它滚到
 * 2026-03-02 —— 所以 2 月 30 日这类不存在的日期会被当成合法承诺日期：
 *   - `record_commitment` / 承诺服务原样保存 due='2026-02-30'；
 *   - 次日晨检按 `due <= today` 比较，这条承诺会在 3 月 2 日（而不是用户
 *     以为的日子）冒出来；承诺文件里也留下一个日历上不存在的日期。
 * 同类洞还存在于 src/main/availability/records.ts 的 `isIsoDate`（「下周哪天满」
 * 的 busyDates 校验），症状一致。
 *
 * 处置：本文件只写用例，不改产品代码。两个 `test.fails` 在基线 c73e721 上
 * 失败是预期结果，Vitest 会记为通过；产品修好后它们会变成「意外通过」而
 * 亮红，提醒把 `test.fails` 改回普通 `test`。对照组保证这不是一刀切拒绝。
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
  test('对照：格式错误或月份越界的日期现在就会被拒绝', () => {
    // 这些在基线上已经是 false，用来证明测试不是「全部拒绝」。
    expect(isCommitmentDate('2026-11-22')).toBe(true);
    expect(isCommitmentDate('2026-1-1')).toBe(false);
    expect(isCommitmentDate('2026-13-01')).toBe(false);
    expect(isCommitmentDate('not-a-date')).toBe(false);
    expect(isCommitmentDate(undefined)).toBe(false);
    expect(resolveCommitmentDue('2026-13-01', NOW)).toBeUndefined();
  });

  test.fails(
    'M1-a: 不存在的 2026-02-30 不应被 isCommitmentDate 放行（基线会滚到 3 月 2 日）',
    () => {
      expect(isCommitmentDate('2026-02-30')).toBe(false);
      expect(isCommitmentDate('2026-11-31')).toBe(false);
    }
  );

  test.fails(
    'M1-b: 承诺入口不应原样保存 2026-02-30（record_commitment 走的同一条路）',
    async () => {
      await withVault(async (root) => {
        const service = createCommitmentService({ root, now: () => NOW });
        // 基线行为：due 被原样写成 '2026-02-30'，pending('2026-03-02') 才会选中它。
        const created = await service.create({ text: '背 20 个单词', due: '2026-02-30' });
        expect(created.due).toBe('2026-03-02');
      });
    }
  );
});