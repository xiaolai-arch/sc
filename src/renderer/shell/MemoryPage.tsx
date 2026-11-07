import { useState } from 'react';
import type {
  CreateMemoryInput,
  DeleteMemoryInput,
  LearnerProfile,
  MemoryRecord,
  UpdateMemoryInput
} from '../../shared/memory';
import type { Workspace } from '../../shared/workspace';
import { Select } from '../ui/Select';
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
          <Select
            aria-label="按工作区筛选记忆"
            size="sm"
            fullWidth={false}
            value={filterId}
            onChange={(event) => setFilterId(event.target.value)}
          >
            <option value="">全部工作区</option>
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </Select>
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
