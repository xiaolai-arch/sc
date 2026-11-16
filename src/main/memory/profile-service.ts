import {
  isProfileCategory,
  isProfileConfidence,
  isProfileSource,
  isProfileStatus,
  MAX_PROFILE_TEXT,
  type ProfileConfidence,
  type ProfileEntry,
  type ProfileService
} from '../../shared/profile';
import { createMutex, readFileOrNull, writeFileAtomic } from '../workspace/fs-utils';
import { newId } from '../workspace/ids';
import { profileFile } from '../workspace/paths';
import { parseNote } from '../vault/note';
import { parseProfileFileDetailed, serializeProfileFile } from './profile-file';

export interface ProfileServiceOptions {
  /** Vault root (the directory holding `profile.md`). */
  root: string;
  now?: () => Date;
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('档案内容不能为空。');
  }
  const text = value.trim();
  if (text.length > MAX_PROFILE_TEXT) {
    throw new Error(`档案内容不能超过 ${MAX_PROFILE_TEXT} 字。`);
  }
  return text;
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('档案条目 ID 无效。');
  }
  return value.trim();
}

/**
 * Vault-backed personal profile. One `profile.md` holds every entry, so the
 * user can read and edit the same document in Obsidian; frontmatter `items` is
 * the machine-readable source of truth.
 */
export function createProfileService(options: ProfileServiceOptions): ProfileService {
  const root = options.root;
  const now = options.now ?? (() => new Date());
  const runExclusively = createMutex();

  async function readAll(): Promise<{ entries: ProfileEntry[]; invalid: unknown[] }> {
    const raw = await readFileOrNull(profileFile(root));
    return raw === null ? { entries: [], invalid: [] } : parseProfileFileDetailed(raw);
  }

  /** `invalid` items come from hand edits and must survive a rewrite. */
  async function writeAll(
    entries: readonly ProfileEntry[],
    invalid: readonly unknown[] = []
  ): Promise<void> {
    await writeFileAtomic(profileFile(root), serializeProfileFile(entries, invalid));
  }

  /** A malformed hand edit must not be silently replaced by an empty file. */
  async function assertWritable(): Promise<void> {
    const raw = await readFileOrNull(profileFile(root));
    if (raw === null || raw.trim() === '') return;
    const { meta } = parseNote(raw);
    if (!Array.isArray(meta.items)) {
      throw new Error('档案文件格式无法识别，已停止写入以保护现有内容。');
    }
  }

  return {
    async list(): Promise<ProfileEntry[]> {
      const { entries } = await readAll();
      return entries.sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)
      );
    },

    async create(input): Promise<ProfileEntry> {
      const text = requireText(input?.text);
      if (!isProfileCategory(input?.category)) throw new Error('档案分类无效。');
      const source = isProfileSource(input.source) ? input.source : 'user';
      const confidence: ProfileConfidence = isProfileConfidence(input.confidence)
        ? input.confidence
        : source === 'model'
          ? 'candidate'
          : 'confirmed';
      const origin =
        typeof input.origin === 'string' && input.origin.trim().length > 0
          ? input.origin.trim()
          : source === 'user'
            ? '手动添加'
            : '对话推测';

      return runExclusively(async () => {
        await assertWritable();
        const { entries, invalid } = await readAll();
        // Repeating the same fact should not pile up duplicates.
        const existing = entries.find(
          (entry) =>
            entry.status === 'active' &&
            entry.category === input.category &&
            entry.text === text
        );
        if (existing) {
          // The user confirming a fact the model guessed earlier promotes the
          // existing entry instead of adding a second, identical line.
          if (confidence !== 'confirmed' || existing.confidence === 'confirmed') {
            return existing;
          }
          const promoted: ProfileEntry = {
            ...existing,
            source,
            confidence: 'confirmed',
            ...(origin ? { origin } : {}),
            updatedAt: now().toISOString()
          };
          await writeAll(
            entries.map((entry) => (entry.id === existing.id ? promoted : entry)),
            invalid
          );
          return promoted;
        }
        const timestamp = now().toISOString();
        const entry: ProfileEntry = {
          id: newId('p'),
          category: input.category,
          text,
          source,
          confidence,
          status: 'active',
          origin,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        await writeAll([...entries, entry], invalid);
        return entry;
      });
    },

    async update(input): Promise<ProfileEntry> {
      const id = requireId(input?.id);
      const text = input.text === undefined ? undefined : requireText(input.text);
      if (input.category !== undefined && !isProfileCategory(input.category)) {
        throw new Error('档案分类无效。');
      }
      if (input.confidence !== undefined && !isProfileConfidence(input.confidence)) {
        throw new Error('档案可信度无效。');
      }
      if (input.status !== undefined && !isProfileStatus(input.status)) {
        throw new Error('档案状态无效。');
      }

      return runExclusively(async () => {
        await assertWritable();
        const { entries, invalid } = await readAll();
        const index = entries.findIndex((entry) => entry.id === id);
        if (index < 0) throw new Error('档案条目不存在。');
        const current = entries[index]!;
        const nextCategory = input.category ?? current.category;
        const nextText = text ?? current.text;
        // Merge into an identical active entry rather than create a duplicate,
        // but only when this update actually changes the text or the category.
        const duplicate =
          text === undefined && input.category === undefined
            ? undefined
            : entries.find(
                (entry, entryIndex) =>
                  entryIndex !== index &&
                  entry.status === 'active' &&
                  entry.category === nextCategory &&
                  entry.text === nextText
              );
        if (duplicate) throw new Error('已存在相同的档案条目。');
        // Editing a model guess is the user's own statement; retyping the same
        // text (e.g. only fixing the category) must not silently confirm it.
        const userEdited = text !== undefined && text !== current.text;
        const next: ProfileEntry = {
          ...current,
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(text !== undefined ? { text } : {}),
          ...(userEdited
            ? { source: 'user' as const, confidence: 'confirmed' as const }
            : {}),
          ...(input.confidence !== undefined
            ? {
                confidence: input.confidence,
                ...(input.confidence === 'confirmed' ? { source: 'user' as const } : {})
              }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: now().toISOString()
        };
        const updated = [...entries];
        updated[index] = next;
        await writeAll(updated, invalid);
        return next;
      });
    },

    async delete(input): Promise<void> {
      const id = requireId(input?.id);
      await runExclusively(async () => {
        await assertWritable();
        const { entries, invalid } = await readAll();
        const remaining = entries.filter((entry) => entry.id !== id);
        if (remaining.length === entries.length) throw new Error('档案条目不存在。');
        await writeAll(remaining, invalid);
      });
    }
  };
}
