import type { MenuItemConstructorOptions } from 'electron';
import type { AppSettings } from '../shared/types';
import type { WorkspaceTask } from '../shared/workspace';
import type { SchedulerNotification } from './scheduler/scheduler';
import { notificationState, type NotificationState } from './scheduler/time';

export interface TrayProgress {
  total: number;
  completed: number;
  percent: number;
  nextTask: WorkspaceTask | null;
}

export interface TrayMenuItem {
  label?: string;
  type?: 'normal' | 'separator';
  enabled?: boolean;
  click?: () => void;
}

export interface TrayMenuOptions {
  progress: TrayProgress;
  notification: NotificationState;
  onOpen?: () => void;
  onGeneratePlan?: () => void;
  onEveningReview?: () => void;
  onOpenSettings?: () => void;
  onQuit?: () => void;
}

export interface TrayLike {
  setToolTip?(text: string): void;
  setTitle?(text: string): void;
  setContextMenu?(menu: unknown): void;
  on?(event: string, listener: () => void): void;
  destroy?(): void;
}

export interface TrayControllerOptions {
  tray: TrayLike;
  buildMenu: (template: TrayMenuItem[]) => unknown;
  /** Today's tasks across every workspace; the tray has no separate plan. */
  getTasks: () => Promise<WorkspaceTask[]>;
  getSettings: () => Promise<AppSettings>;
  now?: () => Date;
  actions?: Pick<TrayMenuOptions, 'onOpen' | 'onGeneratePlan' | 'onEveningReview' | 'onOpenSettings' | 'onQuit'>;
  refreshIntervalMs?: number;
}

export interface TrayController {
  refresh(): Promise<void>;
  start(intervalMs?: number): void;
  destroy(): void;
}

const NOTIFICATION_LABELS: Record<NotificationState, string> = {
  enabled: '通知：已开启',
  dnd: '通知：免打扰中',
  disabled: '通知：已关闭'
};

export function summarizeWorkspaceTasks(tasks: readonly WorkspaceTask[]): TrayProgress {
  if (tasks.length === 0) {
    return { total: 0, completed: 0, percent: 0, nextTask: null };
  }
  const completed = tasks.filter((task) => task.status === 'done').length;
  const nextTask =
    tasks.find((task) => task.status === 'in-progress') ??
    tasks.find((task) => task.status === 'pending') ??
    null;
  return {
    total: tasks.length,
    completed,
    percent: Math.round((completed / tasks.length) * 100),
    nextTask
  };
}

export function buildTrayTooltip(progress: TrayProgress): string {
  if (progress.total === 0) return '学习教练 · 今天还没有计划';
  const base = `学习教练 · 今日 ${progress.completed}/${progress.total}`;
  return progress.nextTask ? `${base} · 下一项：${progress.nextTask.title}` : `${base} · 今日任务已完成`;
}

/** macOS menu-bar title; empty when there is no plan yet. */
export function buildTrayTitle(progress: TrayProgress): string {
  return progress.total === 0 ? '' : `${progress.completed}/${progress.total}`;
}

export function buildTrayMenuTemplate(options: TrayMenuOptions): TrayMenuItem[] {
  const { progress, notification } = options;
  const progressLabel =
    progress.total === 0
      ? '今日进度：还没有计划'
      : `今日进度：${progress.completed}/${progress.total}（${progress.percent}%）`;
  const nextLabel = progress.nextTask
    ? `下一项：${progress.nextTask.title}`
    : progress.total === 0
      ? '下一项：生成计划后显示'
      : '下一项：今日任务已完成';

  const template: TrayMenuItem[] = [
    { label: '打开学习教练', click: options.onOpen },
    { type: 'separator' },
    { label: progressLabel, enabled: false },
    { label: nextLabel, enabled: false },
    { type: 'separator' },
    { label: '生成今日计划', click: options.onGeneratePlan },
    { label: '开始晚间复盘', click: options.onEveningReview },
    { label: NOTIFICATION_LABELS[notification], enabled: false },
    { type: 'separator' },
    { label: '设置…', click: options.onOpenSettings },
    { label: '退出', click: options.onQuit }
  ];
  return template;
}

/**
 * Refreshes tooltip/title/menu from the current plan and settings. All Electron
 * objects are injected so the controller is testable without a display.
 */
export function createTrayController(options: TrayControllerOptions): TrayController {
  const now = options.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh(): Promise<void> {
    let progress: TrayProgress = summarizeWorkspaceTasks([]);
    let state: NotificationState = 'disabled';
    try {
      const [tasks, settings] = await Promise.all([options.getTasks(), options.getSettings()]);
      progress = summarizeWorkspaceTasks(tasks);
      state = notificationState(settings, now());
    } catch {
      // A failed read leaves the tray in a safe, notification-disabled state.
    }

    options.tray.setToolTip?.(buildTrayTooltip(progress));
    options.tray.setTitle?.(buildTrayTitle(progress));
    const template = buildTrayMenuTemplate({
      progress,
      notification: state,
      ...(options.actions ?? {})
    });
    options.tray.setContextMenu?.(options.buildMenu(template));
  }

  return {
    refresh,
    start(intervalMs = 60_000) {
      if (timer !== null) return;
      void refresh().catch(() => undefined);
      timer = setInterval(() => {
        void refresh().catch(() => undefined);
      }, Math.max(250, intervalMs));
      const handle = timer as ReturnType<typeof setInterval> & { unref?: () => void };
      handle.unref?.();
    },
    destroy() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      options.tray.destroy?.();
    }
  };
}

export interface ElectronTrayOptions extends Omit<TrayControllerOptions, 'tray' | 'buildMenu'> {
  /** PNG data URL for the tray icon; a small default glyph is used otherwise. */
  iconDataUrl?: string;
}

/**
 * Lazily loads Electron so this module can be imported by Node-based tests.
 * The production entry point still owns when to create the tray.
 */
export async function createElectronTray(
  options: ElectronTrayOptions
): Promise<{ tray: TrayLike; controller: TrayController }> {
  const electron = await import('electron');
  const image = electron.nativeImage.createFromDataURL(options.iconDataUrl ?? DEFAULT_ICON_DATA_URL);
  const tray = new electron.Tray(image);
  tray.setToolTip('学习教练');

  const controller = createTrayController({
    ...options,
    tray,
    buildMenu: (template) =>
      electron.Menu.buildFromTemplate(template as MenuItemConstructorOptions[])
  });
  const open = options.actions?.onOpen;
  if (open) tray.on('click', open);
  return { tray, controller };
}

/** Electron notification sink used by the scheduler during app startup. */
export async function createElectronNotificationSink(
  onClick?: (notification: SchedulerNotification) => void
): Promise<(notification: SchedulerNotification) => void> {
  const electron = await import('electron');
  return (notification) => {
    if (!electron.Notification.isSupported()) return;
    const native = new electron.Notification({
      title: notification.title,
      body: notification.body
    });
    if (onClick) {
      native.on('click', () => onClick(notification));
    }
    native.show();
  };
}

// 16×16 transparent PNG with a dark rounded check glyph. Kept inline so the
// tray needs no extra asset file or network access.
const DEFAULT_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAO0lEQVR42mNgGGzgP5GYIs04DRkCBoAA2QbAAFEGoCnEppmwATANODQT9gIyIDsQ8WimTTRSnJQHBgAAI261S5Ka/ZwAAAAASUVORK5CYII=';
