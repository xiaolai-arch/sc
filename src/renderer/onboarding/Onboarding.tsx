import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { DEMO_PROFILE } from '../../shared/demo';
import { validateExamProfile } from '../../shared/profile';
import type { ExamProfile } from '../../shared/types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { PageShell } from '../ui/PageShell';
import { Select } from '../ui/Select';

type OnboardingProps = {
  onComplete?: () => void;
  showDemo?: boolean;
};

export function Onboarding({ onComplete, showDemo = false }: OnboardingProps) {
  const [examDate, setExamDate] = useState('2027-12-18');
  const [targetSchool, setTargetSchool] = useState('');
  const [targetMajor, setTargetMajor] = useState('');
  const [subjects, setSubjects] = useState('');
  const [dailyMinutes, setDailyMinutes] = useState('300');
  const [currentLevel, setCurrentLevel] = useState('基础一般');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const baseId = useId();
  const fieldId = (name: string) => `${baseId}-${name}`;

  async function complete(profile: ExamProfile) {
    const api = window.studyCoach;
    if (!api) throw new Error('应用桥接不可用，请刷新页面重试。');
    setBusy(true);
    try {
      await api.completeOnboarding(profile);
      onComplete?.();
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const profile: ExamProfile = {
      examDate,
      targetSchool: targetSchool.trim() || undefined,
      targetMajor: targetMajor.trim() || undefined,
      subjects: subjects
        .split(/[,，、]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((name) => ({ name })),
      dailyMinutes: Number(dailyMinutes),
      currentLevel
    };

    try {
      await complete(validateExamProfile(profile));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
    }
  }

  async function startDemo() {
    setError(null);
    try {
      await complete(DEMO_PROFILE);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '示例数据加载失败，请重试。');
    }
  }

  return (
    <PageShell>
      <header className="mx-auto max-w-[980px] px-6 py-8 md:px-8">
        <span className="text-xl font-semibold tracking-tight text-black">Study Coach</span>
      </header>
      <main className="mx-auto max-w-[980px] px-6 pb-20 md:px-8 md:pb-32">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-4xl font-semibold tracking-tight text-black md:text-5xl lg:text-6xl">
            把考研，
            <br />
            变成每天的下一步。
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-base text-gray-600 md:text-lg">
            告诉我你的目标，Study Coach 会安排每天的任务，你只需要执行。
          </p>
        </div>

        <Card className="mx-auto mt-12 max-w-2xl p-8 md:mt-16 md:p-12">
          <form className="grid gap-6" onSubmit={submit} noValidate>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <Label htmlFor={fieldId('examDate')}>考试日期</Label>
                <Input
                  id={fieldId('examDate')}
                  type="date"
                  value={examDate}
                  onChange={(event) => setExamDate(event.target.value)}
                  required
                />
              </div>
              <div>
                <Label htmlFor={fieldId('dailyMinutes')}>每天可用分钟数</Label>
                <Input
                  id={fieldId('dailyMinutes')}
                  type="number"
                  min={30}
                  max={720}
                  value={dailyMinutes}
                  onChange={(event) => setDailyMinutes(event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <Label htmlFor={fieldId('targetSchool')}>目标院校（可选）</Label>
                <Input
                  id={fieldId('targetSchool')}
                  value={targetSchool}
                  onChange={(event) => setTargetSchool(event.target.value)}
                  placeholder="例如：示例大学"
                />
              </div>
              <div>
                <Label htmlFor={fieldId('targetMajor')}>目标专业（可选）</Label>
                <Input
                  id={fieldId('targetMajor')}
                  value={targetMajor}
                  onChange={(event) => setTargetMajor(event.target.value)}
                  placeholder="例如：计算机"
                />
              </div>
            </div>

            <div>
              <Label htmlFor={fieldId('subjects')}>考试科目（逗号分隔）</Label>
              <Input
                id={fieldId('subjects')}
                value={subjects}
                onChange={(event) => setSubjects(event.target.value)}
                placeholder="数学一，英语一，政治"
                required
              />
            </div>

            <div>
              <Label htmlFor={fieldId('currentLevel')}>当前水平</Label>
              <Select
                id={fieldId('currentLevel')}
                value={currentLevel}
                onChange={(event) => setCurrentLevel(event.target.value)}
              >
                <option>基础薄弱</option>
                <option>基础一般</option>
                <option>基础较好</option>
              </Select>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-[#d70015]">
                {error}
              </p>
            ) : null}

            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Button type="submit" disabled={busy} className="w-full md:w-auto">
                {busy ? '正在保存…' : '生成我的学习计划'}
              </Button>
              {showDemo ? (
                <Button type="button" variant="ghost" disabled={busy} onClick={() => void startDemo()}>
                  先看看示例
                </Button>
              ) : null}
            </div>
          </form>
        </Card>
      </main>
    </PageShell>
  );
}
