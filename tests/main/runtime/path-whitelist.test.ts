import { execFileSync } from 'node:child_process';
import { test, expect } from 'vitest';

/**
 * 验收 1（架构总验收，P0 形态）：对合入 diff 做路径白名单断言。
 *
 * 允许清单（spec 验收 1）：`src/main/runtime/` 新目录、装配点 `src/main/index.ts`
 * 与 `src/main/ipc.ts`、`package.json`、`tests/`、`docs/`。
 *
 * 运行口径（CI 无打包产物，按 spec 以「worker 交付时自跑 + 合并时实跑」落地）：
 *   RUNTIME_PATH_WHITELIST_BASE=<base-ref> npx vitest run tests/main/runtime/path-whitelist.test.ts
 * base 默认 `master`；本分支上日常 `npx vitest run` 即实跑（diff 即本批改动）。
 * 合并时由协调者显式传基线（如 7eda7ba）实跑并留档。
 */
const ALLOWED_PREFIXES = ['src/main/runtime/', 'tests/', 'docs/'];
// item 61 2026-11-27 裁定：精确锁版本的必然产物，随 package.json 入清单。
const ALLOWED_FILES = ['src/main/index.ts', 'src/main/ipc.ts', 'package.json', 'package-lock.json'];

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

test('验收 1：合入 diff 全部落在路径白名单内', () => {
  const base = process.env['RUNTIME_PATH_WHITELIST_BASE'] ?? 'master';
  let files: string[];
  try {
    files = changedFiles(base);
  } catch (error) {
    throw new Error(
      `无法对基线「${base}」计算 diff（可用 RUNTIME_PATH_WHITELIST_BASE 指定基线 ref）：${
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
