import { execFileSync } from 'node:child_process';
import { test, expect } from 'vitest';

/**
 * 验收 1（架构总验收，P0 形态）：对合入 diff 做路径白名单断言。
 *
 * 允许清单（spec 验收 1）：`src/main/runtime/` 新目录、装配点 `src/main/index.ts`
 * 与 `src/main/ipc.ts`、`package.json`、`tests/`、`docs/`。
 *
 * 运行口径（item 67 2026-11-27 裁定：Runtime 批验收 1 的运行语义——显式基线才
 * 断言；非 Runtime 分支（iter33 等）该断言不适用，避免全系恒红）：
 *   RUNTIME_PATH_WHITELIST_BASE=<base-ref> npx vitest run tests/main/runtime/path-whitelist.test.ts
 * 显式设置（非空）才计算 diff 并断言，fail-closed 语义不变（git 失败 → throw → 红）；
 * 未设置（含空串）即 skip。合并时由协调者显式传基线实跑并留档。
 */
const ALLOWED_PREFIXES = ['src/main/runtime/', 'tests/', 'docs/'];
const ALLOWED_FILES = ['src/main/index.ts', 'src/main/ipc.ts', 'package.json'];

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
