import { useCallback, useEffect, useState } from 'react';
import type { UpdateTaskInput } from '../../shared/ipc';
import type { DailyPlan } from '../../shared/types';

export function useTodayPlan() {
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    const api = window.studyCoach;
    if (!api) {
      setPlan(null);
      setLoadFailed(true);
      setError('应用桥接不可用，请刷新页面重试。');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    try {
      setPlan(await api.getTodayPlan());
    } catch (cause) {
      setPlan(null);
      setLoadFailed(true);
      setError(cause instanceof Error ? cause.message : '加载今日计划失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateTask(input: UpdateTaskInput) {
    const api = window.studyCoach;
    if (!api) throw new Error('应用桥接不可用，请刷新页面重试。');
    try {
      const updated = await api.updateTask(input);
      setPlan(updated);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新任务失败。');
      throw cause;
    }
  }

  async function generate() {
    const api = window.studyCoach;
    if (!api) {
      setError('应用桥接不可用，请刷新页面重试。');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      setPlan(await api.generateTodayPlan());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成今日计划失败。');
    } finally {
      setGenerating(false);
    }
  }

  return { plan, loading, loadFailed, error, generating, load, updateTask, generate };
}
