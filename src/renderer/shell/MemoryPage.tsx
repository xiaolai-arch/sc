import { useState } from 'react';
import type {
  CreateMemoryInput,
  DeleteMemoryInput,
  LearnerProfile,
  MemoryRecord,
  UpdateMemoryInput
} from '../../shared/memory';
import type { Workspace } from '../../shared/workspace';
import { PageFrame } from './PageFrame';
import { MemoryProfileSummary, MemorySection } from './ProjectSections';

type MemoryPageProps = {
  workspaces: Workspace[];
  memoryRecords: MemoryRecord[];
  profile: LearnerProfile | null;
  onOpenSidebar: () => void;
  onCreateMemory?: (input: CreateMemoryInput) => Promise<MemoryRecord>;
  onUpdateMemory: (input: UpdateMemoryInput) => Promise<MemoryRecord>;
  onDeleteMemory: (input: DeleteMemoryInput) => Promise<void>;
};

export function MemoryPage({
  workspaces,
  memoryRecords,
  profile,
  onOpenSidebar,
  onCreateMemory,
  onUpdateMemory,
  onDeleteMemory
}: MemoryPageProps) {
  const [filterId, setFilterId] = useState('');
  const filteredWorkspace = workspaces.find((workspace) => workspace.id === filterId) ?? null;

  return (
    <PageFrame
      title="记忆"
      subtitle={filteredWorkspace?.name ?? '全部工作区'}
      onOpenSidebar={onOpenSidebar}
      action={
        workspaces.length > 0 ? (
          <select
            aria-label="按工作区筛选记忆"
            value={filterId}
            onChange={(event) => setFilterId(event.target.value)}
            className="h-9 rounded-xl border-0 bg-[#f5f5f7] px-3 text-[13px] text-gray-700 outline-none transition-all duration-200 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#a1a1a6]"
          >
            <option value="">全部工作区</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        ) : undefined
      }
    >
      <MemoryProfileSummary profile={profile} />
      <MemorySection
        workspace={filteredWorkspace}
        workspaces={workspaces}
        memoryRecords={memoryRecords}
        onCreateMemory={onCreateMemory}
        onUpdateMemory={onUpdateMemory}
        onDeleteMemory={onDeleteMemory}
      />
    </PageFrame>
  );
}
