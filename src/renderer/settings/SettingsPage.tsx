import { useCallback, useEffect, useState } from 'react';
import type {
  LocalCliAgent,
  NotificationSettings,
  ProviderConfig
} from '../../shared/types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { CheckIcon } from '../ui/icons';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { Select } from '../ui/Select';

type SettingsPageProps = {
  onClose: () => void;
  embedded?: boolean;
};

const providerLabels: Record<ProviderConfig['kind'], string> = {
  anthropic: 'Anthropic',
  'openai-compatible': 'OpenAI 兼容',
  ollama: 'Ollama',
  'local-cli': '本地 CLI agent'
};

const cliAgents: LocalCliAgent[] = ['codex', 'claude', 'zcode', 'opencode'];

export function SettingsPage({ onClose, embedded = false }: SettingsPageProps) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<ProviderConfig['kind']>('anthropic');
  const [model, setModel] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [cliAgent, setCliAgent] = useState<LocalCliAgent>('codex');
  const [cliCommand, setCliCommand] = useState('codex');
  const [apiKey, setApiKey] = useState('');
  const [sessions, setSessions] = useState('4');
  const [tokens, setTokens] = useState('200000');
  const [notifications, setNotifications] = useState<NotificationSettings>({
    enabled: true,
    morning: '08:00',
    evening: '21:30',
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
      const value = await api.getSettings();
      setKind(value.provider.kind);
      setModel(value.provider.model ?? '');
      setBaseURL('baseURL' in value.provider ? value.provider.baseURL : '');
      if (value.provider.kind === 'local-cli') {
        setCliAgent(value.provider.agent);
        setCliCommand(value.provider.command ?? value.provider.agent);
      }
      setSessions(String(value.budget.proactiveSessionsPerDay));
      setTokens(String(value.budget.dailyTokens));
      setNotifications(value.notifications);
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
                ...(model.trim() ? { model: model.trim() } : {})
              }
            : { kind, baseURL, model };
      await api.updateSettings({
        provider,
        budget: {
          proactiveSessionsPerDay: sessionsNumber,
          dailyTokens: tokensNumber
        },
        notifications,
        launchAtLogin
      });
      if (apiKey.trim()) {
        await api.setApiKey(apiKey.trim());
      }
      setApiKey('');
      setStatus('已保存');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存设置失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  function resetPrototype() {
    if (!window.studyCoachPrototype) return;
    if (window.confirm('清除原型数据并重新开始？')) {
      window.studyCoachPrototype.reset();
    }
  }

  return (
    <div>
      <header
        className={
          embedded
            ? 'flex flex-wrap items-center justify-between gap-3'
            : 'flex flex-col gap-6 md:flex-row md:items-end md:justify-between'
        }
      >
        <div>
          <h2
            className={
              embedded
                ? 'text-[15px] font-semibold tracking-tight text-black'
                : 'text-3xl font-semibold tracking-tight text-black md:text-4xl'
            }
          >
            设置
          </h2>
          <p className={embedded ? 'mt-0.5 text-[12px] text-gray-500' : 'mt-2 text-gray-600'}>
            管理模型、预算与提醒。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            返回今日
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? '正在保存…' : '保存设置'}
          </Button>
        </div>
      </header>

      {status || error ? (
        <div className="mt-4 flex flex-wrap items-center gap-4">
          {status ? (
            <p role="status" className="inline-flex items-center gap-2 text-sm text-[#1d1d1f]">
              <CheckIcon className="h-4 w-4 text-[#34c759]" />
              {status}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-[#d70015]">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      {loadError ? (
        <div className="mt-8">
          <p role="alert" className="text-sm text-[#d70015]">
            {loadError}
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => void load()}>
            重新加载
          </Button>
        </div>
      ) : !loaded ? (
        <p className="mt-10 text-gray-600">正在加载设置…</p>
      ) : (
        <div className="mt-8 grid gap-8">
          <Card id="settings-model-section">
            <h3 className="text-xl font-semibold tracking-tight text-black md:text-2xl">模型</h3>
            <p className="mt-2 text-gray-600">选择模型提供商并配置访问凭据。</p>
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
                <p className="text-sm text-gray-600 md:col-span-2">
                  使用本机已登录的 CLI agent，不需要 API key；命令会在临时目录中运行。
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
                <p className="mt-2 text-sm text-gray-600">
                  原型模式下，API Key 只保存在当前页面内存，不会写入浏览器存储或发送到服务器。
                </p>
              </div>
            ) : null}
          </Card>

          <Card id="settings-budget">
            <h3 className="text-xl font-semibold tracking-tight text-black md:text-2xl">预算</h3>
            <p className="mt-2 text-gray-600">限制每天主动调用模型的次数与 token 用量。</p>
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
            </div>
          </Card>

          <Card id="settings-notifications">
            <h3 className="text-xl font-semibold tracking-tight text-black md:text-2xl">通知</h3>
            <p className="mt-2 text-gray-600">设置早间计划与晚间复盘提醒。</p>
            <label className="mt-6 flex min-h-11 items-center gap-3 text-sm font-medium text-gray-600">
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
          </Card>

          <Card id="settings-launch">
            <h3 className="text-xl font-semibold tracking-tight text-black md:text-2xl">启动</h3>
            <label className="mt-4 flex min-h-11 items-center gap-3 text-sm font-medium text-gray-600">
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
