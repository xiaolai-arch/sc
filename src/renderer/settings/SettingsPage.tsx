import { useCallback, useEffect, useState } from 'react';
import { formatLocalDate } from '../../shared/date';
import type {
  LocalCliAgent,
  LocalCliEffort,
  NotificationSettings,
  ProviderConfig
} from '../../shared/types';
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
};

const providerLabels: Record<ProviderConfig['kind'], string> = {
  anthropic: 'Anthropic',
  'openai-compatible': 'OpenAI 兼容',
  ollama: 'Ollama',
  'local-cli': '本地 CLI agent'
};

const cliAgents: LocalCliAgent[] = ['codex', 'claude', 'zcode', 'opencode'];

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
];

export function SettingsPage({ onClose, embedded = false, page = false }: SettingsPageProps) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<ProviderConfig['kind']>('anthropic');
  const [model, setModel] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [cliAgent, setCliAgent] = useState<LocalCliAgent>('codex');
  const [cliCommand, setCliCommand] = useState('codex');
  const [cliEffort, setCliEffort] = useState<LocalCliEffort | ''>('');
  const [cliIsolate, setCliIsolate] = useState(false);
  const [apiKey, setApiKey] = useState('');
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

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
              setUsageError(cause instanceof Error ? cause.message : '用量读取失败。');
              return null;
            })
          : Promise.resolve(null);
      const [value, usageSummary] = await Promise.all([api.getSettings(), usagePromise]);
      setKind(value.provider.kind);
      setModel(value.provider.model ?? '');
      setBaseURL('baseURL' in value.provider ? value.provider.baseURL : '');
      if (value.provider.kind === 'local-cli') {
        setCliAgent(value.provider.agent);
        setCliCommand(value.provider.command ?? value.provider.agent);
        setCliEffort(value.provider.effort ?? '');
        setCliIsolate(value.provider.isolate === true);
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
      setLoaded(true);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : '加载设置失败。');
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    if (kind !== 'local-cli' && !model.trim()) {
      setError('请填写模型名称。');
      return;
    }
    if ((kind === 'openai-compatible' || kind === 'ollama') && !baseURL.trim()) {
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
                ...(model.trim() ? { model: model.trim() } : {}),
                ...(cliAgent === 'codex' || cliAgent === 'claude'
                  ? cliEffort
                    ? { effort: cliEffort }
                    : {}
                  : {}),
                ...(cliAgent === 'claude' && cliIsolate ? { isolate: true } : {})
              }
            : { kind, baseURL, model };
      await api.updateSettings({
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
      }
      setApiKey('');
      setStatus('已保存');
      // Re-price the existing summary with the just-saved prices. A refresh
      // failure must not turn the successful save into an error.
      try {
        if (typeof api.getUsageSummary === 'function') {
          setUsage(await api.getUsageSummary(7));
        }
      } catch (cause) {
        setUsageError(cause instanceof Error ? cause.message : '用量读取失败。');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存设置失败，请重试。');
    } finally {
      setSaving(false);
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
      setUsageError(cause instanceof Error ? cause.message : '清空用量失败，请重试。');
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
        message: cause instanceof Error ? cause.message : '导出备份失败，请重试。'
      });
    } finally {
      setExportingBackup(false);
    }
  }

  function resetPrototype() {
    if (!window.studyCoachPrototype) return;
    if (window.confirm('清除原型数据并重新开始？')) {
      window.studyCoachPrototype.reset();
    }
  }

  const today = formatLocalDate(new Date());
  const todayUsage = usage?.days.find((day) => day.date === today) ?? {
    inputTokens: 0,
    outputTokens: 0,
    calls: 0
  };

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
            <p className={embedded ? 'mt-0.5 text-[12px] text-gray-500 dark:text-[#8e8e93]' : 'mt-2 text-gray-600 dark:text-[#a1a1a6]'}>
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
        <p className="mt-10 text-gray-600 dark:text-[#a1a1a6]">正在加载设置…</p>
      ) : (
        <div className="mt-8 grid gap-8">
          <Card id="settings-model-section">
            <h3 className="text-xl font-semibold tracking-tight text-black dark:text-[#f5f5f7] md:text-2xl">模型</h3>
            <p className="mt-2 text-gray-600 dark:text-[#a1a1a6]">选择模型提供商并配置访问凭据。</p>
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
              <div>
                <Label htmlFor="settings-model">模型名称</Label>
                <Input id="settings-model" value={model} onChange={(event) => setModel(event.target.value)} />
              </div>
            </div>

            {kind === 'local-cli' ? (
              <div className="mt-5 grid gap-5 md:grid-cols-2">
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
                        {agent}
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
                {cliAgent === 'codex' || cliAgent === 'claude' ? (
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
                {cliAgent === 'claude' ? (
                  <label className="flex items-start gap-3 text-sm text-gray-600 dark:text-[#a1a1a6] md:col-span-2">
                    <input
                      type="checkbox"
                      checked={cliIsolate}
                      onChange={(event) => setCliIsolate(event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded accent-[#0071e3]"
                    />
                    <span>
                      隔离 Claude Code 全局配置（--bare）
                      <span className="mt-1 block text-xs text-gray-500 dark:text-[#8e8e93]">
                        跳过 hooks / skills / CLAUDE.md，思考过程不会被本机全局配置污染。需要 API Key，OAuth 登录可能不可用。
                      </span>
                    </span>
                  </label>
                ) : null}
                <p className="text-sm text-gray-600 dark:text-[#a1a1a6] md:col-span-2">
                  使用本机已登录的 CLI agent，不需要 API key；命令会在临时目录中运行。
                  Codex 使用 -c model_reasoning_effort，Claude 使用 --effort。
                  Claude 会逐字返回思考；Codex 的 --json 只在思考完成后返回整段。
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
                <Label htmlFor="settings-api-key">API Key</Label>
                <Input
                  id="settings-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="已保存则留空"
                  autoComplete="off"
                />
                <p className="mt-2 text-sm text-gray-600 dark:text-[#a1a1a6]">
                  原型模式下，API Key 只保存在当前页面内存，不会写入浏览器存储或发送到服务器。
                </p>
              </div>
            ) : null}
          </Card>

          <Card id="settings-budget">
            <h3 className="text-xl font-semibold tracking-tight text-black dark:text-[#f5f5f7] md:text-2xl">预算</h3>
            <p className="mt-2 text-gray-600 dark:text-[#a1a1a6]">限制每天主动调用模型的次数与 token 用量。</p>
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
            <h3 className="text-xl font-semibold tracking-tight text-black dark:text-[#f5f5f7] md:text-2xl">
              用量与成本
            </h3>
            <p className="mt-2 text-gray-600 dark:text-[#a1a1a6]">本地统计，只记录 token 与调用次数，不上传。</p>
            {usageError ? (
              <p role="alert" className="mt-3 text-sm text-[#d70015] dark:text-[#ff7b72]">
                {usageError}
              </p>
            ) : null}
            {usage === null || usage.totals.calls === 0 ? (
              <p className="mt-4 text-sm text-gray-600 dark:text-[#a1a1a6]">
                还没有用量记录。和管家对话后这里会显示本地统计。
              </p>
            ) : (
              <>
                <div className="mt-6 grid gap-5 md:grid-cols-2">
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-[#a1a1a6]">今日</p>
                    <p className="mt-1 text-sm text-black dark:text-[#f5f5f7]">
                      输入 {todayUsage.inputTokens} · 输出 {todayUsage.outputTokens} · 调用{' '}
                      {todayUsage.calls}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-[#a1a1a6]">最近 7 天</p>
                    <p className="mt-1 text-sm text-black dark:text-[#f5f5f7]">
                      输入 {usage.totals.inputTokens} · 输出 {usage.totals.outputTokens} · 调用{' '}
                      {usage.totals.calls}
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-gray-600 dark:text-[#a1a1a6]">
                  {usage.estimatedCost === null
                    ? '设置单价后可估算成本'
                    : `估算成本 ¥${usage.estimatedCost.toFixed(2)}`}
                </p>
                <div className="mt-4 divide-y divide-gray-100 dark:divide-white/[0.08]">
                  {usage.days.map((day) => (
                    <div
                      key={day.date}
                      className="flex items-center justify-between gap-3 py-1.5 text-xs text-gray-600 dark:text-[#a1a1a6]"
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
            <h3 className="text-xl font-semibold tracking-tight text-black dark:text-[#f5f5f7] md:text-2xl">
              数据与备份
            </h3>
            <p className="mt-2 text-gray-600 dark:text-[#a1a1a6]">
              备份包含项目、记录、对话、设置和用量，不包含 API Key。
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                disabled={exportingBackup}
                onClick={() => void exportBackup()}
              >
                {exportingBackup ? '正在导出…' : '导出备份…'}
              </Button>
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
                      : 'text-sm text-gray-600 dark:text-[#a1a1a6]'
                  }
                >
                  {backupStatus.message}
                </p>
              ) : null}
            </div>
          </Card>

          <Card id="settings-notifications">
            <h3 className="text-xl font-semibold tracking-tight text-black dark:text-[#f5f5f7] md:text-2xl">通知</h3>
            <p className="mt-2 text-gray-600 dark:text-[#a1a1a6]">设置早间计划、晚间复盘与周日复盘提醒。</p>
            <label className="mt-6 flex min-h-11 items-center gap-3 text-sm font-medium text-gray-600 dark:text-[#a1a1a6]">
              <input
                type="checkbox"
                checked={notifications.enabled}
                onChange={(event) =>
                  setNotifications((current) => ({ ...current, enabled: event.target.checked }))
                }
                className="h-5 w-5 rounded accent-[#0071e3]"
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
            <label className="mt-5 flex min-h-11 items-center gap-3 text-sm font-medium text-gray-600 dark:text-[#a1a1a6]">
              <input
                type="checkbox"
                checked={notifications.weeklyEnabled}
                onChange={(event) =>
                  setNotifications((current) => ({
                    ...current,
                    weeklyEnabled: event.target.checked
                  }))
                }
                className="h-5 w-5 rounded accent-[#0071e3]"
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
            <h3 className="text-xl font-semibold tracking-tight text-black dark:text-[#f5f5f7] md:text-2xl">
              外观
            </h3>
            <p className="mt-2 text-gray-600 dark:text-[#a1a1a6]">默认跟随系统；偏好只保存在本机。</p>
            <div
              role="group"
              aria-label="主题"
              className="mt-4 inline-flex rounded-full bg-[#f1eee8] dark:bg-white/[0.08] p-1"
            >
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={theme === option.value}
                  onClick={() => chooseTheme(option.value)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0071e3]/30 ${
                    theme === option.value
                      ? 'bg-white text-black dark:bg-[#242426] dark:text-[#f5f5f7] shadow-sm'
                      : 'text-[#6b6b70] dark:text-[#a1a1a6] hover:text-black dark:hover:text-[#f5f5f7]'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </Card>

          <Card id="settings-launch">
            <h3 className="text-xl font-semibold tracking-tight text-black dark:text-[#f5f5f7] md:text-2xl">启动</h3>
            <label className="mt-4 flex min-h-11 items-center gap-3 text-sm font-medium text-gray-600 dark:text-[#a1a1a6]">
              <input
                type="checkbox"
                checked={launchAtLogin}
                onChange={(event) => setLaunchAtLogin(event.target.checked)}
                className="h-5 w-5 rounded accent-[#0071e3]"
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
