import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { LocalCliAgent } from '../../shared/types';
import type { LocalCliModelCatalog, LocalCliModelOption } from '../../shared/local-cli';

/**
 * Reads the model choices a CLI already has configured on this machine.
 *
 * Nothing here is authoritative about what the remote service will accept: a
 * model listed in a config file is a *candidate* the user has already chosen.
 * The adapters only read the fields they need and never keep credential
 * fields, so a settings document that also stores a key contributes no secret.
 */
export interface CliConfigReadOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Test seam; production reads from disk. */
  readTextFile?: (path: string) => Promise<string>;
  /** Test seam; production checks for the conventional config locations. */
  exists?: (path: string) => Promise<boolean>;
}

type ReadText = (path: string) => Promise<string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** Displays a config path as `~/...` so UI text stays short and portable. */
export function displayConfigPath(path: string, homeDir: string): string {
  const rel = relative(homeDir, path);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
    return `~/${rel.split(/[\\/]+/).join('/')}`;
  }
  return path;
}

async function readIfPresent(path: string, readText: ReadText): Promise<string | null> {
  try {
    return await readText(path);
  } catch {
    return null;
  }
}

/** Strips `//` and block comments plus trailing commas; enough for config files. */
export function parseJsonc(raw: string): unknown {
  let out = '';
  let index = 0;
  let inString = false;
  while (index < raw.length) {
    const char = raw[index]!;
    const next = raw[index + 1];
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 2;
        continue;
      }
      if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < raw.length && raw[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < raw.length && !(raw[index] === '*' && raw[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    // JSONC allows trailing commas; JSON does not. Only look outside strings so
    // a comma in a value (e.g. "a, ]") is never removed.
    if (char === ',') {
      let look = index + 1;
      while (look < raw.length && (raw[look] === ' ' || raw[look] === '\t' || raw[look] === '\r' || raw[look] === '\n')) {
        look += 1;
      }
      if (raw[look] === '}' || raw[look] === ']') {
        index += 1;
        continue;
      }
    }
    out += char;
    index += 1;
  }
  return JSON.parse(out);
}

type TomlScalar = string;

/** Minimal TOML reader: top-level `key = "value"` pairs, strings only. */
function readTopLevelTomlStrings(raw: string): Record<string, TomlScalar> {
  const values: Record<string, TomlScalar> = {};
  let inSection = false;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    if (/^\[\[?[^\]]+\]\]?$/.test(trimmed)) {
      inSection = true;
      continue;
    }
    if (inSection) continue;
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1]!;
    let value = match[2]!.trim();
    // Drop an inline comment that is outside the quotes.
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0]!;
      const end = value.indexOf(quote, 1);
      if (end < 0) continue;
      value = value.slice(1, end);
    } else {
      value = value.split(/\s#/)[0]!.trim();
      if (value.length === 0) continue;
    }
    values[key] = value;
  }
  return values;
}

function option(
  id: string,
  origin: LocalCliModelOption['origin'],
  source: string,
  label?: string
): LocalCliModelOption {
  return { id, origin, source, ...(label ? { label } : {}) };
}

function dedupe(options: LocalCliModelOption[]): LocalCliModelOption[] {
  const seen = new Set<string>();
  const result: LocalCliModelOption[] = [];
  for (const entry of options) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push(entry);
  }
  return result;
}

/**
 * Codex keeps the active model and an optional model catalog in
 * `~/.codex/config.toml`. The catalog is a JSON file the CLI itself uses, so
 * display names match what `codex` shows.
 */
async function readCodexCatalog(
  homeDir: string,
  readText: ReadText
): Promise<LocalCliModelCatalog> {
  const configPath = join(homeDir, '.codex', 'config.toml');
  const source = displayConfigPath(configPath, homeDir);
  const catalog: LocalCliModelCatalog = { options: [], files: [], warnings: [] };
  const raw = await readIfPresent(configPath, readText);
  if (raw === null) return catalog;
  catalog.files.push(source);
  const values = readTopLevelTomlStrings(raw);
  const model = values.model;
  const effort = values.model_reasoning_effort;
  if (model) catalog.defaultModel = model;
  if (effort) catalog.defaultEffort = effort;
  if (model) catalog.options.push(option(model, 'config', source, '当前使用'));

  const catalogRef = values.model_catalog_json;
  if (catalogRef) {
    const catalogPath = isAbsolute(catalogRef) ? catalogRef : join(dirname(configPath), catalogRef);
    const catalogSource = displayConfigPath(catalogPath, homeDir);
    const catalogRaw = await readIfPresent(catalogPath, readText);
    if (catalogRaw === null) {
      catalog.warnings.push(`模型目录不存在：${catalogSource}`);
    } else {
      try {
        const parsed: unknown = JSON.parse(catalogRaw);
        const models = collectCatalogModels(parsed);
        if (models.length === 0) {
          catalog.warnings.push(`模型目录中没有可识别的模型：${catalogSource}`);
        } else {
          catalog.files.push(catalogSource);
          for (const entry of models) {
            catalog.options.push(option(entry.id, 'catalog', catalogSource, entry.label));
          }
        }
      } catch {
        catalog.warnings.push(`模型目录无法解析：${catalogSource}`);
      }
    }
  }
  catalog.options = dedupe(catalog.options);
  return catalog;
}

type CatalogModel = { id: string; label?: string };

function catalogModelFrom(value: unknown): CatalogModel | null {
  if (typeof value === 'string') {
    const id = text(value);
    return id ? { id } : null;
  }
  if (!isRecord(value)) return null;
  const id = text(value['slug']) ?? text(value['id']) ?? text(value['model']) ?? text(value['name']);
  if (!id) return null;
  const label =
    text(value['display_name']) ?? text(value['displayName']) ?? text(value['title']) ?? text(value['name']);
  return { id, label: label && label !== id ? label : undefined };
}

function collectCatalogModels(value: unknown, depth = 0): CatalogModel[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) {
    return value.map(catalogModelFrom).filter((entry): entry is CatalogModel => entry !== null);
  }
  if (!isRecord(value)) return [];
  // Common wrappers: { models: [...] }, { models: { id: {...} } }, { providers: [...] }.
  for (const key of ['models', 'model_catalog', 'catalog', 'data']) {
    if (key in value) {
      const nested = collectCatalogModels(value[key], depth + 1);
      if (nested.length > 0) return nested;
    }
  }
  if (Array.isArray(value['providers'])) {
    return value['providers'].flatMap((provider) => collectCatalogModels(provider, depth + 1));
  }
  // A plain map of model id to metadata.
  const entries: CatalogModel[] = [];
  for (const [id, meta] of Object.entries(value)) {
    if (!/^[A-Za-z0-9._#/-]+$/.test(id)) continue;
    const label = isRecord(meta)
      ? (text(meta['display_name']) ?? text(meta['displayName']) ?? text(meta['name']) ?? text(meta['title']))
      : undefined;
    entries.push({ id, ...(label && label !== id ? { label } : {}) });
  }
  return entries;
}

const CLAUDE_ENV_ALIASES: { alias: string; key: string; label: string }[] = [
  { alias: 'sonnet', key: 'ANTHROPIC_DEFAULT_SONNET_MODEL', label: 'Sonnet 别名' },
  { alias: 'opus', key: 'ANTHROPIC_DEFAULT_OPUS_MODEL', label: 'Opus 别名' },
  { alias: 'haiku', key: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', label: 'Haiku 别名' }
];

/**
 * Claude Code keeps a model alias (possibly with a `[1m]` context tag) and
 * optional environment mappings in `~/.claude/settings.json`. ASAKI must not
 * overwrite those; it only offers them as choices.
 */
async function readClaudeCatalog(
  homeDir: string,
  readText: ReadText
): Promise<LocalCliModelCatalog> {
  const catalog: LocalCliModelCatalog = { options: [], files: [], warnings: [] };
  const paths = [
    join(homeDir, '.claude', 'settings.json'),
    join(homeDir, '.claude', 'settings.local.json')
  ];
  let settings: Record<string, unknown> = {};
  for (const path of paths) {
    const source = displayConfigPath(path, homeDir);
    const raw = await readIfPresent(path, readText);
    if (raw === null) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error('not an object');
      catalog.files.push(source);
      settings = { ...settings, ...parsed };
    } catch {
      catalog.warnings.push(`配置文件无法解析：${source}`);
    }
  }
  const model = text(settings.model);
  if (model) catalog.defaultModel = model;
  const env = isRecord(settings.env) ? settings.env : {};
  const mapping = new Map<string, string>();
  for (const { alias, key } of CLAUDE_ENV_ALIASES) {
    const mapped = text(env[key]);
    if (mapped) mapping.set(alias, mapped);
  }
  const directModel = text(env['ANTHROPIC_MODEL']);
  if (model) {
    catalog.options.push(option(model, 'config', '~/.claude/settings.json', '当前使用'));
  }
  if (directModel && directModel !== model) {
    catalog.options.push(
      option(directModel, 'mapping', '~/.claude/settings.json', 'ANTHROPIC_MODEL 映射')
    );
  }
  for (const { alias, label } of CLAUDE_ENV_ALIASES) {
    const mapped = mapping.get(alias);
    // Only alias names the CLI can parse are passed through; unmapped aliases
    // still work but their target is unknown, so they are not offered.
    if (!mapped) continue;
    catalog.options.push(option(alias, 'alias', '~/.claude/settings.json', `${label}（${mapped}）`));
    catalog.options.push(option(mapped, 'mapping', '~/.claude/settings.json', `${label}映射`));
  }
  catalog.options = dedupe(catalog.options);
  return catalog;
}

function opencodeConfigPaths(homeDir: string, env: NodeJS.ProcessEnv): string[] {
  const dirs = [
    env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, 'opencode') : null,
    join(homeDir, '.config', 'opencode'),
    env.APPDATA ? join(env.APPDATA, 'opencode') : null
  ].filter((entry): entry is string => entry !== null);
  const paths: string[] = [];
  for (const dir of dirs) {
    paths.push(join(dir, 'opencode.json'), join(dir, 'opencode.jsonc'), join(dir, 'config.json'));
  }
  return paths;
}

async function readOpencodeCatalog(
  homeDir: string,
  env: NodeJS.ProcessEnv,
  readText: ReadText
): Promise<LocalCliModelCatalog> {
  const catalog: LocalCliModelCatalog = { options: [], files: [], warnings: [] };
  let config: Record<string, unknown> | null = null;
  for (const path of opencodeConfigPaths(homeDir, env)) {
    const raw = await readIfPresent(path, readText);
    if (raw === null) continue;
    const source = displayConfigPath(path, homeDir);
    try {
      const parsed = parseJsonc(raw);
      if (!isRecord(parsed)) throw new Error('not an object');
      config = parsed;
      catalog.files.push(source);
      break;
    } catch {
      catalog.warnings.push(`配置文件无法解析：${source}`);
    }
  }
  if (!config) return catalog;
  const source = catalog.files[0] ?? '~/.config/opencode/opencode.json';
  const model = text(config.model);
  if (model) {
    catalog.defaultModel = model;
    catalog.options.push(option(model, 'config', source, '当前使用'));
  }
  const providers = isRecord(config.provider) ? config.provider : {};
  for (const [providerId, provider] of Object.entries(providers)) {
    if (!isRecord(provider)) continue;
    const models = isRecord(provider.models) ? provider.models : {};
    for (const [modelId, meta] of Object.entries(models)) {
      const label = isRecord(meta) ? (text(meta['name']) ?? text(meta['display_name'])) : undefined;
      catalog.options.push(
        option(`${providerId}/${modelId}`, 'config', source, label ?? undefined)
      );
    }
  }
  catalog.options = dedupe(catalog.options);
  return catalog;
}

async function readZcodeCatalog(
  homeDir: string,
  readText: ReadText
): Promise<LocalCliModelCatalog> {
  const catalog: LocalCliModelCatalog = { options: [], files: [], warnings: [] };
  for (const name of ['config.json', 'settings.json']) {
    const path = join(homeDir, '.zcode', name);
    const raw = await readIfPresent(path, readText);
    if (raw === null) continue;
    const source = displayConfigPath(path, homeDir);
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error('not an object');
      catalog.files.push(source);
      const model = text(parsed.model) ?? text(parsed.defaultModel);
      if (model) {
        catalog.defaultModel = model;
        catalog.options.push(option(model, 'config', source, '当前使用'));
      }
      break;
    } catch {
      catalog.warnings.push(`配置文件无法解析：${source}`);
    }
  }
  return catalog;
}

/**
 * Reads the model candidates a CLI already has configured. Every adapter is
 * best-effort: a missing file is normal, a broken one becomes a warning, and
 * the caller always keeps "inherit the CLI default" available.
 */
export async function readCliModelCatalog(
  agent: LocalCliAgent,
  options: CliConfigReadOptions = {}
): Promise<LocalCliModelCatalog> {
  const homeDir = options.homeDir ?? homedir();
  const env = options.env ?? process.env;
  const readText: ReadText = options.readTextFile ?? ((path: string) => readFile(path, 'utf8'));
  switch (agent) {
    case 'codex':
      return readCodexCatalog(homeDir, readText);
    case 'claude':
      return readClaudeCatalog(homeDir, readText);
    case 'opencode':
      return readOpencodeCatalog(homeDir, env, readText);
    case 'zcode':
      return readZcodeCatalog(homeDir, readText);
  }
}

/** Appends models the CLI itself advertised; config candidates win on conflict. */
export function mergeCliAdvertisedModels(
  catalog: LocalCliModelCatalog,
  advertised: string[] | undefined,
  source: string
): LocalCliModelCatalog {
  if (!advertised || advertised.length === 0) return catalog;
  const options = [...catalog.options];
  for (const id of advertised) options.push(option(id, 'cli', source));
  return { ...catalog, options: dedupe(options) };
}
