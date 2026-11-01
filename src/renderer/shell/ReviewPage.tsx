import type { ReviewRecord } from '../../shared/ipc';
import type { Workspace } from '../../shared/workspace';
import { PageFrame } from './PageFrame';
import { ReviewSection } from './ProjectSections';

type ReviewPageProps = {
  workspace: Workspace | null;
  reviews: ReviewRecord[];
  onOpenSidebar: () => void;
  onPrompt: (prompt: string) => void;
};

export function ReviewPage({
  workspace,
  reviews,
  onOpenSidebar,
  onPrompt
}: ReviewPageProps) {
  return (
    <PageFrame
      title="复盘"
      subtitle={workspace?.name ?? '全部项目'}
      onOpenSidebar={onOpenSidebar}
    >
      <ReviewSection workspace={workspace} reviews={reviews} onPrompt={onPrompt} />
    </PageFrame>
  );
}
