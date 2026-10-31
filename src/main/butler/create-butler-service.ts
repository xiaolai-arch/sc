import type { ButlerService } from '../../shared/workspace';

/**
 * Placeholder replaced by the model-backed butler in the agent module.
 * Keeping the factory here lets the desktop IPC module compile against the contract.
 */
export function createButlerService(_workspaceRoot: string): ButlerService {
  throw new Error('Butler service is not implemented yet.');
}
