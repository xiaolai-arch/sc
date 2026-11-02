import { useState, type ReactNode } from 'react';
import { parseWikiLink } from '../../shared/knowledge';

type MarkdownTextProps = {
  text: string;
  /** Resolves a `[[topic]]` target; absent keeps the wiki syntax literal. */
  resolveWikiLink?: (target: string) => { id: string } | null;
  onWikiLink?: (id: string) => void;
};

type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; language: string; code: string };

function renderInline(
  text: string,
  keyPrefix: string,
  props: Pick<MarkdownTextProps, 'resolveWikiLink' | 'onWikiLink'>
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(\[\[[^\]\n]+\]\]|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-inline-${index}`;
    index += 1;
    if (token.startsWith('[[')) {
      const link = parseWikiLink(token);
      const resolvedId =
        link && props.resolveWikiLink ? props.resolveWikiLink(link.target)?.id : undefined;
      if (link && resolvedId && props.onWikiLink) {
        nodes.push(
          <button
            key={key}
            type="button"
            aria-label={`打开知识主题 ${link.target}`}
            onClick={() => props.onWikiLink?.(resolvedId)}
            className="rounded-[3px] text-[#0071e3] underline decoration-[#0071e3]/40 underline-offset-2 transition-opacity duration-200 hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#4da3ff] dark:decoration-[#4da3ff]/40"
          >
            {link.label}
          </button>
        );
      } else if (link && props.resolveWikiLink) {
        nodes.push(
          <span
            key={key}
            title="没有这个知识点"
            className="border-b border-dashed border-current opacity-60"
          >
            {link.label}
          </span>
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded-[6px] bg-black/[0.06] dark:bg-white/10 px-1 py-0.5 text-[12px]">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(token);
      if (link) {
        nodes.push(
          <a
            key={key}
            href={link[2]}
            target="_blank"
            rel="noreferrer"
            className="text-[#0071e3] dark:text-[#4da3ff] underline underline-offset-2 hover:underline"
          >
            {link[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (trimmed === '') {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', language, code: code.join('\n') });
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: Math.min(3, heading[1]!.length) as 1 | 2 | 3,
        text: heading[2]!
      });
      index += 1;
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const current = (lines[index] ?? '').trim();
        const item = isOrdered
          ? /^\d+\.\s+(.+)$/.exec(current)
          : /^[-*]\s+(.+)$/.exec(current);
        if (!item) break;
        items.push(item[1]!);
        index += 1;
      }
      blocks.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = (lines[index] ?? '').trim();
      if (
        current === '' ||
        current.startsWith('```') ||
        /^(#{1,3})\s+/.test(current) ||
        /^[-*]\s+/.test(current) ||
        /^\d+\.\s+/.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard access can be unavailable in tests or restricted webviews.
        }
      }}
      className="rounded-full px-2 py-1 text-[11px] font-medium text-gray-400 transition-all duration-300 hover:bg-white/10 hover:text-gray-200 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93]"
    >
      {copied ? '已复制' : '复制'}
    </button>
  );
}

function CodeBlock({ language, code, blockKey }: { language: string; code: string; blockKey: string }) {
  return (
    <div key={blockKey} className="my-3 overflow-hidden rounded-xl bg-[#1d1d1f] dark:bg-[#0d0d0f] dark:border dark:border-white/10">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">{language || 'code'}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 text-[13px] leading-5 text-[#f2f2f7]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function MarkdownText({ text, resolveWikiLink, onWikiLink }: MarkdownTextProps) {
  const blocks = parseBlocks(text);
  return (
    <div className="text-[14px] leading-6 text-[#1d1d1f] dark:text-[#f5f5f7]">
      {blocks.map((block, index) => {
        const key = `block-${index}`;
        if (block.type === 'code') {
          return <CodeBlock key={key} blockKey={key} language={block.language} code={block.code} />;
        }
        if (block.type === 'heading') {
          const className =
            block.level === 1
              ? 'mb-2 mt-4 text-[19px] font-semibold tracking-tight'
              : block.level === 2
                ? 'mb-1.5 mt-3 text-[16px] font-semibold tracking-tight'
                : 'mb-1 mt-2 text-[14px] font-semibold';
          return (
            <p key={key} className={className}>
              {renderInline(block.text, key, { resolveWikiLink, onWikiLink })}
            </p>
          );
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return (
            <Tag
              key={key}
              className={`my-2 space-y-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-item-${itemIndex}`}>
                  {renderInline(item, `${key}-item-${itemIndex}`, { resolveWikiLink, onWikiLink })}
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={key} className="my-2 whitespace-pre-wrap">
            {renderInline(block.text, key, { resolveWikiLink, onWikiLink })}
          </p>
        );
      })}
    </div>
  );
}
