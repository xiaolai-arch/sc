import { useEffect } from 'react';
import {
  collectNotifications,
  snoozeLabel,
  type CommitmentSummary,
  type NotificationDigest
} from '../../shared/notifications';
import type { Reminder } from '../../shared/workspace';
import { cn } from '../ui/cn';

type NotificationCenterProps = {
  reminders: Reminder[];
  commitments: CommitmentSummary[];
  /** `settings.notifications.snoozedUntil`; empty or past means not muted. */
  snoozedUntil?: string | null;
  /** The local day the shell already uses for every other surface. */
  today: string;
  now?: Date;
  /** The reminder page owns enable/postpone/done, so a reminder row leads there. */
  onOpenReminders: () => void;
  /** The mute row leads to the page that can resume proactive check-ins. */
  onOpenMuteSettings: () => void;
  /** Resolving a promise happens in chat, so the row opens a draft there. */
  onOpenCommitment: (commitment: CommitmentSummary) => void;
  onOpenToday: () => void;
  onClose: () => void;
};

const ROW_CLASS =
  'flex w-full flex-col gap-0.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-200 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:hover:bg-white/[0.06]';

/**
 * The bottom-bar notification center: only what the user can act on right now.
 * Rows come from `collectNotifications` (reminders that are due and not done,
 * promises due today or earlier, the active mute) and every row links to the
 * surface that owns the action. No count, badge or item is invented — an empty
 * digest renders an honest empty state.
 */
export function NotificationCenter({
  reminders,
  commitments,
  snoozedUntil,
  today,
  now,
  onOpenReminders,
  onOpenMuteSettings,
  onOpenCommitment,
  onOpenToday,
  onClose
}: NotificationCenterProps) {
  // Collected here, not cached: the panel must reflect the stores as they are now.
  const digest: NotificationDigest = collectNotifications({
    reminders,
    commitments,
    snoozedUntil,
    now: now ?? new Date()
  });
  const muteLine = digest.mutedUntil ? snoozeLabel(digest.mutedUntil, today) : null;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function activate(action: () => void) {
    onClose();
    action();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/25 p-4 dark:bg-black/50 md:items-center"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="通知中心"
        className="flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:bg-[#1c1c1e]"
      >
        <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
          <h2 className="text-[15px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">
            通知中心
          </h2>
          <button
            type="button"
            autoFocus
            aria-label="关闭通知中心"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-[12px] font-medium text-gray-500 transition-colors duration-200 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
          >
            关闭
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {muteLine ? (
            <button
              type="button"
              onClick={() => activate(onOpenMuteSettings)}
              className={cn(ROW_CLASS, 'mb-1 bg-[#f5f5f7] dark:bg-white/[0.06]')}
            >
              <span className="text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                {muteLine}
              </span>
              <span className="text-[11px] text-gray-500 dark:text-[#a1a1a6]">
                主动检查暂停中，点此恢复
              </span>
            </button>
          ) : null}

          {digest.items.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-[13px] text-gray-500 dark:text-[#8e8e93]">
              暂时没有需要处理的事
            </p>
          ) : (
            <ul aria-label="待处理事项" className="space-y-0.5">
              {digest.items.map((item) => (
                <li key={`${item.kind}:${item.id}`}>
                  <button
                    type="button"
                    onClick={() =>
                      activate(() => {
                        if (item.kind === 'reminder') {
                          onOpenReminders();
                          return;
                        }
                        const commitment = commitments.find(
                          (entry) => entry.id === item.id
                        );
                        if (commitment) onOpenCommitment(commitment);
                        else onOpenToday();
                      })
                    }
                    className={ROW_CLASS}
                  >
                    <span className="flex items-center gap-1.5">
                      {item.overdue ? (
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff3b30] dark:bg-[#ff7b72]"
                        />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {item.kind === 'reminder' ? `提醒：${item.title}` : item.title}
                      </span>
                    </span>
                    <span className="text-[11px] text-gray-500 dark:text-[#a1a1a6]">
                      {item.detail}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-gray-200/70 px-4 py-2.5 dark:border-white/10">
          <button
            type="button"
            onClick={() => activate(onOpenToday)}
            className="text-[12px] font-medium text-[#0071e3] transition-opacity duration-200 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#4da3ff]"
          >
            打开今日
          </button>
        </div>
      </div>
    </div>
  );
}
