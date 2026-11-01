import {
  ChevronDownIcon,
  LockIcon,
  PlusIcon,
  SendIcon
} from '../ui/icons';

type ComposerProps = {
  modelLabel: string;
  text: string;
  onTextChange: (text: string) => void;
  onSend: (text: string) => void;
  disabled?: boolean;
  onStop?: () => void;
  editing?: boolean;
  onCancelEdit?: () => void;
};

export function Composer({
  modelLabel,
  text,
  onTextChange,
  onSend,
  disabled = false,
  onStop,
  editing = false,
  onCancelEdit
}: ComposerProps) {
  function send() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    onTextChange('');
  }

  return (
    <div className="shrink-0 px-4 pb-4 pt-2 md:px-6">
      <div className="mx-auto w-full max-w-[760px] rounded-2xl border border-black/[0.08] dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-3 shadow-sm">
        {editing ? (
          <div className="mb-2 flex items-center justify-between rounded-md bg-[#f2f7fd] dark:bg-[#16202b] px-2 py-1 text-[11px] text-gray-600 dark:text-[#a1a1a6]">
            <span>正在编辑已发送的消息</span>
            {onCancelEdit ? (
              <button
                type="button"
                onClick={onCancelEdit}
                className="font-medium text-[#0071e3] dark:text-[#4da3ff] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
              >
                取消编辑
              </button>
            ) : null}
          </div>
        ) : null}
        <textarea
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="向管家提问，或说「记一下…」"
          aria-label="向管家提问"
          className="max-h-32 min-h-[44px] w-full resize-none bg-transparent px-1 py-1 text-[13px] leading-5 text-[#1d1d1f] dark:text-[#f5f5f7] outline-none placeholder:text-gray-500"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="添加附件"
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 dark:text-[#8e8e93] transition-colors duration-150 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-black dark:hover:text-[#f5f5f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-gray-500 dark:text-[#8e8e93] transition-colors duration-150 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] hover:text-black dark:hover:text-[#f5f5f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
            >
              <LockIcon className="h-3.5 w-3.5" />
              计划模式
              <ChevronDownIcon className="h-3 w-3" />
            </button>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden min-w-0 items-center gap-1.5 text-[11px] text-gray-500 dark:text-[#8e8e93] sm:flex">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#34c759]" />
              <span className="truncate">{modelLabel}</span>
            </span>
            {disabled && onStop ? (
              <button
                type="button"
                aria-label="停止生成"
                onClick={onStop}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1d1d1f] text-white transition-all duration-300 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none"
              >
                <span aria-hidden="true" className="h-3 w-3 rounded-sm bg-white" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="发送"
                disabled={!text.trim() || disabled}
                onClick={send}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0071e3] text-white transition-all duration-300 hover:opacity-80 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none"
              >
                <SendIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
