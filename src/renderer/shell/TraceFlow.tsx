import { useId, useState } from 'react';
import { cn } from '../ui/cn';
import { ChevronDownIcon, TerminalIcon, ThinkIcon } from '../ui/icons';
import { MarkdownText } from './MarkdownText';
import type { ChatTraceItem } from './types';

type TraceFlowProps = {
  items: ChatTraceItem[];
};

const rowClass =
  'flex w-full min-h-[26px] items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30';

const rowHoverClass =
  'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]';

function firstLine(text: string): string {
  return (
    text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  );
}

function latestParagraphFirstLine(text: string): string {
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n[\t ]*\n+/);
  for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
    const line = firstLine(paragraphs[index] ?? '');
    if (line) return line;
  }
  return '';
}

function summaryText(text: string, streaming = false): string {
  const raw = streaming ? latestParagraphFirstLine(text) : firstLine(text);
  return raw.replaceAll('**', '').trim();
}

function truncateSummary(text: string, limit = 96): string {
  const chars = Array.from(text);
  return chars.length > limit ? `${chars.slice(0, limit - 1).join('')}…` : text;
}

function ReasoningRow({
  item
}: {
  item: Extract<ChatTraceItem, { kind: 'reasoning' }>;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const hasText = item.text.trim().length > 0;
  const summary = truncateSummary(summaryText(item.text, item.streaming)) || '正在思考…';
  const expandable = hasText;

  if (!expandable) return null;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`思考：${summary}`}
        onClick={() => setOpen((value) => !value)}
        className={cn(rowClass, rowHoverClass)}
      >
        <ThinkIcon
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            item.streaming
              ? 'text-[#0071e3] dark:text-[#4da3ff]'
              : 'text-gray-400 dark:text-[#8e8e93]'
          )}
        />
        <span className="shrink-0 text-[12px] font-medium text-gray-600 dark:text-[#a1a1a6]">
          思考
        </span>
        {!open ? (
          <>
            <span
              aria-hidden="true"
              className="h-0.5 w-0.5 shrink-0 rounded-full bg-gray-400 dark:bg-[#8e8e93]"
            />
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[12px] text-gray-500 dark:text-[#8e8e93]',
                item.streaming && 'animate-pulse text-[#0071e3] dark:text-[#4da3ff]'
              )}
            >
              {summary}
            </span>
          </>
        ) : (
          <span className="flex-1" />
        )}
        <ChevronDownIcon
          className={cn(
            'h-3 w-3 shrink-0 text-gray-400 transition-transform duration-150 dark:text-[#8e8e93]',
            open && 'rotate-180'
          )}
        />
      </button>
      {open ? (
        <div
          id={panelId}
          className="mt-1 pb-1 pl-[22px] pr-1 text-[12px] leading-5 text-gray-600 dark:text-[#a1a1a6]"
        >
          <MarkdownText text={item.text} />
        </div>
      ) : null}
    </div>
  );
}

function ToolRow({ item }: { item: Extract<ChatTraceItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const detail = item.detail?.trim() ?? '';
  const expandable = detail.length > 0;
  const detailSummary = detail ? truncateSummary(firstLine(detail)) : '';
  const summary =
    item.status === 'running'
      ? '运行中…'
      : item.status === 'failed'
        ? detailSummary || '失败'
        : detailSummary || '已完成';
  const failed = item.status === 'failed';
  const running = item.status === 'running';

  const content = (
    <>
      <TerminalIcon
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          failed
            ? 'text-[#d70015] dark:text-[#ff7b72]'
            : running
              ? 'text-[#0071e3] dark:text-[#4da3ff]'
              : 'text-gray-400 dark:text-[#8e8e93]'
        )}
      />
      <span className="shrink-0 text-[12px] font-medium text-gray-600 dark:text-[#a1a1a6]">
        {item.label || item.name}
      </span>
      {!open ? (
        <>
          <span
            aria-hidden="true"
            className="h-0.5 w-0.5 shrink-0 rounded-full bg-gray-400 dark:bg-[#8e8e93]"
          />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[12px]',
              failed
                ? 'text-[#d70015] dark:text-[#ff7b72]'
                : running
                  ? 'animate-pulse text-[#0071e3] dark:text-[#4da3ff]'
                  : 'text-gray-500 dark:text-[#8e8e93]'
            )}
          >
            {summary}
          </span>
        </>
      ) : (
        <span className="flex-1" />
      )}
      {expandable ? (
        <ChevronDownIcon
          className={cn(
            'h-3 w-3 shrink-0 text-gray-400 transition-transform duration-150 dark:text-[#8e8e93]',
            open && 'rotate-180'
          )}
        />
      ) : null}
    </>
  );

  return (
    <div>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${item.label || item.name}：${summary}`}
          onClick={() => setOpen((value) => !value)}
          className={cn(rowClass, rowHoverClass)}
        >
          {content}
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
      {open && expandable ? (
        <pre
          id={panelId}
          className="mt-1 whitespace-pre-wrap break-words pb-1 pl-[22px] pr-1 font-sans text-[12px] leading-5 text-gray-600 dark:text-[#a1a1a6]"
        >
          {detail}
        </pre>
      ) : null}
    </div>
  );
}

/** Compact, ordered thinking/tool rows rendered above an assistant answer. */
export function TraceFlow({ items }: TraceFlowProps) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1 space-y-0.5">
      {items.map((item) =>
        item.kind === 'reasoning' ? (
          <ReasoningRow key={item.id} item={item} />
        ) : (
          <ToolRow key={item.id} item={item} />
        )
      )}
    </div>
  );
}
