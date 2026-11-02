import type {
  KnowledgeService,
  KnowledgeStatus,
  KnowledgeTopic
} from '../../shared/knowledge';

/** A topic plus the short note excerpt prompts use to judge current progress. */
export interface KnowledgeTopicContext extends KnowledgeTopic {
  noteExcerpt?: string;
}

export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  planned: '计划中',
  learning: '在学',
  mastered: '已掌握',
  paused: '暂停'
};

const DEFAULT_MAX_NOTE_TOPICS = 8;
const DEFAULT_MAX_NOTE_CHARS = 240;

/** Prompt-sized text: headings dropped, whitespace collapsed, hard clipped. */
export function clipKnowledgeText(value: string, maxLength: number): string {
  const text = value
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/**
 * Attaches short note excerpts to the leading topics. Best-effort: an
 * unreadable note must never drop the topic or fail the caller, and topics
 * past `maxNotes` keep their summary/level without a note read.
 */
export async function attachKnowledgeNotes(
  topics: KnowledgeTopic[],
  knowledgeService: KnowledgeService | null,
  options: { maxNotes?: number; maxChars?: number } = {}
): Promise<KnowledgeTopicContext[]> {
  if (knowledgeService === null) return topics;
  const maxNotes = options.maxNotes ?? DEFAULT_MAX_NOTE_TOPICS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_NOTE_CHARS;
  return Promise.all(
    topics.map(async (topic, index) => {
      if (index >= maxNotes) return topic;
      try {
        const note = await knowledgeService.getNote(topic.id);
        const excerpt = clipKnowledgeText(note.body, maxChars);
        return excerpt ? { ...topic, noteExcerpt: excerpt } : topic;
      } catch {
        return topic;
      }
    })
  );
}
