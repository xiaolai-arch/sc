import type { WorkspaceService } from '../../shared/workspace';

/**
 * Placeholder replaced by the vault-backed implementation in the workspace module.
 * Keeping the factory here lets the desktop IPC module compile against the contract.
 */
export function createWorkspaceService(_root: string): WorkspaceService {
  throw new Error('Workspace service is not implemented yet.');
}
