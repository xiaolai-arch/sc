/**
 * The vault-wide personal profile: facts about the user that are not tied to
 * one project. It lives in `profile.md` at the vault root so a life preference
 * ("工作日只有一小时") applies to every project instead of being duplicated.
 *
 * Every entry records where it came from. Model guesses are stored as
 * `candidate` and never treated as established fact until the user confirms.
 */

export type ProfileCategory = 'identity' | 'constraints' | 'abilities' | 'recent';
export type ProfileSource = 'user' | 'model';
export type ProfileConfidence = 'confirmed' | 'candidate';
export type ProfileStatus = 'active' | 'expired';

/** A value this entry used to hold, kept when an edit replaces it. */
export interface ProfileHistoryEntry {
  /** The replaced text as it was before the edit. */
  text: string;
  /** The origin the entry carried while this was the current value. */
  origin: string;
  source: ProfileSource;
  /** ISO time at which this value was replaced by a newer one. */
  replacedAt: string;
}

/**
 * How many replaced values an entry keeps. The array is newest first; older
 * records fall off the end so `profile.md` cannot grow without bound.
 */
export const PROFILE_HISTORY_LIMIT = 5;

/** Prepends `record` to `history`, keeping at most `PROFILE_HISTORY_LIMIT`. */
export function pushProfileHistory(
  history: readonly ProfileHistoryEntry[] | undefined,
  record: ProfileHistoryEntry
): ProfileHistoryEntry[] {
  return [record, ...(history ?? [])].slice(0, PROFILE_HISTORY_LIMIT);
}

export interface ProfileEntry {
  id: string;
  category: ProfileCategory;
  text: string;
  /** Who wrote it: the user directly, or the model proposing a fact. */
  source: ProfileSource;
  /** Candidates are shown as suggestions; prompts mark them as unverified. */
  confidence: ProfileConfidence;
  status: ProfileStatus;
  /** Free-form origin, e.g. `对话 2026-11-15` or `手动添加`. */
  origin: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Replaced values, newest first. Absent until the entry is edited for the
   * first time; prompts never see it — the current text stays the one truth.
   */
  history?: ProfileHistoryEntry[];
}

export interface CreateProfileEntryInput {
  category: ProfileCategory;
  text: string;
  source?: ProfileSource;
  confidence?: ProfileConfidence;
  origin?: string;
}

export interface UpdateProfileEntryInput {
  id: string;
  category?: ProfileCategory;
  text?: string;
  /** Confirming a candidate turns a model guess into an established fact. */
  confidence?: ProfileConfidence;
  status?: ProfileStatus;
}

export interface DeleteProfileEntryInput {
  id: string;
}

/** Renderer-facing contract over IPC. */
export interface ProfileApi {
  listProfile(): Promise<ProfileEntry[]>;
  createProfileEntry(input: CreateProfileEntryInput): Promise<ProfileEntry>;
  updateProfileEntry(input: UpdateProfileEntryInput): Promise<ProfileEntry>;
  deleteProfileEntry(input: DeleteProfileEntryInput): Promise<void>;
}

/** Main-process contract: vault-backed profile storage. */
export interface ProfileService {
  list(): Promise<ProfileEntry[]>;
  create(input: CreateProfileEntryInput): Promise<ProfileEntry>;
  update(input: UpdateProfileEntryInput): Promise<ProfileEntry>;
  delete(input: DeleteProfileEntryInput): Promise<void>;
}

/** Longest entry accepted by the service and the page's inputs. */
export const MAX_PROFILE_TEXT = 500;

export const PROFILE_CATEGORY_LABELS: Record<ProfileCategory, string> = {
  identity: '关于我',
  constraints: '偏好与约束',
  abilities: '能力与经验',
  recent: '近期变化'
};

export const PROFILE_CATEGORY_ORDER: ProfileCategory[] = [
  'identity',
  'constraints',
  'abilities',
  'recent'
];

export function isProfileCategory(value: unknown): value is ProfileCategory {
  return (
    value === 'identity' ||
    value === 'constraints' ||
    value === 'abilities' ||
    value === 'recent'
  );
}

export function isProfileSource(value: unknown): value is ProfileSource {
  return value === 'user' || value === 'model';
}

export function isProfileConfidence(value: unknown): value is ProfileConfidence {
  return value === 'confirmed' || value === 'candidate';
}

export function isProfileStatus(value: unknown): value is ProfileStatus {
  return value === 'active' || value === 'expired';
}

/**
 * Entries a prompt or page should use: active only, confirmed first, newest
 * first inside each group.
 */
export function activeProfileEntries(entries: readonly ProfileEntry[]): ProfileEntry[] {
  return entries
    .filter((entry) => entry.status === 'active')
    .sort((a, b) => {
      const confidence = (a.confidence === 'confirmed' ? 0 : 1) - (b.confidence === 'confirmed' ? 0 : 1);
      return confidence || b.updatedAt.localeCompare(a.updatedAt);
    });
}

/** Groups active entries for the profile page and prompt sections. */
export function groupProfileEntries(
  entries: readonly ProfileEntry[]
): Record<ProfileCategory, ProfileEntry[]> {
  const grouped: Record<ProfileCategory, ProfileEntry[]> = {
    identity: [],
    constraints: [],
    abilities: [],
    recent: []
  };
  for (const entry of activeProfileEntries(entries)) grouped[entry.category].push(entry);
  return grouped;
}
