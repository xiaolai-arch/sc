import type {
  CreateReminderInput,
  Reminder,
  UpdateReminderInput
} from '../../shared/workspace';
import { PageFrame } from './PageFrame';
import { RemindersSection } from './ProjectSections';

type RemindersPageProps = {
  reminders: Reminder[];
  onCreateReminder: (input: CreateReminderInput) => Promise<Reminder>;
  onUpdateReminder: (input: UpdateReminderInput) => Promise<Reminder>;
  snoozedToday: boolean;
  onSnoozeCheckIns: () => void;
  onOpenSidebar: () => void;
  onPrompt: (prompt: string) => void;
};

export function RemindersPage({
  reminders,
  onCreateReminder,
  onUpdateReminder,
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
          snoozedToday={snoozedToday}
          onSnoozeCheckIns={onSnoozeCheckIns}
          onPrompt={onPrompt}
        />
      </div>
    </PageFrame>
  );
}
