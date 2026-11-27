import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from 'vitest';

/**
 * 验收 14（Pi 类型零泄漏）：src 里只有 `src/main/runtime/engine-pi/` 可以出现
 * Pi 包引用；renderer 与 vault 序列化代码零命中。
 *
 * 形态参照 path-whitelist.test.ts（worker 交付自跑 + 合并实跑），实现用纯
 * Node 递归而不是 child_process：`grep` 在 Windows CI/裸 PowerShell 的 PATH
 * 里不保证存在，fs 遍历跨平台确定。语义与 spec 的 grep 等价并更严：
 *
 *   spec 原文： grep -r "pi-agent-core\|from 'pi" src --include=*.ts
 *   本断言  ： 遍历 src/**\/*.{ts,tsx}，命中以下任一模式即泄漏——
 *              /pi-agent-core/                      （spec 模式 1，逐字）
 *              /from\s+['"]pi/                      （spec 模式 2，逐字）
 *              /@earendil-works\/pi/                （实际包名的 scope 家族，比 spec 更严）
 */

const SOURCE_ROOT = fileURLToPath(new URL('../../../src', import.meta.url));
/**
 * 零泄漏白名单前缀（P3 装配批接上：先前本常量是 join+sep 形态且无消费者——
 * 断言里各写了一份 `/` 归一后的字面量）。scan() 产出的 hit.file 一律是
 * `/` 分隔的 src 相对路径，前缀必须用同一形态。
 */
const ALLOWED_PREFIX = 'main/runtime/engine-pi/';

/** spec 的两条模式，逐字保留（`from 'pi` / `from "pi` 两种引号都算）。 */
const SPEC_PATTERNS: RegExp[] = [/pi-agent-core/, /from\s+['"]pi/];
/** 实际锁定包名家族（`@earendil-works/pi-*`）——比 spec 的两条更严的一层。 */
const PACKAGE_PATTERN = /@earendil-works\/pi/;

interface Hit {
  file: string;
  line: number;
  text: string;
  patterns: string[];
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkTsFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function scan(): Hit[] {
  const hits: Hit[] = [];
  for (const file of walkTsFiles(SOURCE_ROOT)) {
    const rel = relative(SOURCE_ROOT, file).split(sep).join('/');
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      const patterns = [
        ...SPEC_PATTERNS.map((pattern) => pattern.source).filter((source_) => new RegExp(source_).test(line)),
        ...(PACKAGE_PATTERN.test(line) ? [PACKAGE_PATTERN.source] : [])
      ];
      if (patterns.length > 0) {
        hits.push({ file: rel, line: index + 1, text: line.trim(), patterns });
      }
    }
  }
  return hits;
}

test('验收 14：Pi 包引用只出现在 src/main/runtime/engine-pi/ 内', () => {
  const hits = scan();
  const violations = hits.filter((hit) => !hit.file.startsWith(ALLOWED_PREFIX));
  expect(
    violations,
    `Pi 引用泄漏到 engine-pi/ 之外（renderer 与 vault 序列化代码必须零命中）：\n${violations
      .map((hit) => `  src/${hit.file}:${hit.line}  [${hit.patterns.join(' | ')}]  ${hit.text}`)
      .join('\n')}`
  ).toEqual([]);
});

test('验收 14（防退化）：engine-pi/ 内确实存在 Pi 引用（断言不是空转）', () => {
  const hits = scan().filter((hit) => hit.file.startsWith(ALLOWED_PREFIX));
  expect(hits.length).toBeGreaterThan(0);
});

test('验收 14（逐目录）：renderer 全目录与 vault 序列化代码零命中', () => {
  const hits = scan();
  expect(hits.filter((hit) => hit.file.startsWith('renderer'))).toEqual([]);
  const vaultSerialization = hits.filter((hit) => /serializ/i.test(hit.file));
  expect(vaultSerialization).toEqual([]);
});
