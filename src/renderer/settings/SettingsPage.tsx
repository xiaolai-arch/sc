import { useCallback, useEffect, useRef, useState } from 'react';
import { formatLocalDate } from '../../shared/date';
import { friendlyErrorMessage } from '../../shared/errors';
import type {
  LocalCliAgent,
  LocalCliEffort,
  NotificationSettings,
  ProviderConfig
} from '../../shared/types';
import type {
  LocalCliEntry,
  LocalCliFeature,
  LocalCliScanResult
} from '../../shared/local-cli';
import type { UsageSummary } from '../../shared/usage';
import {
  loadThemePreference,
  setThemePreference,
  type ThemePreference
} from '../theme';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { CheckIcon } from '../ui/icons';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { Select } from '../ui/Select';

type SettingsPageProps = {
  onClose: () => void;
  embedded?: boolean;
  /** Full-page mode: the surrounding page owns the heading and back button. */
  page?: boolean;
  /** Whether the Electron/browser session already holds a stored key. */
  hasApiKey?: boolean;
  /** Reports unsaved edits so the shell can guard navigation. */
  onDirtyChange?: (dirty: boolean) => void;
};

const providerLabels: Record<ProviderConfig['kind'], string> = {
  anthropic: 'Anthropic',
  'openai-compatible': 'OpenAI 兼容',
  ollama: 'Ollama',
  'local-cli': '本地 CLI agent'
};

const cliAgents: LocalCliAgent[] = ['codex', 'claude', 'zcode', 'opencode'];

const cliAgentLabels: Record<LocalCliAgent, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
  zcode: 'ZCode',
  opencode: 'OpenCode'
};

const cliFeatureLabels: Record<LocalCliFeature, string> = {
  streaming: '流式',
  reasoning: '思考',
  'native-tools': '原生工具',
  web: '联网',
  sessions: '会话',
  mcp: 'MCP',
  skills: '技能',
  models: '模型列表',
  images: '图片',
  sandbox: '沙箱'
};

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
];

/** A saved key belongs to one endpoint; changing it requires re-entry. */
function providerEndpoint(provider: ProviderConfig): string {
  if (provider.kind === 'anthropic') return 'anthropic';
  if (provider.kind === 'local-cli') return `local-cli:${provider.agent}`;
  return `${provider.kind}:${provider.baseURL}`;
}

function cliAuthLabel(entry: LocalCliEntry): string {
  if (entry.auth === 'ready') return '已登录';
  if (entry.auth === 'missing') return '未登录';
  return '登录状态未知';
}

function cliAuthClass(entry: LocalCliEntry): string {
  if (entry.auth === 'ready') {
    return 'text-[#1d7a36] dark:text-[#7ee787]';
  }
  if (entry.auth === 'missing') {
    return 'text-[#b25000] dark:text-[#ffa657]';
  }
  return 'text-gray-500 dark:text-[#a1a1a6]';
}

export function SettingsPage({
  onClose,
  embedded = false,
  page = false,
  hasApiKey = false,
  onDirtyChange
}: SettingsPageProps) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<ProviderConfig['kind']>('anthropic');
  const [savedProvider, setSavedProvider] = useState<ProviderConfig | null>(null);
  const [model, setModel] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [cliAgent, setCliAgent] = useState<LocalCliAgent>('codex');
  const [cliCommand, setCliCommand] = useState('codex');
  const [cliEffort, setCliEffort] = useState<LocalCliEffort | ''>('');
  const [cliIsolate, setCliIsolate] = useState(false);
  const [cliNativeTools, setCliNativeTools] = useState(false);
  const [cliScan, setCliScan] = useState<LocalCliScanResult | null>(null);
  const [cliScanning, setCliScanning] = useState(false);
  const [cliScanError, setCliScanError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [keyConfigured, setKeyConfigured] = useState(hasApiKey);
  const [confirmClearKey, setConfirmClearKey] = useState(false);
  const [clearingKey, setClearingKey] = useState(false);

  useEffect(() => {
    setKeyConfigured(hasApiKey);
  }, [hasApiKey]);
  const [sessions, setSessions] = useState('4');
  const [tokens, setTokens] = useState('200000');
  const [inputPrice, setInputPrice] = useState('0');
  const [outputPrice, setOutputPrice] = useState('0');
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [confirmClearUsage, setConfirmClearUsage] = useState(false);
  const [clearingUsage, setClearingUsage] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference());
  const [exportingBackup, setExportingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [restoreSafetyPath, setRestoreSafetyPath] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<{
    kind: 'success' | 'canceled' | 'error';
    message: string;
  } | null>(null);
  const [notifications, setNotifications] = useState<NotificationSettings>({
    enabled: true,
    morning: '08:00',
    evening: '21:30',
    weekly: '20:00',
    weeklyEnabled: true,
    dndStart: '23:00',
    dndEnd: '07:30'
  });
  const [launchAtLogin, setLaunchAtLogin] = useState(false);
  const [displayName, setDisplayName] = useState('xiaolai');
  const baselineRef = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);

  function formSnapshot(apiKeyValue = apiKey): string {
    return JSON.stringify([
      kind,
      model,
      baseURL,
      cliAgent,
      cliCommand,
      cliEffort,
      cliIsolate,
      cliNativeTools,
      sessions,
      tokens,
      inputPrice,
      outputPrice,
      notifications,
      launchAtLogin,
      displayName,
      apiKeyValue
    ]);
  }

  useEffect(() => {
    if (!loaded) return;
    const current = formSnapshot();
    if (baselineRef.current === null) {
      baselineRef.current = current;
      setDirty(false);
      return;
    }
    setDirty(current !== baselineRef.current);
  }, [
    loaded,
    kind,
    model,
    baseURL,
    cliAgent,
    cliCommand,
    cliEffort,
    cliIsolate,
    cliNativeTools,
    sessions,
    tokens,
    inputPrice,
    outputPrice,
    notifications,
    launchAtLogin,
    displayName,
    apiKey
  ]);

  useEffect(() => {
    if (dirty) setStatus(null);
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const runCliScan = useCallback(async (auto = false) => {
    const api = window.studyCoach;
    if (!api || typeof api.scanLocalClis !== 'function') {
      if (!auto) setCliScanError('当前版本不支持扫描本机 CLI。');
      return;
    }
    setCliScanning(true);
    setCliScanError(null);
    try {
      setCliScan(await api.scanLocalClis());
    } catch (cause) {
      setCliScanError(friendlyErrorMessage(cause, '扫描本机 CLI 失败。'));
    } finally {
      setCliScanning(false);
    }
  }, []);

  const load = useCallback(async () => {
    const api = window.studyCoach;
    if (!api) {
      setLoadError('应用桥接不可用，请刷新页面重试。');
      setLoaded(true);
      return;
    }
    setLoadError(null);
    try {
      const usagePromise: Promise<UsageSummary | null> =
        typeof api.getUsageSummary === 'function'
          ? api.getUsageSummary(7).catch((cause: unknown) => {
              setUsageError(friendlyErrorMessage(cause, '用量读取失败。'));
              return null;
            })
          : Promise.resolve(null);
      const [value, usageSummary] = await Promise.all([api.getSettings(), usagePromise]);
      setSavedProvider(value.provider);
      setKind(value.provider.kind);
      setModel(value.provider.model ?? '');
      setBaseURL('baseURL' in value.provider ? value.provider.baseURL : '');
      if (value.provider.kind === 'local-cli') {
        setCliAgent(value.provider.agent);
        setCliCommand(value.provider.command ?? value.provider.agent);
        setCliEffort(value.provider.effort ?? '');
        setCliIsolate(value.provider.isolate === true);
        setCliNativeTools(value.provider.nativeTools === true);
      }
      setSessions(String(value.budget.proactiveSessionsPerDay));
      setTokens(String(value.budget.dailyTokens));
      setInputPrice(String(value.budget.inputPricePerMillion ?? 0));
      setOutputPrice(String(value.budget.outputPricePerMillion ?? 0));
      setUsage(usageSummary);
      setNotifications({
        enabled: value.notifications.enabled ?? true,
        morning: value.notifications.morning ?? '08:00',
        evening: value.notifications.evening ?? '21:30',
        weekly: value.notifications.weekly ?? '20:00',
        weeklyEnabled: value.notifications.weeklyEnabled ?? true,
        dndStart: value.notifications.dndStart ?? '23:00',
        dndEnd: value.notifications.dndEnd ?? '07:30'
      });
      setLaunchAtLogin(value.launchAtLogin);
      setDisplayName(value.displayName?.trim() || 'xiaolai');
      setLoaded(true);
    } catch (cause) {
      setLoadError(friendlyErrorMessage(cause, '加载设置失败。'));
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loaded || kind !== 'local-cli' || cliScan || cliScanning) return;
    void runCliScan(true);
  }, [loaded, kind, cliScan, cliScanning, runCliScan]);

  function updateKind(next: ProviderConfig['kind']) {
    if (next === kind) return;
    setKind(next);
    if (next === 'ollama') {
      setBaseURL('http://127.0.0.1:11434/v1');
    } else if (kind === 'ollama' && baseURL === 'http://127.0.0.1:11434/v1') {
      setBaseURL('');
    }
    if (next === 'local-cli' && !cliCommand.trim()) {
      setCliCommand(cliAgent);
    }
  }

  function useCliEntry(entry: LocalCliEntry) {
    if (!entry.installed) return;
    setCliAgent(entry.agent);
    setCliCommand(entry.command);
    // A detected CLI is most useful as a full agent; the user can turn it off.
    setCliNativeTools(true);
    setCliScanError(null);
    setStatus(`已选择 ${entry.label}${entry.version ? ` ${entry.version}` : ''}`);
  }

  async function save() {
    const api = window.studyCoach;
    if (!api) {
      setError('应用桥接不可用，请刷新页面重试。');
      return;
    }
    setError(null);
    setStatus(null);
    const sessionsNumber = Number(sessions);
    const tokensNumber = Number(tokens);
    const inputPriceNumber = Number(inputPrice);
    const outputPriceNumber = Number(outputPrice);
    const trimmedDisplayName = displayName.trim();
    if (!trimmedDisplayName) {
      setError('请填写称呼。');
      return;
    }
    if (kind !== 'local-cli' && !model.trim()) {
      setError('请填写模型名称。');
      return;
    }    if ((kind === 'openai-compatible' || kind === 'ollama') && !baseURL.trim()) {
      setError('请填写 Base URL。');
      return;
    }
    if (kind === 'local-cli' && !cliCommand.trim()) {
      setError('请填写本地 CLI 命令。');
      return;
    }
    if (!Number.isInteger(sessionsNumber) || sessionsNumber < 0) {
      setError('每日主动会话次数需为非负整数。');
      return;
    }
    if (!Number.isInteger(tokensNumber) || tokensNumber < 0) {
      setError('每日 token 上限需为非负整数。');
      return;
    }
    if (!Number.isFinite(inputPriceNumber) || inputPriceNumber < 0) {
      setError('输入价格需为非负数字。');
      return;
    }
    if (!Number.isFinite(outputPriceNumber) || outputPriceNumber < 0) {
      setError('输出价格需为非负数字。');
      return;
    }
    setSaving(true);
    try {
      const provider: ProviderConfig =
        kind === 'anthropic'
          ? { kind, model }
          : kind === 'local-cli'
            ? {
                kind,
                agent: cliAgent,
                command: cliCommand.trim(),
                ...(cliAgent !== 'zcode' && model.trim() ? { model: model.trim() } : {}),
                ...(cliAgent === 'codex' ||
                cliAgent === 'claude' ||
                cliAgent === 'opencode'
                  ? cliEffort
                    ? { effort: cliEffort }
                    : {}
                  : {}),
                ...(cliAgent === 'claude' && cliIsolate && !cliNativeTools
                  ? { isolate: true }
                  : {}),
                ...(cliNativeTools ? { nativeTools: true } : {})
              }
            : { kind, baseURL, model };
      const endpointChanged =
        savedProvider !== null &&
        providerEndpoint(savedProvider) !== providerEndpoint(provider);
      if (endpointChanged) {
        // A key issued for the previous endpoint must never be sent to the new
        // one. Clear it before rebuilding services, then save a new key if given.
        await api.setApiKey('');
        setKeyConfigured(false);
      }
      await api.updateSettings({
        displayName: trimmedDisplayName,
        provider,
        budget: {
          proactiveSessionsPerDay: sessionsNumber,
          dailyTokens: tokensNumber,
          inputPricePerMillion: inputPriceNumber,
          outputPricePerMillion: outputPriceNumber
        },
        notifications,
        launchAtLogin
      });
      if (apiKey.trim()) {
        await api.setApiKey(apiKey.trim());
        setKeyConfigured(true);
      }
      setSavedProvider(provider);
      setApiKey('');
      setStatus('已保存');
      baselineRef.current = formSnapshot('');
      setDirty(false);
      // Re-price the existing summary with the just-saved prices. A refresh
      // failure must not turn the successful save into an error.
      try {
        if (typeof api.getUsageSummary === 'function') {
          setUsage(await api.getUsageSummary(7));
        }
      } catch (cause) {
        setUsageError(friendlyErrorMessage(cause, '用量读取失败。'));
      }
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '保存设置失败，请重试。'));
    } finally {
      setSaving(false);
    }
  }

  async function clearApiKey() {
    const api = window.studyCoach;
    if (!api) return;
    if (!confirmClearKey) {
      setConfirmClearKey(true);
      return;
    }
    setClearingKey(true);
    setError(null);
    try {
      await api.setApiKey('');
      setKeyConfigured(false);
      setApiKey('');
      setConfirmClearKey(false);
      setStatus('已清除 API Key');
      baselineRef.current = formSnapshot('');
      setDirty(false);
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '清除 API Key 失败，请重试。'));
    } finally {
      setClearingKey(false);
    }
  }

  async function clearUsage() {
    const api = window.studyCoach;
    if (!api || typeof api.clearUsage !== 'function') return;
    setClearingUsage(true);
    setUsageError(null);
    try {
      await api.clearUsage();
      setConfirmClearUsage(false);
      if (typeof api.getUsageSummary === 'function') {
        setUsage(await api.getUsageSummary(7));
      }
    } catch (cause) {
      setUsageError(friendlyErrorMessage(cause, '清空用量失败，请重试。'));
    } finally {
      setClearingUsage(false);
    }
  }

  function chooseTheme(preference: ThemePreference) {
    setTheme(preference);
    setThemePreference(preference);
  }

  async function exportBackup() {
    const api = window.studyCoach;
    if (!api || typeof api.exportBackup !== 'function') {
      setBackupStatus({ kind: 'error', message: '当前版本不支持导出备份。' });
      return;
    }
    setExportingBackup(true);
    setBackupStatus(null);
    try {
      const result = await api.exportBackup();
      if (result === null) {
        setBackupStatus({ kind: 'canceled', message: '已取消' });
      } else {
        setBackupStatus({ kind: 'success', message: `已导出到 ${result.path}` });
      }
    } catch (cause) {
      setBackupStatus({
        kind: 'error',
        message: friendlyErrorMessage(cause, '导出备份失败，请重试。')
      });
    } finally {
      setExportingBackup(false);
    }
  }

  async function restoreBackup() {
    const api = window.studyCoach;
    if (!api || typeof api.restoreBackup !== 'function') {
      setBackupStatus({ kind: 'error', message: '当前版本不支持恢复备份。' });
      return;
    }
    const confirmed = window.confirm(
      '从备份恢复会覆盖当前项目、记录和对话。恢复前会自动保存一份当前数据的快照；当前设置和 API Key 保持不变。继续？'
    );
    if (!confirmed) {
      setBackupStatus({ kind: 'canceled', message: '已取消恢复' });
      return;
    }
    setRestoringBackup(true);
    setBackupStatus(null);
    setRestoreSafetyPath(null);
    try {
      const result = await api.restoreBackup();
      if (result === null) {
        setBackupStatus({ kind: 'canceled', message: '已取消' });
      } else {
        setRestoreSafetyPath(result.safetyPath);
        setBackupStatus({ kind: 'success', message: '恢复完成，重启后生效。' });
      }
    } catch (cause) {
      setBackupStatus({
        kind: 'error',
        message: friendlyErrorMessage(cause, '恢复备份失败，请重试。')
      });
    } finally {
      setRestoringBackup(false);
    }
  }

  function resetPrototype() {
    if (!window.studyCoachPrototype) return;
    if (window.confirm('清除原型数据并重新开始？')) {
      window.studyCoachPrototype.reset();
    }
  }

  const detectedCliModels =
    kind === 'local-cli'
      ? (cliScan?.entries.find((entry) => entry.agent === cliAgent)?.models ?? [])
      : [];
  const today = formatLocalDate(new Date());
  const todayUsage = usage?.days.find((day) => day.date === today) ?? {
    inputTokens: 0,
    outputTokens: 0,
    calls: 0
  };
  const tokenLimit = Number.parseInt(tokens, 10);
  const todayTokens = todayUsage.inputTokens + todayUsage.outputTokens;
  const budgetExhausted =
    Number.isInteger(tokenLimit) && tokenLimit >= 0 && todayTokens >= tokenLimit;

  return (
    <div>
      <header
        className={
          embedded || page
            ? 'flex flex-wrap items-center justify-between gap-3'
            : 'flex flex-col gap-6 md:flex-row md:items-end md:justify-between'
        }
      >
        <div>
          <h2
            className={
              page
                ? 'sr-only'
                : embedded
                  ? 'text-[15px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]'
                  : 'text-3xl font-semibold tracking-tight text-black dark:text-[#f5f5f7] md:text-4xl'
            }
          >
            设置
          </h2>
          {!page ? (
            <p className={embedded ? 'mt-0.5 text-[12px] text-gray-500 dark:text-[#8e8e93]' : 'mt-2 text-gray-500 dark:text-[#a1a1a6]'}>
              管理模型、预算与提醒。
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!page ? (
            <Button variant="secondary" size="sm" onClick={onClose}>
              关闭
            </Button>
          ) : null}
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? '正在保存…' : '保存设置'}
          </Button>
        </div>
      </header>

      {status || error ? (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {status ? (
            <p role="status" className="inline-flex items-center gap-2 text-sm text-[#1d1d1f] dark:text-[#f5f5f7]">
              <CheckIcon className="h-4 w-4 text-[#34c759]" />
              {status}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-[#d70015] dark:text-[#ff7b72]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {loadError ? (
        <div className="mt-8">
          <p role="alert" className="text-sm text-[#d70015] dark:text-[#ff7b72]">
            {loadError}
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => void load()}>
            重新加载
          </Button>
        </div>
      ) : !loaded ? (
        <p className="mt-10 text-gray-500 dark:text-[#a1a1a6]">正在加载设置…</p>
      ) : (
        <div className="mt-8 grid gap-8">
          <Card id="settings-profile-section">
            <h3 className="text-[17px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">个人</h3>
            <p className="mt-2 text-gray-500 dark:text-[#a1a1a6]">阿咲在首页和侧边栏怎么称呼你。</p>
            <div className="mt-6 max-w-sm">
              <Label htmlFor="settings-display-name">称呼</Label>
              <Input
                id="settings-display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={24}
              />
            </div>
          </Card>
          <Card id="settings-model-section">
            <h3 className="text-[17px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">模型</h3>
            <p className="mt-2 text-gray-500 dark:text-[#a1a1a6]">选择模型提供商并配置访问凭据。</p>
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <div>
                <Label htmlFor="settings-provider">提供商</Label>
                <Select
                  id="settings-provider"
                  value={kind}
                  onChange={(event) => updateKind(event.target.value as ProviderConfig['kind'])}
                >
                  {(Object.keys(providerLabels) as ProviderConfig['kind'][]).map((value) => (
                    <option key={value} value={value}>
                      {providerLabels[value]}
                    </option>
                  ))}
                </Select>
              </div>
              {kind === 'local-cli' && cliAgent === 'zcode' ? null : (
                <div>
                  <Label htmlFor="settings-model">模型名称</Label>
                  <Input
                    id="settings-model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    list={detectedCliModels.length > 0 ? 'settings-cli-models' : undefined}
                  />
                  {detectedCliModels.length > 0 ? (
                    <datalist id="settings-cli-models">
                      {detectedCliModels.map((value) => (
                        <option key={value} value={value} />
                      ))}
                    </datalist>
                  ) : null}
                </div>
              )}
            </div>

            {kind === 'local-cli' ? (
              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <div className="rounded-xl border border-black/[0.06] bg-[#f5f5f7]/70 p-4 dark:border-white/[0.08] dark:bg-white/[0.03] md:col-span-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">本机 CLI</p>
                      <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-[#a1a1a6]">
                        扫描 PATH、Homebrew、nvm/asdf/mise 和登录 shell，检测版本、登录状态与原生能力。
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void runCliScan()}
                      disabled={cliScanning}
                    >
                      {cliScanning ? '正在扫描…' : cliScan ? '重新扫描' : '扫描本机 CLI'}
                    </Button>
                  </div>
                  {cliScanError ? (
                    <p role="alert" className="mt-3 text-xs text-[#d70015] dark:text-[#ff7b72]">
                      {cliScanError}
                    </p>
                  ) : null}
                  {cliScan ? (
                    <div
                      className="mt-3 grid gap-2"
                      role="list"
                      aria-label="本机 CLI 扫描结果"
                    >
                      {cliScan.entries.map((entry) => (
                        <div
                          key={entry.agent}
                          role="listitem"
                          className="rounded-lg bg-white/80 p-3 dark:bg-black/20"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                                {entry.label}
                                {entry.version ? (
                                  <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-normal text-gray-500 dark:bg-white/[0.08] dark:text-[#a1a1a6]">
                                    {entry.version}
                                  </span>
                                ) : null}
                                {entry.installed ? (
                                  <span className={`text-[11px] font-normal ${cliAuthClass(entry)}`}>
                                    {cliAuthLabel(entry)}
                                  </span>
                                ) : null}
                              </p>
                              <p
                                className="mt-1 truncate text-xs text-gray-500 dark:text-[#a1a1a6]"
                                title={entry.installed ? entry.path : entry.installHint}
                              >
                                {entry.installed ? entry.path : `未安装 · ${entry.installHint}`}
                              </p>
                              {entry.installed && entry.features.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {entry.features.map((feature) => (
                                    <span
                                      key={feature}
                                      className="rounded-full bg-[#0071e3]/8 px-2 py-0.5 text-[11px] text-[#0066cc] dark:bg-[#0a84ff]/15 dark:text-[#4da3ff]"
                                    >
                                      {cliFeatureLabels[feature]}
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                              {entry.models?.length ? (
                                <p className="mt-1 text-[11px] text-gray-500 dark:text-[#8e8e93]">
                                  {entry.models.length} 个可用模型
                                </p>
                              ) : null}
                              {entry.authDetail && entry.auth !== 'ready' ? (
                                <p className="mt-1 text-[11px] text-gray-500 dark:text-[#8e8e93]">
                                  {entry.authDetail}
                                </p>
                              ) : null}
                              {entry.error ? (
                                <p className="mt-1 text-[11px] text-[#d70015] dark:text-[#ff7b72]">
                                  {entry.error}
                                </p>
                              ) : null}
                            </div>
                            <div className="shrink-0">
                              {entry.installed ? (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  aria-label={`使用 ${entry.label}`}
                                  onClick={() => useCliEntry(entry)}
                                >
                                  使用
                                </Button>
                              ) : (
                                <span className="text-[11px] text-gray-500 dark:text-[#8e8e93]">
                                  未安装
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div>
                  <Label htmlFor="settings-cli-agent">CLI agent</Label>
                  <Select
                    id="settings-cli-agent"
                    value={cliAgent}
                    onChange={(event) => {
                      const next = event.target.value as LocalCliAgent;
                      setCliAgent(next);
                      setCliCommand(next);
                    }}
                  >
                    {cliAgents.map((agent) => (
                      <option key={agent} value={agent}>
                        {cliAgentLabels[agent]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="settings-cli-command">CLI 命令</Label>
                  <Input
                    id="settings-cli-command"
                    value={cliCommand}
                    onChange={(event) => setCliCommand(event.target.value)}
                    placeholder="codex"
                  />
                </div>
                {cliAgent === 'codex' || cliAgent === 'claude' || cliAgent === 'opencode' ? (
                  <div>
                    <Label htmlFor="settings-cli-effort">推理强度</Label>
                    <Select
                      id="settings-cli-effort"
                      value={cliEffort}
                      onChange={(event) =>
                        setCliEffort(event.target.value as LocalCliEffort | '')
                      }
                    >
                      <option value="">默认</option>
                      <option value="low">低</option>
                      <option value="medium">中</option>
                      <option value="high">高</option>
                    </Select>
                  </div>
                ) : null}
                <label className="flex items-start gap-3 rounded-xl border border-black/[0.06] p-3 text-sm text-gray-500 dark:border-white/[0.08] dark:text-[#a1a1a6] md:col-span-2">
                  <input
                    type="checkbox"
                    aria-label="使用 CLI 原生工具"
                    checked={cliNativeTools}
                    onChange={(event) => setCliNativeTools(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded-[4px] accent-[#0071e3]"
                  />
                  <span>
                    使用 CLI 原生工具（完整 agent 模式）
                    <span className="mt-1 block text-xs text-gray-500 dark:text-[#8e8e93]">
                      让 CLI 在 vault 中直接读文件、改笔记、运行命令和使用联网工具；关闭时只把它当成一次性文本模型，并在临时目录中运行。
                    </span>
                  </span>
                </label>
                {cliAgent === 'claude' ? (
                  <label className="flex items-start gap-3 text-sm text-gray-500 dark:text-[#a1a1a6] md:col-span-2">
                    <input
                      type="checkbox"
                      checked={cliIsolate}
                      disabled={cliNativeTools}
                      onChange={(event) => setCliIsolate(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded-[4px] accent-[#0071e3] disabled:opacity-40"
                    />
                    <span>
                      隔离 Claude Code 全局配置（--bare）
                      <span className="mt-1 block text-xs text-gray-500 dark:text-[#8e8e93]">
                        跳过 hooks / skills / CLAUDE.md，思考过程不会被本机全局配置污染。需要 API Key，OAuth 登录可能不可用。
                        {cliNativeTools ? ' 原生工具模式会忽略 --bare。' : ''}
                      </span>
                    </span>
                  </label>
                ) : null}
                {cliAgent === 'zcode' ? (
                  <p className="text-sm text-gray-500 dark:text-[#a1a1a6] md:col-span-2">
                    zcode 的模型和推理强度在 zcode 内切换（/model），本应用不会覆盖。
                  </p>
                ) : null}
                <p className="text-sm text-gray-500 dark:text-[#a1a1a6] md:col-span-2">
                  使用本机已登录的 CLI agent，不需要 API key。关闭原生工具时命令在临时目录中运行；
                  开启后 CLI 在当前 vault workspace 中运行，并使用它自己的文件、命令与联网工具。
                  Codex 使用 -c model_reasoning_effort，Claude 使用 --effort，opencode 使用
                  --model provider/model#variant。Claude 会逐字返回思考；Codex 的 --json 只在思考完成后返回整段。
                </p>
              </div>
            ) : null}

            {(kind === 'openai-compatible' || kind === 'ollama') ? (
              <div className="mt-5">
                <Label htmlFor="settings-base-url">Base URL</Label>
                <Input
                  id="settings-base-url"
                  value={baseURL}
                  onChange={(event) => setBaseURL(event.target.value)}
                  placeholder="https://api.example.com/v1"
                />
              </div>
            ) : null}

            {kind !== 'local-cli' ? (
              <div className="mt-5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="settings-api-key">API Key</Label>
                  <span
                    className={`text-[12px] font-medium ${
                      keyConfigured
                        ? 'text-[#1d7a36] dark:text-[#7ee787]'
                        : 'text-gray-500 dark:text-[#a1a1a6]'
                    }`}
                  >
                    {keyConfigured ? '已配置' : '未配置'}
                  </span>
                </div>
                <Input
                  id="settings-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={keyConfigured ? '已保存，留空则保持不变' : '粘贴 API Key'}
                  autoComplete="off"
                />
                <p className="mt-2 text-sm text-gray-500 dark:text-[#a1a1a6]">
                  {window.studyCoachPrototype
                    ? '原型模式下，API Key 只保存在当前页面内存，刷新页面即清空。'
                    : 'API Key 通过系统钥匙串加密保存（Electron safeStorage），不会写入 vault、日志或测试快照；对话时只发送给当前选择的模型服务。'}
                </p>
                {keyConfigured ? (
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={clearingKey}
                      onClick={() => void clearApiKey()}
                    >
                      {clearingKey
                        ? '正在清除…'
                        : confirmClearKey
                          ? '确认清除'
                          : '清除已保存的密钥'}
                    </Button>
                    {confirmClearKey ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirmClearKey(false)}
                      >
                        取消
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card id="settings-budget">
            <h3 className="text-[17px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">预算</h3>
            <p className="mt-2 text-gray-500 dark:text-[#a1a1a6]">限制每天主动调用模型的次数与 token 用量。</p>
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <div>
                <Label htmlFor="settings-sessions">每日主动会话次数</Label>
                <Input
                  id="settings-sessions"
                  type="number"
                  min={0}
                  value={sessions}
                  onChange={(event) => setSessions(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="settings-tokens">每日 token 上限</Label>
                <Input
                  id="settings-tokens"
                  type="number"
                  min={0}
                  value={tokens}
                  onChange={(event) => setTokens(event.target.value)}
                />
                <p className="mt-1 text-[12px] text-gray-500 dark:text-[#a1a1a6]">
                  今日 token 达到上限后，主动检查会暂停；0 表示暂停主动检查。
                </p>
              </div>
              <div>
                <Label htmlFor="settings-input-price">输入价格（元/百万 token）</Label>
                <Input
                  id="settings-input-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={inputPrice}
                  onChange={(event) => setInputPrice(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="settings-output-price">输出价格（元/百万 token）</Label>
                <Input
                  id="settings-output-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={outputPrice}
                  onChange={(event) => setOutputPrice(event.target.value)}
                />
              </div>
            </div>
          </Card>

          <Card id="settings-usage">
            <h3 className="text-[17px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">
              用量与成本
            </h3>
            <p className="mt-2 text-gray-500 dark:text-[#a1a1a6]">本地统计，只记录 token 与调用次数，不上传。</p>
            {usageError ? (
              <p role="alert" className="mt-3 text-sm text-[#d70015] dark:text-[#ff7b72]">
                {usageError}
              </p>
            ) : null}
            {usage === null || usage.totals.calls === 0 ? (
              <div className="mt-4 space-y-1">
                <p className="text-sm text-gray-500 dark:text-[#a1a1a6]">
                  还没有用量记录。和阿咲对话后这里会显示本地统计。
                </p>
                <p className="text-sm text-gray-500 dark:text-[#a1a1a6]">
                  每日 token 上限：{Number.isInteger(tokenLimit) ? tokenLimit : '不限'}
                </p>
              </div>
            ) : (
              <>
                <div className="mt-6 grid gap-5 md:grid-cols-2">
                  <div>
                    <p className="text-sm font-medium text-gray-500 dark:text-[#a1a1a6]">今日</p>
                    <p className="mt-1 text-sm text-black dark:text-[#f5f5f7]">
                      输入 {todayUsage.inputTokens} · 输出 {todayUsage.outputTokens} · 调用{' '}
                      {todayUsage.calls}
                    </p>
                    <p
                      className={
                        budgetExhausted
                          ? 'mt-1 text-sm text-[#d70015] dark:text-[#ff7b72]'
                          : 'mt-1 text-sm text-gray-500 dark:text-[#a1a1a6]'
                      }
                    >
                      每日 token：{todayTokens} / {Number.isInteger(tokenLimit) ? tokenLimit : '不限'}
                      {budgetExhausted ? '（预算已用完，主动检查会暂停）' : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500 dark:text-[#a1a1a6]">最近 7 天</p>
                    <p className="mt-1 text-sm text-black dark:text-[#f5f5f7]">
                      输入 {usage.totals.inputTokens} · 输出 {usage.totals.outputTokens} · 调用{' '}
                      {usage.totals.calls}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-gray-500 dark:text-[#a1a1a6]">
                  {usage.estimatedCost === null
                    ? '设置单价后可估算成本'
                    : `估算成本 ¥${usage.estimatedCost.toFixed(2)}`}
                </p>
                <div className="mt-4 divide-y divide-gray-100 dark:divide-white/[0.08]">
                  {usage.days.map((day) => (
                    <div
                      key={day.date}
                      className="flex items-center justify-between gap-3 py-1.5 text-xs text-gray-500 dark:text-[#a1a1a6]"
                    >
                      <span>{day.date}</span>
                      <span>
                        输入 {day.inputTokens} · 输出 {day.outputTokens} · {day.calls} 次
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  {confirmClearUsage ? (
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={clearingUsage}
                      onClick={() => void clearUsage()}
                    >
                      确认清空
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setConfirmClearUsage(true)}
                    >
                      清空用量
                    </Button>
                  )}
                </div>
              </>
            )}
          </Card>

          <Card id="settings-backup">
            <h3 className="text-[17px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">
              数据与备份
            </h3>
            <p className="mt-2 text-gray-500 dark:text-[#a1a1a6]">
              备份包含项目、记录、对话、设置和用量，不包含 API Key。恢复会覆盖项目、记录和对话；当前设置与 API Key 保持不变。
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                disabled={exportingBackup || restoringBackup}
                onClick={() => void exportBackup()}
              >
                {exportingBackup ? '正在导出…' : '导出备份…'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={exportingBackup || restoringBackup}
                onClick={() => void restoreBackup()}
              >
                {restoringBackup ? '正在恢复…' : '从备份恢复…'}
              </Button>
              {restoreSafetyPath ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void window.studyCoach?.restartApp?.()}
                >
                  立即重启
                </Button>
              ) : null}
              {backupStatus ? (
                <p
                  {...(backupStatus.kind === 'success'
                    ? { role: 'status' }
                    : backupStatus.kind === 'error'
                      ? { role: 'alert' }
                      : {})}
                  className={
                    backupStatus.kind === 'error'
                      ? 'text-sm text-[#d70015] dark:text-[#ff7b72]'
                      : 'text-sm text-gray-500 dark:text-[#a1a1a6]'
                  }
                >
                  {backupStatus.message}
                </p>
              ) : null}
              {restoreSafetyPath ? (
                <p className="text-sm text-gray-500 dark:text-[#a1a1a6]">
                  恢复前的数据已保存在 {restoreSafetyPath}
                </p>
              ) : null}
            </div>
          </Card>

          <Card id="settings-notifications">
            <h3 className="text-[17px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">通知</h3>
            <p className="mt-2 text-gray-500 dark:text-[#a1a1a6]">设置早间计划、晚间复盘与周日复盘提醒。</p>
            <label className="mt-6 flex min-h-11 items-center gap-3 text-sm font-medium text-gray-500 dark:text-[#a1a1a6]">
              <input
                type="checkbox"
                checked={notifications.enabled}
                onChange={(event) =>
                  setNotifications((current) => ({ ...current, enabled: event.target.checked }))
                }
                className="h-5 w-5 rounded-[4px] accent-[#0071e3]"
              />
              启用提醒
            </label>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div>
                <Label htmlFor="settings-morning">早间时间</Label>
                <Input
                  id="settings-morning"
                  type="time"
                  value={notifications.morning}
                  onChange={(event) =>
                    setNotifications((current) => ({ ...current, morning: event.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="settings-evening">晚间时间</Label>
                <Input
                  id="settings-evening"
                  type="time"
                  value={notifications.evening}
                  onChange={(event) =>
                    setNotifications((current) => ({ ...current, evening: event.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="settings-dnd-start">免打扰开始</Label>
                <Input
                  id="settings-dnd-start"
                  type="time"
                  value={notifications.dndStart}
                  onChange={(event) =>
                    setNotifications((current) => ({ ...current, dndStart: event.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="settings-dnd-end">免打扰结束</Label>
                <Input
                  id="settings-dnd-end"
                  type="time"
                  value={notifications.dndEnd}
                  onChange={(event) =>
                    setNotifications((current) => ({ ...current, dndEnd: event.target.value }))
                  }
                />
              </div>
            </div>
            <label className="mt-5 flex min-h-11 items-center gap-3 text-sm font-medium text-gray-500 dark:text-[#a1a1a6]">
              <input
                type="checkbox"
                checked={notifications.weeklyEnabled}
                onChange={(event) =>
                  setNotifications((current) => ({
                    ...current,
                    weeklyEnabled: event.target.checked
                  }))
                }
                className="h-5 w-5 rounded-[4px] accent-[#0071e3]"
              />
              周日复盘
            </label>
            <div className="mt-3 max-w-xs">
              <Label htmlFor="settings-weekly">周复盘时间</Label>
              <Input
                id="settings-weekly"
                type="time"
                value={notifications.weekly}
                onChange={(event) =>
                  setNotifications((current) => ({ ...current, weekly: event.target.value }))
                }
              />
            </div>
          </Card>

          <Card id="settings-appearance">
            <h3 className="text-[17px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">
              外观
            </h3>
            <p className="mt-2 text-gray-500 dark:text-[#a1a1a6]">默认跟随系统；偏好只保存在本机。</p>
            <div
              role="group"
              aria-label="主题"
              className="mt-4 inline-flex rounded-full bg-[#f5f5f7] dark:bg-white/[0.08] p-1"
            >
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={theme === option.value}
                  onClick={() => chooseTheme(option.value)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 ${
                    theme === option.value
                      ? 'bg-white text-black dark:bg-[#242426] dark:text-[#f5f5f7] shadow-sm'
                      : 'text-gray-500 dark:text-[#a1a1a6] hover:text-black dark:hover:text-[#f5f5f7]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Card>

          <Card id="settings-launch">
            <h3 className="text-[17px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">启动</h3>
            <label className="mt-4 flex min-h-11 items-center gap-3 text-sm font-medium text-gray-500 dark:text-[#a1a1a6]">
              <input
                type="checkbox"
                checked={launchAtLogin}
                onChange={(event) => setLaunchAtLogin(event.target.checked)}
                className="h-5 w-5 rounded-[4px] accent-[#0071e3]"
              />
              开机自启
            </label>
          </Card>

          {window.studyCoachPrototype ? (
            <div className="border-t border-gray-200 pt-6">
              <Button variant="danger" size="sm" onClick={resetPrototype}>
                清除原型数据并重新开始
              </Button>
            </div>
          ) : null}

        </div>
      )}
    </div>
  );
}
