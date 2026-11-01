import { useEffect, useRef } from 'react';
import { MenuIcon, MoreHorizontalIcon } from '../ui/icons';
import { Composer } from './Composer';
import { MarkdownText } from './MarkdownText';
import { MessageActions } from './MessageActions';
import { stepsToTrace } from './trace';
import { TraceFlow } from './TraceFlow';
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
  onOpenProjects?: () => void;
  onStop?: () => void;
  onOpenSidebar?: () => void;
  sidebarOpen?: boolean;
  composerText: string;
  onComposerTextChange: (text: string) => void;
  editing?: boolean;
  onCancelEdit?: () => void;
  onRegenerate?: (messageId: string) => void;
  onEditMessage?: (messageId: string) => void;
  onOpenModelPicker?: () => void;
  typingStatus?: string | null;
};

export function ChatPane({
  workspace,
  messages,
  typing,
  onSend,
  modelLabel,
  hasApiKey,
  onOpenSettings,
  dateLabel,
  onOpenProjects,
  onStop,
  onOpenSidebar,
  sidebarOpen = false,
  typingStatus = null,
  composerText,
  onComposerTextChange,
  editing = false,
  onCancelEdit,
  onRegenerate,
  onEditMessage,
  onOpenModelPicker
}: ChatPaneProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const showWelcome = messages.length === 0 && !typing;
  const lastRole = messages[messages.length - 1]?.role;
  const lastUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id;
  const lastAssistantMessageId = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant')?.id;

  useEffect(() => {
    if (messages.length === 0 && !typing) return;
    const node = scrollRef.current;
    if (!node) return;
    if (atBottomRef.current || lastRole === 'user') {
      node.scrollTo?.({ top: node.scrollHeight });
    }
  }, [messages, typing, lastRole]);

  const modelBanner = !hasApiKey ? (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-[#0071e3]/5 px-4 py-2.5 dark:bg-[#0a84ff]/10">
      <p className="text-[13px] text-gray-500 dark:text-[#a1a1a6]">
        未配置模型，当前使用模板计划。
      </p>
      <button
        type="button"
        onClick={onOpenSettings}
        className="shrink-0 rounded-full px-2 py-1 text-[13px] font-medium text-[#0071e3] transition-all duration-300 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#4da3ff]"
      >
        去设置
      </button>
    </div>
  ) : null;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-[#0f0f10]">
      <header
        className={`flex h-12 shrink-0 items-center justify-between gap-3 border-b border-gray-200/70 px-4 dark:border-white/10 md:px-6 ${
          showWelcome ? 'md:hidden' : ''
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          {onOpenSidebar ? (
            <button
              type="button"
              aria-label="打开导航"
              aria-expanded={sidebarOpen}
              onClick={onOpenSidebar}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:opacity-80 hover:text-black active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7] md:hidden"
            >
              <MenuIcon className="h-4 w-4" />
            </button>
          ) : null}
          <span className="text-[13px] font-medium text-black dark:text-[#f5f5f7]">阿咲</span>
          <span className="text-[12px] text-gray-400 dark:text-[#8e8e93]">/</span>
          {workspace && onOpenProjects ? (
            <button
              type="button"
              aria-label={`打开项目：${workspace.name}`}
              onClick={onOpenProjects}
              className="max-w-[180px] truncate rounded-full px-2 py-1 text-[12px] font-medium text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:opacity-80 hover:text-[#0071e3] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#4da3ff]"
            >
              {workspace.name}
            </button>
          ) : (
            <span className="truncate text-[12px] text-gray-500 dark:text-[#8e8e93]">
              {workspace?.name ?? '全部工作区'}
            </span>
          )}
          <span className="truncate text-[12px] text-gray-500 dark:text-[#8e8e93]">
            · {dateLabel}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="更多"
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:opacity-80 hover:text-black active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
          >
            <MoreHorizontalIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      {showWelcome ? (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
          {modelBanner ? (
            <div className="mx-auto w-full max-w-[760px] px-4 pt-4 md:px-0">
              {modelBanner}
            </div>
          ) : null}
          <div className="flex flex-1 items-center justify-center px-4 py-10 md:px-6">
            <div className="w-full max-w-[680px] -translate-y-[3vh]">
              <div className="flex flex-col items-center text-center">
                <h1 className="text-[22px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">
                  早上好，xiaolai。
                </h1>
                <p className="mt-2 text-[14px] leading-6 text-gray-500 dark:text-[#8e8e93]">
                  今天想推进什么？把目标交给阿咲，他会帮你拆成下一步。
                </p>
              </div>

              <div className="mt-8">
                <Composer
                  hero
                  modelLabel={modelLabel}
                  text={composerText}
                  onTextChange={onComposerTextChange}
                  onSend={onSend}
                  disabled={typing}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!showWelcome ? (
      <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={() => {
          const node = scrollRef.current;
          if (!node) return;
          atBottomRef.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-6"
      >
        <div className="mx-auto w-full max-w-[760px] space-y-6">
          {modelBanner}

          {messages.map((message) =>
            message.role === 'user' ? (
              <div key={message.id} className="group flex flex-col items-end">
                <p className="max-w-[85%] rounded-2xl bg-[#0071e3] px-4 py-2.5 text-[14px] leading-6 text-white">
                  {message.text}
                </p>
                {message.id === lastUserMessageId && onEditMessage ? (
                  <MessageActions
                    text={message.text}
                    showCopy={false}
                    disabled={typing || Boolean(message.streaming)}
                    onEdit={() => onEditMessage(message.id)}
                  />
                ) : null}
              </div>
            ) : (
              <div key={message.id} className="group">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-gray-500 dark:text-[#8e8e93]">阿咲</p>
                  <TraceFlow items={message.trace ?? stepsToTrace(message.steps)} />
                  {message.text ? (
                    <div className="mt-1">
                      <MarkdownText text={message.text} />
                    </div>
                  ) : null}
                  <MessageActions
                    text={message.text}
                    disabled={typing || Boolean(message.streaming)}
                    {...(message.id === lastAssistantMessageId && onRegenerate
                      ? { onRegenerate: () => onRegenerate(message.id) }
                      : {})}
                  />
                </div>
              </div>
            )
          )}

          {typing && (typingStatus || !messages.some((message) => message.streaming)) ? (
            <p className="text-[13px] text-gray-500 dark:text-[#8e8e93]" role="status">
              {typingStatus ?? '正在输入…'}
            </p>
          ) : null}
        </div>
      </div>

      <Composer
        modelLabel={modelLabel}
        text={composerText}
        onTextChange={onComposerTextChange}
        onSend={onSend}
        disabled={typing}
        editing={editing}
        {...(onStop ? { onStop } : {})}
        {...(onCancelEdit ? { onCancelEdit } : {})}
        {...(onOpenModelPicker ? { onOpenModelPicker } : {})}
      />
      </div>
      ) : null}
    </div>
  );
}
