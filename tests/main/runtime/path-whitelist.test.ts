import { execFileSync } from 'node:child_process';
import { test, expect } from 'vitest';

/**
 * 验收 1（架构总验收，P0 形态）：对合入 diff 做路径白名单断言。
 *
 * 允许清单（spec 验收 1；P4 批就地扩面）：`src/main/runtime/` 新目录、装配点
 * `src/main/index.ts` 与 `src/main/ipc.ts`、`package.json`/`package-lock.json`、
 * `tests/`、`docs/`，以及 item 61 2026-11-28 sc-lead 裁 A 逐条列出的场景二触面
 * （见下方 ALLOWED_FILES 的逐条注记）。
 *
 * 运行口径（item 67 2026-11-27 裁定：Runtime 批验收 1 的运行语义——显式基线才
 * 断言；非 Runtime 分支（iter33 等）该断言不适用，避免全系恒红）：
 *   RUNTIME_PATH_WHITELIST_BASE=<base-ref> npx vitest run tests/main/runtime/path-whitelist.test.ts
 * 显式设置（非空）才计算 diff 并断言，fail-closed 语义不变（git 失败 → throw → 红）；
 * 未设置（含空串）即 skip。合并时由协调者显式传基线实跑并留档。
 */
const ALLOWED_PREFIXES = ['src/main/runtime/', 'tests/', 'docs/'];
// item 61 2026-11-27 裁定：精确锁版本的必然产物，随 package.json 入清单。
// item 61 2026-11-28 sc-lead 裁 A（场景二并入 P4 批的机械后果）：加收场景二
// 触面——butler 工具表（resolve_commitment 收敛 + reschedule_commitment 新增）、
// butler 提示词（改期指引指向新工具）、skill 共享契约（references 事件 kind 扩展，
// 仅逐条裁定要求的最小触面，不整目录放开）：
//   - src/main/butler/tools.ts（移除 resolve_commitment.newDue + 新工具）
//   - src/main/butler/prompt.ts（「挪到某天」指引改指向 reschedule_commitment）
//   - src/shared/butler-stream.ts（ButlerReference.kind 加 'commitment'，周总结引用来源）
// 扩面外的越界改动照旧红（纪律不变）。
const ALLOWED_FILES = [
  'src/main/index.ts',
  'src/main/ipc.ts',
  'package.json',
  'package-lock.json',
  // item 61 2026-11-28 sc-lead 裁 A / F7：场景二必须改工具表本身。
  'src/main/butler/tools.ts',
  'src/main/butler/prompt.ts',
  'src/shared/butler-stream.ts'
];

function changedFiles(base: string): string[] {
  const output = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** item 67 2026-11-27 裁定：显式设置（非空）才实跑；未设置（含空串）即 skip。 */
function whitelistBase(): string | null {
  const base = process.env['RUNTIME_PATH_WHITELIST_BASE'];
  return typeof base === 'string' && base !== '' ? base : null;
}

const base = whitelistBase();

test.skipIf(base === null)('验收 1：合入 diff 全部落在路径白名单内', () => {
  const resolved = base as string;
  let files: string[];
  try {
    files = changedFiles(resolved);
  } catch (error) {
    throw new Error(
      `无法对基线「${resolved}」计算 diff（可用 RUNTIME_PATH_WHITELIST_BASE 指定基线 ref）：${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const violations = files.filter((file) => {
    if (ALLOWED_FILES.includes(file)) return false;
    return !ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix));
  });
  expect(
    violations,
    `以下改动越出 Runtime P0 白名单（允许：${[...ALLOWED_PREFIXES, ...ALLOWED_FILES].join(', ')}）：\n${violations.join('\n')}`
  ).toEqual([]);
});
