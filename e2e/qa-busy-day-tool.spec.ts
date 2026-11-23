import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createAvailabilityService } from '../src/main/availability/service';
import type { AvailabilityService } from '../src/main/availability/service';
import { BUSY_DAY_MINUTES, createWorkspacePlanner } from '../src/main/planning';
import { createButlerTools, executeButlerTool } from '../src/main/butler/tools';
import { createWorkspaceService } from '../src/main/workspace/create-workspace-service';
import type { WorkspaceService } from '../src/shared/workspace';

/**
 * 满日覆盖的工具层端到端断言（item 42 收尾）。
 *
 * IPC 层（api.planWorkspace）已不是用户唯一可达入口；用户在对话里走的是
 * butler 的 `plan_workspace` 工具。这里在 Playwright 进程里组装**真实**
 * 服务栈——真实 workspace 服务写盘、真实 availability 服务读盘上的
 * `week-availability.md`（写入格式就是 app 自己的 serialize 格式）、真实
 * planner（无模型时走确定性模板）——然后直接执行 `plan_workspace`，钉住
 * 三条验收：
 *
 *   1. 满日经工具路径：恰好 1 件任务、时长 ≤10 分钟、
 *      availableMinutesSource === 'week'，且可用性恰被读取一次；
 *   2. 平常日经工具路径：不注入 BUSY_DAY_MINUTES，source 为 'default'；
 *   3. 调用方钉死 availableMinutes: 45：weekAvailability 读取次数为 0
 *      （计数包装器只数 busyDatesBetween），source 为 'input'。
 *
 * 用户可见（对话工具行、今日任务页）的同三条路径由 qa-busy-day-plan.spec.ts
 * 驱动真实 Electron + fake CLI 覆盖；本文件补上 UI 观测不到的「读取次数」。
 */

/** 2026-11-23 is a Monday; the "user" marked its Tuesday as especially full. */
const NOW = () => new Date(2026, 10, 23, 8, 0, 0);
const MONDAY = '2026-11-23';
const TUESDAY = '2026-11-24';
const WEDNESDAY = '2026-11-25';

interface PlanToolResult {
  ok: boolean;
  result: {
    availableMinutes: number;
    availableMinutesSource: string;
    tasks: Array<{ title: string; durationMin: number }>;
  };
}

type Harness = {
  run(args: Record<string, unknown>): Promise<{ ok: boolean; content: string }>;
  /** How often the tool asked the availability service about a day. */
  availabilityReads(): number;
  tasksInVault(): Promise<Array<{ durationMin: number }>>;
  cleanup(): Promise<void>;
};

/** Real services on a real throwaway vault; the availability read is counted. */
async function harness(): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-busy-day-e2e-'));
  const workspaceService: WorkspaceService = createWorkspaceService(root, { seed: false });
  const workspace = await workspaceService.createWorkspace({
    name: '考研',
    kind: 'exam',
    goal: '2027 考研上岸',
    description: ''
  });

  // The record is written in the app's own format and read back by the real
  // service — exactly what a Sunday-review answer leaves on disk.
  const availability = createAvailabilityService({ root, now: NOW });
  await availability.set({ weekStart: MONDAY, busyDates: [TUESDAY] });

  let reads = 0;
  const countingAvailability: AvailabilityService = {
    list: () => availability.list(),
    busyDatesBetween: (from, to) => {
      reads += 1;
      return availability.busyDatesBetween(from, to);
    },
    set: (input) => availability.set(input),
    clear: (weekStart) => availability.clear(weekStart)
  };

  // No model client: the planner falls back to its deterministic template, so
  // task counts and durations are exact without any fixture.
  const planner = createWorkspacePlanner({ modelClient: null, workspaceService, now: NOW });
  const tools = createButlerTools();

  return {
    run: (args) =>
      executeButlerTool(
        { id: 'p1', name: 'plan_workspace', arguments: args },
        tools,
        {
          workspace: workspaceService,
          workspaceId: workspace.id,
          planner,
          weekAvailability: countingAvailability,
          now: NOW
        }
      ),
    availabilityReads: () => reads,
    tasksInVault: async () => {
      const snapshot = await workspaceService.getWorkspaceSnapshot(workspace.id);
      return snapshot.tasks.map((task) => ({ durationMin: task.durationMin }));
    },
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

test.describe('busy-day override on the plan_workspace tool layer', () => {
  test('满日：恰好 1 件 ≤10 分钟，source week，可用性恰读一次', async () => {
    const h = await harness();
    try {
      const result = await h.run({ date: TUESDAY });
      expect(result.ok).toBe(true);

      const parsed = JSON.parse(result.content) as PlanToolResult;
      expect(parsed.ok).toBe(true);
      expect(parsed.result.availableMinutes).toBe(BUSY_DAY_MINUTES);
      expect(parsed.result.availableMinutesSource).toBe('week');
      expect(parsed.result.tasks).toHaveLength(1);
      expect(parsed.result.tasks[0]?.durationMin).toBeLessThanOrEqual(BUSY_DAY_MINUTES);

      // The shared read asked about the target day exactly once — never the
      // whole week, never twice.
      expect(h.availabilityReads()).toBe(1);

      // The plan's task really reached the vault, still exactly one and small.
      const tasks = await h.tasksInVault();
      expect(tasks).toHaveLength(1);
      expect(tasks[0]?.durationMin).toBeLessThanOrEqual(BUSY_DAY_MINUTES);
    } finally {
      await h.cleanup();
    }
  });

  test('平常日：不注入 BUSY_DAY_MINUTES，source default', async () => {
    const h = await harness();
    try {
      const result = await h.run({ date: WEDNESDAY });
      expect(result.ok).toBe(true);

      const parsed = JSON.parse(result.content) as PlanToolResult;
      expect(parsed.ok).toBe(true);
      expect(parsed.result.availableMinutes).toBe(120);
      expect(parsed.result.availableMinutesSource).toBe('default');
      expect(parsed.result.tasks).toHaveLength(1);
      // Template sizes to the default budget: no busy-day clamp anywhere.
      expect(parsed.result.tasks[0]?.durationMin).toBeGreaterThan(BUSY_DAY_MINUTES);

      // The day was checked once and found not busy.
      expect(h.availabilityReads()).toBe(1);
      expect(await h.tasksInVault()).toHaveLength(1);
    } finally {
      await h.cleanup();
    }
  });

  test('钉死 45 分钟：可用性读取为 0，source input', async () => {
    const h = await harness();
    try {
      // Even on the marked-busy Tuesday: a pinned budget must not ask.
      const result = await h.run({ date: TUESDAY, availableMinutes: 45 });
      expect(result.ok).toBe(true);

      const parsed = JSON.parse(result.content) as PlanToolResult;
      expect(parsed.ok).toBe(true);
      expect(parsed.result.availableMinutes).toBe(45);
      expect(parsed.result.availableMinutesSource).toBe('input');
      expect(parsed.result.tasks).toHaveLength(1);
      expect(parsed.result.tasks[0]?.durationMin).toBe(45);

      expect(h.availabilityReads()).toBe(0);
      expect(await h.tasksInVault()).toHaveLength(1);
    } finally {
      await h.cleanup();
    }
  });
});
