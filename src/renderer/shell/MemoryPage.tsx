import type {
  DeleteMemoryInput,
  LearnerProfile,
  MemoryRecord,
  UpdateMemoryInput
} from '../../shared/memory';
import type { Workspace } from '../../shared/workspace';
import { PageFrame } from './PageFrame';
import { MemoryProfileSummary, MemorySection } from './ProjectSections';

type MemoryPageProps = {
  workspace: Workspace | null;
  memoryRecords: MemoryRecord[];
  profile: LearnerProfile | null;
  onOpenSidebar: () => void;
  onUpdateMemory: (input: UpdateMemoryInput) => Promise<MemoryRecord>;
  onDeleteMemory: (input: DeleteMemoryInput) => Promise<void>;
};

export function MemoryPage({
  workspace,
  memoryRecords,
  profile,
  onOpenSidebar,
  onUpdateMemory,
  onDeleteMemory
}: MemoryPageProps) {
  return (
    <PageFrame
      title="记忆"
      subtitle={workspace?.name ?? '全部项目'}
      onOpenSidebar={onOpenSidebar}
    >
      <MemoryProfileSummary profile={profile} />
      <MemorySection
        workspace={workspace}
        memoryRecords={memoryRecords}
        onUpdateMemory={onUpdateMemory}
        onDeleteMemory={onDeleteMemory}
      />
    </PageFrame>
  );
}
