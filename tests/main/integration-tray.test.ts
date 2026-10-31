import type { DailyPlan } from '../../src/shared/types';
import { createDefaultSettings } from '../../src/main/settings/defaults';
import {
  buildTrayMenuTemplate,
  buildTrayTitle,
  buildTrayTooltip,
  createTrayController,
  summarizeTodayPlan,
  type TrayLike,
  type TrayMenuItem
} from '../../src/main/tray';

const PLAN: DailyPlan = {
  date: '2026-10-31',
  generatedBy: 'agent',
  tasks: [
    {
      id: 'p1',
      title: '背单词',
      subject: '英语',
      durationMin: 20,
      materialRefs: [],
      acceptance: '50 词',
      status: 'pending'
    },
    {
      id: 'p2',
      title: '极限刷题',
      subject: '数学',
      durationMin: 45,
      materialRefs: [],
      acceptance: '10 题',
      status: 'in-progress'
    },
    {
      id: 'p3',
      title: '精读',
      subject: '英语',
      durationMin: 30,
      materialRefs: [],
      acceptance: '一篇',
      status: 'done'
    }
  ]
};

describe('tray summary and notification gating', () => {
  test('summarizes progress and prefers an in-progress next task', () => {
    const summary = summarizeTodayPlan(PLAN);
    expect(summary).toMatchObject({ total: 3, completed: 1, percent: 33 });
    expect(summary.nextTask?.id).toBe('p2');
    expect(buildTrayTooltip(summary)).toBe('学习教练 · 今日 1/3 · 下一项：极限刷题');
    expect(buildTrayTitle(summary)).toBe('1/3');
  });

  test('handles an empty day and completed day', () => {
    expect(summarizeTodayPlan(null)).toEqual({ total: 0, completed: 0, percent: 0, nextTask: null });
    expect(buildTrayTooltip(summarizeTodayPlan(null))).toBe('学习教练 · 今天还没有计划');
    expect(buildTrayTitle(summarizeTodayPlan(null))).toBe('');

    const allDone: DailyPlan = {
      ...PLAN,
      tasks: PLAN.tasks.map((task) => ({ ...task, status: 'done' }))
    };
    expect(buildTrayTooltip(summarizeTodayPlan(allDone))).toBe(
      '学习教练 · 今日 3/3 · 今日任务已完成'
    );
  });

  test('reflects enabled, DND and disabled notification states', () => {
    const progress = summarizeTodayPlan(PLAN);
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
      getPlan: async () => PLAN,
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
    menu.find((item) => item.label === '打开学习教练')?.click?.();
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
      getPlan: async () => {
        throw new Error('vault unavailable');
      },
      getSettings: async () => createDefaultSettings('/tmp/vault')
    });

    await controller.refresh();
    expect(tooltips.at(-1)).toBe('学习教练 · 今天还没有计划');
    expect(menus.at(-1)?.find((item) => item.label === '通知：已关闭')).toBeTruthy();
  });
});
