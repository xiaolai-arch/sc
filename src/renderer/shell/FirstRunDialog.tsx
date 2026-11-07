import { useState } from 'react';
import { friendlyErrorMessage } from '../../shared/errors';
import type { WorkspaceKind } from '../../shared/workspace';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { Select } from '../ui/Select';

const KIND_OPTIONS: Array<{ value: WorkspaceKind; label: string }> = [
  { value: 'study', label: '学习' },
  { value: 'exam', label: '考试' },
  { value: 'project', label: '项目' },
  { value: 'life', label: '生活' }
];

type FirstRunDialogProps = {
  open: boolean;
  /** Marks onboarding as handled and reloads the workspace data. */
  onComplete: () => void;
  /** Dismisses for this session without changing the saved onboarding state. */
  onSkip: () => void;
};

/**
 * First-run setup. A fresh install has no workspaces, and conversation-only
 * onboarding needs a working model, so the dialog creates a real workspace
 * without one.
 */
export function FirstRunDialog({ open, onComplete, onSkip }: FirstRunDialogProps) {
  const [name, setName] = useState('我的学习');
  const [kind, setKind] = useState<WorkspaceKind>('study');
  const [goal, setGoal] = useState('先完成今天最重要的一件事');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createWorkspace() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('先给项目起一个名字。');
      return;
    }
    const api = window.studyCoach;
    if (!api?.completeWorkspaceOnboarding) {
      setError('当前版本不支持创建项目，请更新应用。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.completeWorkspaceOnboarding({
        name: trimmed,
        kind,
        goal: goal.trim() || '先完成今天最重要的一件事',
        description: ''
      });
      onComplete();
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '创建项目失败，请重试。'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? () => undefined : onSkip}
      title="欢迎使用阿咲"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={onSkip} disabled={busy}>
            稍后再说
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void createWorkspace()}>
            {busy ? '正在创建…' : '创建项目并开始'}
          </Button>
        </div>
      }
    >
      <p className="text-[14px] leading-6 text-[#1d1d1f] dark:text-[#f5f5f7]">
        先建一个项目，之后可以让阿咲在对话里拆目标、排今天的事、记录复盘。
        数据保存在本地 markdown vault，不需要账号。
      </p>
      <p className="mt-2 text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">
        没有配置模型也可以先创建项目；模型可以在设置里稍后配置。
      </p>

      <div className="mt-5">
        <Label htmlFor="first-run-name">项目名称</Label>
        <Input
          id="first-run-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：考研、英语、我的项目"
          disabled={busy}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="first-run-kind">类型</Label>
          <Select
            id="first-run-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as WorkspaceKind)}
            disabled={busy}
          >
            {KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="first-run-goal">目标</Label>
          <Input
            id="first-run-goal"
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="先完成今天最重要的一件事"
            disabled={busy}
          />
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-[#d70015] dark:text-[#ff7b72]">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
