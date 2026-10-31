import type { ReviewAnswers } from './types';
import type { MemoryItem } from './workspace';

/** What a memory item is about — drives the learner profile buckets. */
export type MemoryKind = 'weakness' | 'strength' | 'preference' | 'plan' | 'fact';

/** A memory item as persisted in `workspaces/<id>/memory.md` (frontmatter `items`). */
export interface MemoryRecord extends MemoryItem {
  kind: MemoryKind;
}

export interface SynthesizeMemoryInput {
  workspaceId: string;
  /** Review day the answers belong to (YYYY-MM-DD); becomes the item source. */
  date: string;
  answers: ReviewAnswers;
}

export interface MemorySynthesisResult {
  /** The items appended by this call (0–3). */
  items: MemoryRecord[];
  generatedBy: 'model' | 'rules';
}

/** Deterministic learner profile aggregated from memory, ready for butler prompts. */
export interface LearnerProfile {
  workspaceId?: string;
  memoryCount: number;
  /** ISO timestamps of the oldest / newest memory item (undefined when empty). */
  firstAt?: string;
  lastAt?: string;
  strengths: string[];
  weaknesses: string[];
  preferences: string[];
  plans: string[];
  /** Newest memory texts regardless of kind, for quick prompt context. */
  recent: string[];
  /** One-paragraph Chinese summary of the learner's current state. */
  summary: string;
  generatedAt: string;
}

/** Main-process contract: vault-backed or test implementation. */
export interface MemoryService {
  list(workspaceId?: string): Promise<MemoryRecord[]>;
  synthesizeFromReview(input: SynthesizeMemoryInput): Promise<MemorySynthesisResult>;
  getProfile(workspaceId?: string): Promise<LearnerProfile>;
}
