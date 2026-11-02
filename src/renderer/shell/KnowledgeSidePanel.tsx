import type { KnowledgeBacklink, KnowledgeTopic } from '../../shared/knowledge';
import { evidenceDate } from './knowledge-ui';

type KnowledgeSidePanelProps = {
  topic: KnowledgeTopic;
  backlinks: KnowledgeBacklink[];
  backlinksError: string | null;
  onOpenTopic(topicId: string): void;
  onReloadBacklinks(): void;
};

const sectionTitle = 'text-[11px] font-medium text-gray-400 dark:text-[#8e8e93]';
const emptyText = 'mt-1 text-[12px] text-gray-400 dark:text-[#8e8e93]';

/** Evidence and backlinks for the open topic; one instance, column or block. */
export function KnowledgeSidePanel({
  topic,
  backlinks,
  backlinksError,
  onOpenTopic,
  onReloadBacklinks
}: KnowledgeSidePanelProps) {
  const evidence = [...topic.evidence].reverse();
  return (
    <div className="space-y-5">
      <section>
        <p className={sectionTitle}>证据 {topic.evidence.length} 条</p>
        {evidence.length === 0 ? (
          <p className={emptyText}>还没有证据。</p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {evidence.map((entry) => (
              <li
                key={entry.id}
                className="text-[12px] leading-5 text-gray-600 dark:text-[#a1a1a6]"
              >
                <span className="text-gray-400 dark:text-[#8e8e93]">
                  {evidenceDate(entry.date)} ·{' '}
                </span>
                {entry.title}
                {entry.note ? (
                  <span className="block text-[11px] text-gray-400 dark:text-[#8e8e93]">
                    {entry.note}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <p className={sectionTitle}>反向链接 {backlinks.length} 条</p>
        {backlinksError ? (
          <div className="mt-1">
            <p className="text-[12px] text-[#ff3b30]">反向链接暂时不可用。</p>
            <button
              type="button"
              onClick={onReloadBacklinks}
              className="mt-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[#0071e3] transition-colors hover:bg-[#0071e3]/10 dark:text-[#4da3ff]"
            >
              重新加载
            </button>
          </div>
        ) : backlinks.length === 0 ? (
          <p className={emptyText}>还没有反向链接。</p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {backlinks.map((link) => (
              <li key={link.topicId}>
                <button
                  type="button"
                  aria-label={`打开知识主题 ${link.name}`}
                  onClick={() => onOpenTopic(link.topicId)}
                  className="rounded-[3px] text-left text-[12px] text-[#0071e3] underline decoration-[#0071e3]/40 underline-offset-2 transition-opacity duration-200 hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#4da3ff] dark:decoration-[#4da3ff]/40"
                >
                  {link.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
