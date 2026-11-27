import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The generator is exercised as a CLI against a fixture tree (never the real
// node_modules), so the assertions stay valid as dependencies change.
const SCRIPT = join(__dirname, '..', '..', 'scripts', 'gen-third-party-notices.mjs');

const ALPHA_SHIPPED_TEXT = [
  'alpha shipped license',
  '',
  'Permission is hereby granted, free of charge, to any person obtaining a copy',
  'of this software to use it freely.'
].join('\n');

const CASE_VARIANT_MAIN = 'case variant LICENSE (extensionless wins)\nPermission is hereby granted.\n';
const CASE_VARIANT_MD = 'case variant LICENSE.md (must lose to extensionless)\n';

const BETA_STUB_TEXT = 'Apache License 2.0\n\nSee the LICENSE file in the root of this repository.\n';

const MARKDOWN_LICENSE_TEXT = [
  '## Heading',
  '',
  'Some editorial preamble.',
  '',
  '---',
  '',
  'Permission is hereby granted, free of charge.',
  ''
].join('\n');

async function makeFixture(root: string): Promise<void> {
  const lock = {
    name: 'fixture-root',
    version: '9.9.9',
    lockfileVersion: 3,
    packages: {
      '': { name: 'fixture-root', version: '9.9.9', license: 'MIT' },
      'node_modules/@scope/case-variant': { version: '1.1.0', license: 'MIT' },
      'node_modules/alpha-shipped': { version: '1.0.0', license: 'MIT' },
      'node_modules/beta-pointer': { version: '2.0.0', license: 'Apache-2.0' },
      'node_modules/delta-devonly': { version: '0.9.0', license: 'MIT', dev: true },
      'node_modules/echo-dual': { version: '1.2.3', license: '(AFL-2.1 OR BSD-3-Clause)' },
      'node_modules/markdown-shipped': { version: '4.4.4', license: 'MIT' },
      'node_modules/zulu-unknown': { version: '3.0.0', license: 'WTFPL' }
    }
  };
  await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock, null, 2), 'utf8');
  await writeFile(join(root, 'LICENSE'), 'root shipped license\nPermission is hereby granted.\n', 'utf8');

  await mkdir(join(root, 'node_modules', '@scope', 'case-variant'), { recursive: true });
  await writeFile(join(root, 'node_modules', '@scope', 'case-variant', 'LICENSE'), CASE_VARIANT_MAIN, 'utf8');
  await writeFile(join(root, 'node_modules', '@scope', 'case-variant', 'LICENSE.md'), CASE_VARIANT_MD, 'utf8');

  await mkdir(join(root, 'node_modules', 'alpha-shipped'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'alpha-shipped', 'LICENSE'), `${ALPHA_SHIPPED_TEXT}\n`, 'utf8');

  await mkdir(join(root, 'node_modules', 'beta-pointer'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'beta-pointer', 'LICENSE.md'), BETA_STUB_TEXT, 'utf8');
  await writeFile(
    join(root, 'node_modules', 'beta-pointer', 'package.json'),
    JSON.stringify({ name: 'beta-pointer', version: '2.0.0', repository: { url: 'git+https://github.com/example/beta.git' } }),
    'utf8'
  );

  await mkdir(join(root, 'node_modules', 'markdown-shipped'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'markdown-shipped', 'LICENSE'), MARKDOWN_LICENSE_TEXT, 'utf8');

  // echo-dual and zulu-unknown ship no license file at all.
  await mkdir(join(root, 'node_modules', 'echo-dual'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'zulu-unknown'), { recursive: true });
}

function runGenerator(root: string, out: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, '--lock', join(root, 'package-lock.json'), '--root', root, '--out', out], {
    encoding: 'utf8'
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Split into "## name@version" sections, ignoring lines that only look like
 * headers inside a ``` fence (a markdown license ships real "## " lines). */
function sectionsOf(content: string): Map<string, string> {
  let inFence = false;
  let current: { name: string; lines: string[] } | null = null;
  const sections = new Map<string, string>();
  for (const line of content.split('\n')) {
    if (/^`{3,}$/.test(line)) {
      inFence = !inFence;
      if (current) current.lines.push(line);
      continue;
    }
    if (!inFence && line.startsWith('## ')) {
      if (current) sections.set(current.name, current.lines.join('\n'));
      current = { name: line.slice(3), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) sections.set(current.name, current.lines.join('\n'));
  return sections;
}

/** Lines visible to a markdown reader: not inside a fence. */
function linesOutsideFences(content: string): string[] {
  let inFence = false;
  const out: string[] = [];
  for (const line of content.split('\n')) {
    if (/^`{3,}$/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out;
}

describe('gen-third-party-notices', () => {
  let root: string;
  let out: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'asaki-notices-'));
    out = join(root, 'THIRD-PARTY-NOTICES.md');
    await makeFixture(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function generate(): string {
    const { status, stdout, stderr } = runGenerator(root, out);
    expect(status).toBe(0);
    expect(stdout).toContain('Wrote');
    return stderr;
  }

  test('production set only: dev packages are excluded, root package is included', async () => {
    generate();
    const content = await readFile(out, 'utf8');
    expect(content).not.toContain('delta-devonly@0.9.0');
    expect(content).toContain('## fixture-root@9.9.9');
    expect(content).toContain('## alpha-shipped@1.0.0');
    expect(content).toContain('## @scope/case-variant@1.1.0');
  });

  test('sections are sorted by name@version, case-insensitive', async () => {
    generate();
    const content = await readFile(out, 'utf8');
    const names = [...sectionsOf(content).keys()];
    const lower = names.map((n) => n.toLowerCase());
    const sorted = [...lower].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(lower).toEqual(sorted);
    // The scoped package sorts ahead of plain names, proving the order is by
    // the full name string, not by a flattened or locale-compare ordering.
    expect(names[0]).toBe('@scope/case-variant@1.1.0');
  });

  test('package-shipped LICENSE file is used verbatim', async () => {
    generate();
    const sections = sectionsOf(await readFile(out, 'utf8'));
    expect(sections.get('alpha-shipped@1.0.0')).toContain(ALPHA_SHIPPED_TEXT);
    expect(sections.get('alpha-shipped@1.0.0')).not.toContain('License text:');
    expect(sections.get('fixture-root@9.9.9')).toContain('root shipped license');
  });

  test('missing license file: canonical text per declared license, with annotation', async () => {
    const stderr = generate();
    const sections = sectionsOf(await readFile(out, 'utf8'));
    // No fixture package carries a WTFPL file and no WTFPL template exists,
    // so it degrades to a declaration-only note and is flagged on stderr.
    const zulu = sections.get('zulu-unknown@3.0.0');
    expect(zulu).toContain('License text: declared "WTFPL" via npm metadata; not shipped in the package tarball.');
    expect(stderr).toContain('zulu-unknown@3.0.0');

    // An Apache-2.0 package without any license file must get the full
    // canonical text, never a bare declaration.
    const dual = sections.get('echo-dual@1.2.3');
    expect(dual).toContain('Academic Free License');
    expect(dual).toContain('Redistribution and use in source and binary forms');
    expect(dual).toContain('dual-licensed, choose either license');
    expect(dual).toContain('Attribution: echo-dual@1.2.3, see https://www.npmjs.com/package/echo-dual');
  });

  test('stub license file ("see the repository") falls back to the canonical text', async () => {
    generate();
    const beta = sectionsOf(await readFile(out, 'utf8')).get('beta-pointer@2.0.0');
    // The stub itself must not be presented as the license text.
    expect(beta).not.toContain('See the LICENSE file in the root of this repository.');
    expect(beta).toContain('Apache License');
    expect(beta).toContain('Version 2.0');
    expect(beta).toContain('APPENDIX');
    expect(beta).toContain('the package ships only a stub');
    expect(beta).toContain('Attribution: beta-pointer@2.0.0, see https://github.com/example/beta');
  });

  test('every Apache-2.0 entry carries the full license text', async () => {
    generate();
    const content = await readFile(out, 'utf8');
    const apacheSections = [...sectionsOf(content).entries()].filter(([, body]) => /- License: Apache-2.0/.test(body));
    expect(apacheSections.length).toBeGreaterThan(0);
    for (const [name, body] of apacheSections) {
      expect(`${name}: ${body}`).toContain('Apache License');
      expect(`${name}: ${body}`).toContain('Version 2.0');
    }
  });

  test('deterministic: repeated runs are byte-identical and LF-only', async () => {
    generate();
    const first = await readFile(out);
    const secondRun = runGenerator(root, out);
    expect(secondRun.status).toBe(0);
    const second = await readFile(out);
    expect(second.equals(first)).toBe(true);
    expect(first.toString('utf8')).not.toContain('\r');
  });

  test('a LICENSE case variant next to the canonical name does not change the output', async () => {
    generate();
    const caseVariant = sectionsOf(await readFile(out, 'utf8')).get('@scope/case-variant@1.1.0');
    // The extensionless LICENSE wins deterministically over LICENSE.md.
    expect(caseVariant).toContain('case variant LICENSE (extensionless wins)');
    expect(caseVariant).not.toContain('must lose to extensionless');
  });

  test('unknown identifier degrades to declaration-only without a canonical text', async () => {
    generate();
    const sections = sectionsOf(await readFile(out, 'utf8'));
    // Fixture sanity: the canonical templates the suite relies on exist.
    expect(sections.get('beta-pointer@2.0.0')).toContain('Version 2.0');
    // And a fixture lock with no license field at all still renders UNKNOWN.
    const lockPath = join(root, 'package-lock.json');
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { packages: Record<string, Record<string, unknown>> };
    lock.packages['node_modules/zulu-unknown'] = { version: '3.0.0' };
    await writeFile(lockPath, JSON.stringify(lock), 'utf8');
    runGenerator(root, out);
    const zulu = sectionsOf(await readFile(out, 'utf8')).get('zulu-unknown@3.0.0');
    expect(zulu).toContain('- License: UNKNOWN');
    expect(zulu).toContain('License text: declared "undefined" via npm metadata');
  });

  test('a markdown license with "## " and "---" cannot add sections', async () => {
    generate();
    const content = await readFile(out, 'utf8');
    // Fixture sanity: every package appears exactly once, including the one
    // whose LICENSE file itself contains "## Heading".
    const names = [...sectionsOf(content).keys()];
    expect(names).toHaveLength(7);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('markdown-shipped@4.4.4');
    // Fence-aware: only our seven "## <pkg>@<ver>" headers are sections. A
    // bare line count would see the license's own "## Heading" too, which is
    // exactly why the body must be fenced.
    const visibleHeadingLines = linesOutsideFences(content).filter((l) => l.startsWith('## '));
    expect(visibleHeadingLines).toHaveLength(names.length);
    // The audit-grep invariant: counting only lines with the section-header
    // shape "## <name>@<version>" must equal the package count even on the raw
    // file, where the fenced license text keeps its own "## Heading" bytes.
    const shapedHeaders = content.match(/^## \S+@\d/gm) ?? [];
    expect(shapedHeaders).toHaveLength(names.length);
  });

  test('fenced license text keeps the markdown headings and rules byte-for-byte', async () => {
    generate();
    const section = sectionsOf(await readFile(out, 'utf8')).get('markdown-shipped@4.4.4');
    expect(section).not.toBeNull();
    // The original bytes survive, so this is not a tautology: the markdown
    // headings and the "---" rule are present verbatim inside the fence.
    expect(section).toContain('## Heading');
    expect(section).toMatch(/^---$/m);
    expect(section).toContain('Permission is hereby granted, free of charge.');

    // The fence is exactly ``` here: no backticks occur in the fixture text.
    const fencedBody = section!.match(/^(`{3,})\n([\s\S]*?)\n\1$/m);
    expect(fencedBody).not.toBeNull();
    expect(fencedBody![1]).toBe('```');
    expect(fencedBody![2]).toContain('## Heading');
  });
});
