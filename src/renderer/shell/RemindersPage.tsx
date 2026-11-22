import type { CommitmentSummary } from '../../shared/notifications';
import type { ResolveCommitmentEntryInput } from '../../shared/ipc';
import type {
  CreateReminderInput,
  DeleteReminderInput,
  Reminder,
  UpdateReminderInput,
  Workspace
} from '../../shared/workspace';
import { CommitmentsSection, RemindersSection } from './ProjectSections';
import { PageFrame } from './PageFrame';

type RemindersPageProps = {
  reminders: Reminder[];
  /** Every promise, closed entries included; the section does the filtering. */
  commitments: CommitmentSummary[];
  workspaces: Workspace[];
  today: string;
  onCreateReminder: (input: CreateReminderInput) => Promise<Reminder>;
  onUpdateReminder: (input: UpdateReminderInput) => Promise<Reminder>;
  onDeleteReminder?: (input: DeleteReminderInput) => Promise<void>;
  onResolveCommitment: (input: ResolveCommitmentEntryInput) => Promise<CommitmentSummary>;
  snoozedUntil: string;
  onSnoozeCheckIns: (days: number) => void;
  onResumeCheckIns: () => void;
  onOpenSidebar: () => void;
  onPrompt: (prompt: string) => void;
};

export function RemindersPage({
  reminders,
  commitments,
  workspaces,
  today,
  onCreateReminder,
  onUpdateReminder,
  onDeleteReminder,
  onResolveCommitment,
  snoozedUntil,
  onSnoozeCheckIns,
  onResumeCheckIns,
  onOpenSidebar,
  onPrompt
}: RemindersPageProps) {
  return (
    <PageFrame title="提醒" subtitle="全部提醒" onOpenSidebar={onOpenSidebar}>
      <div className="max-w-[720px]">
        <RemindersSection
          reminders={reminders}
          onCreateReminder={onCreateReminder}
          onUpdateReminder={onUpdateReminder}
          onDeleteReminder={onDeleteReminder}
          snoozedUntil={snoozedUntil}
          onSnoozeCheckIns={onSnoozeCheckIns}
          onResumeCheckIns={onResumeCheckIns}
          onPrompt={onPrompt}
        />
        {/* 承诺 lives on the reminders page, after the reminders themselves. */}
        <CommitmentsSection
          commitments={commitments}
          workspaces={workspaces}
          today={today}
          onResolve={onResolveCommitment}
          onPrompt={onPrompt}
        />
      </div>
    </PageFrame>
  );
}
