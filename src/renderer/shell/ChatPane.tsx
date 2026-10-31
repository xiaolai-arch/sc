import { useEffect, useRef } from 'react';
import { MoreHorizontalIcon, SparklesIcon } from '../ui/icons';
import { Composer } from './Composer';
import type { Workspace } from '../../shared/workspace';
import type { ChatMessage } from './types';

type ChatPaneProps = {
  workspace: Workspace | null;
  messages: ChatMessage[];
  typing: boolean;
  onSend: (text: string) => void;
  modelLabel: string;
  hasApiKey: boolean;
  onOpenSettings: () => void;
  dateLabel: string;
};

const suggestedPrompts = [
  '帮我排一下今天的优先级',
  '记一下：今天数学卡在极限',
  '提醒我 21:30 复盘',
  '教我一下洛必达法则'
];

export function ChatPane({
  workspace,
  messages,
  typing,
  onSend,
  modelLabel,
  hasApiKey,
  onOpenSettings,
  dateLabel
}: ChatPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const showWelcome = messages.length === 0 && !typing;

  useEffect(() => {
    if (messages.length === 0 && !typing) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo?.({ top: node.scrollHeight });
  }, [messages, typing]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] px-4 md:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[13px] font-medium text-black">管家</span>
          <span className="text-[11px] text-gray-400">/</span>
          <span className="truncate text-[11px] text-gray-500">
            {workspace?.name ?? '全部工作区'} · {dateLabel}
          </span>
        </div>
        <button
          type="button"
          aria-label="更多"
          className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-black/[0.04] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
        >
          <MoreHorizontalIcon className="h-4 w-4" />
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="mx-auto w-full max-w-[720px] space-y-6">
          {!hasApiKey ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[#0071e3]/15 bg-[#f2f7fd] px-3 py-2">
              <p className="text-[12px] text-gray-600">未配置模型，当前使用模板计划。</p>
              <button
                type="button"
                onClick={onOpenSettings}
                className="shrink-0 text-[12px] font-medium text-[#0071e3] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
              >
                去设置
              </button>
            </div>
          ) : null}

          {showWelcome ? (
            <div className="pt-12">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0071e3] text-white">
                <SparklesIcon className="h-4 w-4" />
              </span>
              <h2 className="mt-5 text-[24px] font-semibold tracking-tight text-black">
                早上好，xiaolai。
              </h2>
              <p className="mt-2 text-[14px] leading-6 text-gray-600">
                我是你的个人管家。今天想做点什么？
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => onSend(prompt)}
                    className="rounded-full border border-black/[0.08] bg-white px-3.5 py-2 text-[12px] text-gray-600 transition-colors duration-150 hover:bg-[#f7f7f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) =>
            message.role === 'user' ? (
              <div key={message.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl bg-[#0071e3] px-3.5 py-2 text-[13px] leading-6 text-white">
                  {message.text}
                </p>
              </div>
            ) : (
              <div key={message.id} className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0071e3] text-white">
                  <SparklesIcon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-gray-500">Study Coach</p>
                  <p className="mt-1 text-[13px] leading-6 text-[#1d1d1f]">{message.text}</p>
                </div>
              </div>
            )
          )}

          {typing ? (
            <p className="ml-9 text-[12px] text-gray-500" role="status">
              正在输入…
            </p>
          ) : null}
        </div>
      </div>

      <Composer modelLabel={modelLabel} onSend={onSend} />
    </div>
  );
}
