import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../ui/cn';
import { ChevronDownIcon, TerminalIcon, ThinkIcon } from '../ui/icons';
import { MarkdownText } from './MarkdownText';
import type { ChatTraceItem } from './types';

type TraceFlowProps = {
  items: ChatTraceItem[];
};

const rowClass =
  'flex w-full min-h-[26px] items-center gap-1.5 rounded-xl px-1.5 py-0.5 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30';

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

function elapsedSeconds(startedAt: number | undefined, endedAt: number | undefined): number | null {
  if (startedAt === undefined || endedAt === undefined) return null;
  return Math.max(0, Math.round((endedAt - startedAt) / 1000));
}

/**
 * One thinking block. It is expanded while the model is thinking so the chain
 * is visible in the conversation, and folds to "已思考 N 秒" once the answer
 * starts. Timestamps are absolute so navigating away and back does not restart
 * the clock.
 */
function ReasoningRow({
  item
}: {
  item: Extract<ChatTraceItem, { kind: 'reasoning' }>;
}) {
  const streaming = item.streaming === true;
  const hasText = item.text.trim().length > 0;
  const [open, setOpen] = useState(streaming);
  const touchedRef = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const panelId = useId();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** True while the reader keeps the live tail in view; scrolling up pauses it. */
  const pinnedRef = useRef(true);
  const summary = truncateSummary(summaryText(item.text, streaming));

  useEffect(() => {
    if (!streaming) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);

  useEffect(() => {
    if (streaming) {
      pinnedRef.current = true;
      setOpen(true);
      touchedRef.current = false;
    } else if (!touchedRef.current) {
      // The answer has started: fold the chain, but keep it one click away.
      setOpen(false);
    }
  }, [streaming]);

  // Follow the newest thought like a terminal, unless the reader scrolled up.
  useEffect(() => {
    if (!streaming || !open || !hasText) return;
    const node = bodyRef.current;
    if (node && pinnedRef.current) node.scrollTop = node.scrollHeight;
  }, [item.text, streaming, open, hasText]);

  const elapsed = elapsedSeconds(item.startedAt, item.endedAt ?? (streaming ? now : undefined));
  const toggle = () => {
    touchedRef.current = true;
    setOpen((value) => !value);
  };

  if (!hasText && !streaming) return null;

  const header = (
    <>
      <ThinkIcon
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          streaming
            ? 'animate-pulse text-[#0071e3] dark:text-[#4da3ff]'
            : 'text-gray-400 dark:text-[#8e8e93]'
        )}
      />
      <span className="shrink-0 text-[13px] font-medium text-gray-500 dark:text-[#a1a1a6]">
        思考过程
      </span>
      {elapsed !== null ? (
        <span
          role="status"
          className={cn(
            'shrink-0 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums',
            streaming
              ? 'bg-[#0071e3]/10 text-[#0071e3] dark:bg-[#0a84ff]/15 dark:text-[#4da3ff]'
              : 'bg-black/[0.05] text-gray-500 dark:bg-white/[0.08] dark:text-[#a1a1a6]'
          )}
        >
          {streaming ? `${elapsed}s` : `${elapsed} 秒`}
        </span>
      ) : null}
      {!open && summary ? (
        <>
          <span
            aria-hidden="true"
            className="h-0.5 w-0.5 shrink-0 rounded-full bg-gray-400 dark:bg-[#8e8e93]"
          />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[12px] text-gray-500 dark:text-[#8e8e93]',
              streaming && 'animate-pulse text-[#0071e3] dark:text-[#4da3ff]'
            )}
          >
            {summary}
          </span>
        </>
      ) : (
        <span className="flex-1" />
      )}
      {hasText ? (
        <ChevronDownIcon
          className={cn(
            'h-3 w-3 shrink-0 text-gray-400 transition-transform duration-300 dark:text-[#8e8e93]',
            open && 'rotate-180'
          )}
        />
      ) : null}
    </>
  );

  return (
    <div className="overflow-hidden rounded-xl border border-black/[0.05] bg-black/[0.02] dark:border-white/[0.06] dark:bg-white/[0.03]">
      {hasText ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`思考过程：${summary || '正在思考'}`}
          onClick={toggle}
          className={cn(rowClass, rowHoverClass)}
        >
          {header}
        </button>
      ) : (
        <div className={rowClass} role="status">
          {header}
          <span className="min-w-0 flex-1 truncate text-[12px] animate-pulse text-[#0071e3] dark:text-[#4da3ff]">
            正在思考…
          </span>
        </div>
      )}
      {open && hasText ? (
        <div
          id={panelId}
          ref={bodyRef}
          onScroll={() => {
            const node = bodyRef.current;
            if (!node) return;
            pinnedRef.current =
              node.scrollHeight - node.scrollTop - node.clientHeight < 24;
          }}
          className={cn(
            'border-t border-black/[0.05] px-3 py-2 text-[12px] leading-5 text-gray-500 [&_li]:text-[12px] [&_li]:leading-5 [&_p]:text-[12px] [&_p]:leading-5 dark:border-white/[0.06] dark:text-[#a1a1a6]',
            streaming
              ? // While thinking, the tail follows the stream in a capped
                // window; the global style keeps its scrollbar implicit.
                'max-h-[45vh] overflow-y-auto'
              : // Once finished, the whole chain renders inline like the answer.
                ''
          )}
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
      <span className="shrink-0 text-[13px] font-medium text-gray-500 dark:text-[#a1a1a6]">
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
            'h-3 w-3 shrink-0 text-gray-400 transition-transform duration-300 dark:text-[#8e8e93]',
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
          className="mt-1 whitespace-pre-wrap break-words pb-1 pl-[22px] pr-1 font-sans text-[12px] leading-5 text-gray-500 dark:text-[#a1a1a6]"
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
