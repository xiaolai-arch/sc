import { useState } from 'react';
import type { FormEvent } from 'react';
import type { WorkspaceKind, WorkspaceOnboardingInput } from '../../shared/workspace';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { PageShell } from '../ui/PageShell';
import { Select } from '../ui/Select';

type WorkspaceOnboardingProps = {
  onComplete?: () => void;
};

const KINDS: Array<{ value: WorkspaceKind; label: string }> = [
  { value: 'study', label: '学习' },
  { value: 'exam', label: '考研' },
  { value: 'project', label: '项目' },
  { value: 'life', label: '生活' }
];

export function WorkspaceOnboarding({ onComplete }: WorkspaceOnboardingProps) {
  const [name, setName] = useState('我的学习');
  const [kind, setKind] = useState<WorkspaceKind>('study');
  const [goal, setGoal] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete(input: WorkspaceOnboardingInput) {
    const api = window.studyCoach;
    if (!api) throw new Error('应用桥接不可用，请刷新页面重试。');
    setBusy(true);
    setError(null);
    try {
      await api.completeWorkspaceOnboarding(input);
      onComplete?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建 workspace 失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError('请填写 workspace 名称。');
      return;
    }
    if (!goal.trim()) {
      setError('请先写一个想达成的目标。');
      return;
    }
    await complete({
      name: name.trim(),
      kind,
      goal: goal.trim(),
      description: description.trim()
    });
  }

  return (
    <PageShell>
      <header className="mx-auto max-w-[980px] px-6 py-8 md:px-8">
        <span className="text-xl font-semibold tracking-tight text-black">Study Coach</span>
      </header>
      <main className="mx-auto max-w-[980px] px-6 pb-20 md:px-8 md:pb-32">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-black md:text-5xl">
            先告诉我，
            <br />
            你想让我帮你管理什么？
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-base text-gray-600 md:text-lg">
            创建一个 workspace，我会在里面帮你规划、记录、讲解和督促。之后可以随时添加更多。
          </p>
        </div>

        <Card className="mx-auto mt-12 max-w-2xl p-8 md:mt-16 md:p-12">
          <form className="grid gap-6" onSubmit={submit} noValidate>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <Label htmlFor="workspace-name">Workspace 名称</Label>
                <Input
                  id="workspace-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：我的学习"
                  required
                />
              </div>
              <div>
                <Label htmlFor="workspace-kind">类型</Label>
                <Select
                  id="workspace-kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as WorkspaceKind)}
                >
                  {KINDS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="workspace-goal">你想先达成什么？</Label>
              <Input
                id="workspace-goal"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="例如：今年读完 12 本书 / 本月上线个人网站"
                required
              />
            </div>

            <div>
              <Label htmlFor="workspace-description">补充说明（可选）</Label>
              <Input
                id="workspace-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="例如：每天晚上 1 小时，周末可以多做一些"
              />
            </div>

            <p className="rounded-xl bg-[#f5f5f7] px-3 py-2 text-[12px] leading-5 text-gray-600">
              默认使用本地 CLI agent（codex），不需要 API key；之后可以在设置里切换 agent 或模型。
            </p>

            {error ? (
              <p role="alert" className="text-sm text-[#d70015]">
                {error}
              </p>
            ) : null}

            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Button type="submit" disabled={busy} className="w-full md:w-auto">
                {busy ? '正在创建…' : '开始使用'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void complete({
                    name: '示例工作区',
                    kind: 'study',
                    goal: '先看看示例',
                    description: '考研 / 英语 / 项目 / 生活的演示工作区',
                    useDemo: true
                  })
                }
              >
                先看看示例工作区
              </Button>
            </div>
          </form>
        </Card>
      </main>
    </PageShell>
  );
}
