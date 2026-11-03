import type {
  CreateReminderInput,
  DeleteReminderInput,
  Reminder,
  UpdateReminderInput
} from '../../shared/workspace';
import { PageFrame } from './PageFrame';
import { RemindersSection } from './ProjectSections';

type RemindersPageProps = {
  reminders: Reminder[];
  onCreateReminder: (input: CreateReminderInput) => Promise<Reminder>;
  onUpdateReminder: (input: UpdateReminderInput) => Promise<Reminder>;
  onDeleteReminder?: (input: DeleteReminderInput) => Promise<void>;
  snoozedToday: boolean;
  onSnoozeCheckIns: () => void;
  onOpenSidebar: () => void;
  onPrompt: (prompt: string) => void;
};

export function RemindersPage({
  reminders,
  onCreateReminder,
  onUpdateReminder,
  onDeleteReminder,
  snoozedToday,
  onSnoozeCheckIns,
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
          snoozedToday={snoozedToday}
          onSnoozeCheckIns={onSnoozeCheckIns}
          onPrompt={onPrompt}
        />
      </div>
    </PageFrame>
  );
}
