import type { WorkspaceTask } from '../../src/shared/workspace';
import { createDefaultSettings } from '../../src/main/settings/defaults';
import {
  buildTrayMenuTemplate,
  buildTrayTitle,
  buildTrayTooltip,
  createTrayController,
  isTaskForDay,
  summarizeWorkspaceTasks,
  type TrayLike,
  type TrayMenuItem
} from '../../src/main/tray';

const TASKS: WorkspaceTask[] = [
  {
    id: 'p1',
    workspaceId: 'kaoyan',
    title: '背单词',
    subject: '英语',
    durationMin: 20,
    acceptance: '50 词',
    status: 'pending'
  },
  {
    id: 'p2',
    workspaceId: 'kaoyan',
    title: '极限刷题',
    subject: '数学',
    durationMin: 45,
    acceptance: '10 题',
    status: 'in-progress'
  },
  {
    id: 'p3',
    workspaceId: 'english',
    title: '精读',
    subject: '英语',
    durationMin: 30,
    acceptance: '一篇',
    status: 'done'
  }
];

describe('tray summary and notification gating', () => {
  test('summarizes progress and prefers an in-progress next task', () => {
    const summary = summarizeWorkspaceTasks(TASKS);
    expect(summary).toMatchObject({ total: 3, completed: 1, percent: 33 });
    expect(summary.nextTask?.id).toBe('p2');
    expect(buildTrayTooltip(summary)).toBe('ASAKI · 今日 1/3 · 下一项：极限刷题');
    expect(buildTrayTitle(summary)).toBe('1/3');
  });

  test('handles an empty day and completed day', () => {
    expect(summarizeWorkspaceTasks([])).toEqual({ total: 0, completed: 0, percent: 0, nextTask: null });
    expect(buildTrayTooltip(summarizeWorkspaceTasks([]))).toBe('ASAKI · 今天还没有计划');
    expect(buildTrayTitle(summarizeWorkspaceTasks([]))).toBe('');

    const allDone = TASKS.map((task) => ({ ...task, status: 'done' as const }));
    expect(buildTrayTooltip(summarizeWorkspaceTasks(allDone))).toBe(
      'ASAKI · 今日 3/3 · 今日任务已完成'
    );
  });

  test('counts only today and undated tasks in the tray', () => {
    expect(isTaskForDay(TASKS[0]!, '2026-11-01')).toBe(true);
    expect(isTaskForDay({ ...TASKS[0]!, due: '2026-11-01' }, '2026-11-01')).toBe(true);
    expect(isTaskForDay({ ...TASKS[0]!, startAt: '2026-11-01T09:00' }, '2026-11-01')).toBe(true);
    expect(isTaskForDay({ ...TASKS[0]!, due: '2026-11-02' }, '2026-11-01')).toBe(false);
    expect(isTaskForDay({ ...TASKS[0]!, startAt: '2026-10-31T09:00' }, '2026-11-01')).toBe(
      false
    );
    // `due` wins over `startAt` when both are set.
    expect(
      isTaskForDay(
        { ...TASKS[0]!, due: '2026-11-01', startAt: '2026-10-31T09:00' },
        '2026-11-01'
      )
    ).toBe(true);
  });

  test('offers quick capture from the tray menu', () => {
    const progress = summarizeWorkspaceTasks(TASKS);
    let captures = 0;
    const menu = buildTrayMenuTemplate({
      progress,
      notification: 'enabled',
      onQuickCapture: () => {
        captures += 1;
      }
    });

    const item = menu.find((entry) => entry.label === '快速记一条');
    expect(item).toBeTruthy();
    item?.click?.();
    expect(captures).toBe(1);

    const withoutHandler = buildTrayMenuTemplate({ progress, notification: 'enabled' });
    expect(() =>
      withoutHandler.find((entry) => entry.label === '快速记一条')?.click?.()
    ).not.toThrow();
  });

  test('reflects enabled, DND and disabled notification states', () => {
    const progress = summarizeWorkspaceTasks(TASKS);
    expect(
      buildTrayMenuTemplate({ progress, notification: 'enabled' }).find((item) =>
        item.label?.startsWith('通知')
      )?.label
    ).toBe('通知：已开启');
    expect(
      buildTrayMenuTemplate({ progress, notification: 'dnd' }).find((item) =>
        item.label?.startsWith('通知')
      )?.label
    ).toBe('通知：免打扰中');
    expect(
      buildTrayMenuTemplate({ progress, notification: 'disabled' }).find((item) =>
        item.label?.startsWith('通知')
      )?.label
    ).toBe('通知：已关闭');
  });

  test('refreshes tooltip, title and menu from plan and settings', async () => {
    const tooltips: string[] = [];
    const titles: string[] = [];
    const menus: TrayMenuItem[][] = [];
    const tray: TrayLike = {
      setToolTip: (text) => tooltips.push(text),
      setTitle: (text) => titles.push(text),
      setContextMenu: (menu) => menus.push(menu as TrayMenuItem[])
    };
    let opened = 0;

    const controller = createTrayController({
      tray,
      buildMenu: (template) => template,
      getTasks: async () => TASKS,
      getSettings: async () => createDefaultSettings('/tmp/vault'),
      now: () => new Date(2026, 9, 31, 12, 0, 0),
      actions: {
        onOpen: () => {
          opened += 1;
        }
      }
    });

    await controller.refresh();
    expect(tooltips.at(-1)).toContain('今日 1/3');
    expect(titles.at(-1)).toBe('1/3');
    const menu = menus.at(-1) ?? [];
    expect(menu.find((item) => item.label === '今日进度：1/3（33%）')).toBeTruthy();
    expect(menu.find((item) => item.label === '下一项：极限刷题')).toBeTruthy();
    expect(menu.find((item) => item.label === '通知：已开启')).toBeTruthy();
    menu.find((item) => item.label === '打开ASAKI')?.click?.();
    expect(opened).toBe(1);

    controller.destroy();
  });

  test('fails closed to notification-disabled when reads fail', async () => {
    const tooltips: string[] = [];
    const menus: TrayMenuItem[][] = [];
    const controller = createTrayController({
      tray: {
        setToolTip: (text) => tooltips.push(text),
        setContextMenu: (menu) => menus.push(menu as TrayMenuItem[])
      },
      buildMenu: (template) => template,
      getTasks: async () => {
        throw new Error('vault unavailable');
      },
      getSettings: async () => createDefaultSettings('/tmp/vault')
    });

    await controller.refresh();
    expect(tooltips.at(-1)).toBe('ASAKI · 今天还没有计划');
    expect(menus.at(-1)?.find((item) => item.label === '通知：已关闭')).toBeTruthy();
  });
});
