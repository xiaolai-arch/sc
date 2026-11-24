import { useState } from 'react';
import {
  backupCopiedParts,
  MIGRATION_STEP_LINE_SETTINGS_ADOPTED,
  MIGRATION_STEP_LINE_SETTINGS_UNCHANGED
} from '../../shared/backup-copy';
import { friendlyErrorMessage } from '../../shared/errors';
import type { RestoreResult } from '../../shared/ipc';
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

/**
 * 首启恢复确认语，与设置页那句「会覆盖当前项目、记录和对话」分开写：首启没有
 * 可覆盖的东西，确认语只陈述事实，不吓唬换机用户（spec 增补节原文）。
 */
const FIRST_RUN_RESTORE_CONFIRM =
  '选择备份文件夹后，阿咲会把里面的项目、记录和对话恢复到这台电脑；备份里带设置时会一起还原（API Key 不会）。';

type FirstRunDialogProps = {
  open: boolean;
  /** Marks onboarding as handled (with the created project's name) and reloads. */
  onComplete: (workspaceName: string) => void;
  /**
   * A restore finished and the dialog is closed without creating a project:
   * refreshes and reloads so the restored workspaces show (and the dialog
   * stays gone when the adoption carried `onboarded: true`).
   */
  onRestoreComplete?: () => void;
  /** Dismisses for this session without changing the saved onboarding state. */
  onSkip: () => void;
};

/**
 * First-run setup. A fresh install has no workspaces, and conversation-only
 * onboarding needs a working model, so the dialog creates a real workspace
 * without one.
 */
export function FirstRunDialog({
  open,
  onComplete,
  onRestoreComplete,
  onSkip
}: FirstRunDialogProps) {
  const [name, setName] = useState('我的学习');
  const [kind, setKind] = useState<WorkspaceKind>('study');
  const [goal, setGoal] = useState('先完成今天最重要的一件事');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Creating and restoring are mutually exclusive; while either runs, the
  // dialog cannot be closed and the other action cannot start (busy 模式).
  const locked = busy || restoring;

  async function createWorkspace() {
    if (locked) return;
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
      onComplete(trimmed);
    } catch (cause) {
      setError(friendlyErrorMessage(cause, '创建项目失败，请重试。'));
    } finally {
      setBusy(false);
    }
  }

  async function restoreFromBackup() {
    if (locked) return;
    const api = window.studyCoach;
    if (!api?.restoreBackup) {
      setError('当前版本不支持恢复备份。');
      return;
    }
    if (!window.confirm(FIRST_RUN_RESTORE_CONFIRM)) return;
    setRestoring(true);
    setError(null);
    try {
      const result = await api.restoreBackup();
      // null is a dismissed picker: nothing changed, back to the form.
      if (result !== null) setRestoreResult(result);
    } catch (cause) {
      // One plain line; the form stays usable and the restore can be retried.
      setError(friendlyErrorMessage(cause, '恢复备份失败，请重试。'));
    } finally {
      setRestoring(false);
    }
  }

  /**
   * 稍后再说 / close. After a successful restore this takes the refresh path
   * (no workspace is created; `completeWorkspaceOnboarding` is not called), so
   * the app reloads into the restored data. Otherwise it is the plain 1.2.0
   * dismiss-for-this-session.
   */
  function dismiss() {
    if (locked) return;
    if (restoreResult !== null && onRestoreComplete) onRestoreComplete();
    else onSkip();
  }

  return (
    <Dialog
      open={open}
      onClose={locked ? () => undefined : dismiss}
      title="欢迎使用阿咲"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={dismiss} disabled={locked}>
            稍后再说
          </Button>
          <Button size="sm" disabled={locked} onClick={() => void createWorkspace()}>
            {busy ? '正在创建…' : '创建项目并开始'}
          </Button>
        </div>
      }
    >
      <p className="text-[14px] leading-6 text-[#1d1d1f] dark:text-[#f5f5f7]">
        先建一个项目，之后可以让阿咲在对话里拆目标、排今天的事、记录复盘。
        不管是备考、学一门语言，还是读完一本书、坚持健身、推进一个项目，都可以从这里开始。
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
          placeholder="例如：考研、学英语、读完一本书、坚持健身、推进一个项目"
          disabled={locked}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="first-run-kind">类型</Label>
          <Select
            id="first-run-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as WorkspaceKind)}
            disabled={locked}
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
            disabled={locked}
          />
        </div>
      </div>

      <p className="mt-4 text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">
        不用先搭任何系统——创建项目就能用，所有数据都是本地的 Markdown 文件。
      </p>

      {/* 换机的主路径是装好 → 才想起恢复，所以引导内提供次要入口；ghost 样式
          不抢「创建项目并开始」的主位。成功后清单留在表单上方，创建仍然可用。 */}
      <div className="mt-5 border-t border-gray-200/70 pt-4 dark:border-white/10">
        <Button variant="ghost" size="sm" disabled={locked} onClick={() => void restoreFromBackup()}>
          {restoring ? '正在恢复…' : '从备份恢复…'}
        </Button>
        {restoreResult !== null ? (
          <div className="mt-3 space-y-1 text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">
            <p>已恢复：{backupCopiedParts(restoreResult.restored).join('、')}。</p>
            {/* 第三行引用与设置页相同的常量；采纳与否决定版本，不是复制文案 */}
            <p>
              {restoreResult.restored.state
                ? MIGRATION_STEP_LINE_SETTINGS_ADOPTED
                : MIGRATION_STEP_LINE_SETTINGS_UNCHANGED}
            </p>
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-[#d70015] dark:text-[#ff7b72]">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
