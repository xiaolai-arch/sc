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
  onOpenModelPicker?: () => void;
  /** Centered hero variant used by the empty conversation screen. */
  hero?: boolean;
};

export function Composer({
  modelLabel,
  text,
  onTextChange,
  onSend,
  disabled = false,
  onStop,
  editing = false,
  onCancelEdit,
  onOpenModelPicker,
  hero = false
}: ComposerProps) {
  function send() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    onTextChange('');
  }

  return (
    <div className={hero ? 'w-full' : 'shrink-0 px-4 pb-4 pt-2 md:px-6'}>
      <div className="mx-auto w-full max-w-[760px] rounded-2xl bg-white p-3 shadow-sm dark:bg-[#1c1c1e]">
        {editing ? (
          <div className="mb-2 flex items-center justify-between rounded-xl bg-[#0071e3]/5 px-3 py-1.5 text-[12px] text-gray-500 dark:bg-[#0a84ff]/10 dark:text-[#a1a1a6]">
            <span>正在编辑已发送的消息</span>
            {onCancelEdit ? (
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded-full px-2 py-1 font-medium text-[#0071e3] transition-all duration-300 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#4da3ff]"
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
          placeholder="向阿咲提问，或说「记一下…」"
          aria-label="向阿咲提问"
          className="min-h-[48px] max-h-36 w-full resize-none bg-transparent px-1 py-1 text-[14px] leading-6 text-[#1d1d1f] outline-none placeholder:text-gray-500 dark:text-[#f5f5f7]"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="添加附件"
              className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:opacity-80 hover:text-black active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:opacity-80 hover:text-black active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
            >
              <LockIcon className="h-3.5 w-3.5" />
              计划模式
              <ChevronDownIcon className="h-3 w-3" />
            </button>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            {onOpenModelPicker ? (
              <button
                type="button"
                aria-label="设置本对话模型"
                onClick={onOpenModelPicker}
                className="hidden min-w-0 items-center gap-1.5 rounded-full px-2 py-1 text-[12px] font-medium text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:opacity-80 hover:text-black active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7] sm:flex"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#34c759]" />
                <span className="truncate">{modelLabel}</span>
              </button>
            ) : (
              <span className="hidden min-w-0 items-center gap-1.5 text-[12px] text-gray-500 dark:text-[#8e8e93] sm:flex">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#34c759]" />
                <span className="truncate">{modelLabel}</span>
              </span>
            )}
            {disabled && onStop ? (
              <button
                type="button"
                aria-label="停止生成"
                onClick={onStop}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1d1d1f] text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:bg-[#242426]"
              >
                <span aria-hidden="true" className="h-3 w-3 rounded-[2px] bg-white" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="发送"
                disabled={!text.trim() || disabled}
                onClick={send}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0071e3] text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100"
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
