import { useState } from 'react';

type MessageActionsProps = {
  text: string;
  disabled?: boolean;
  showCopy?: boolean;
  onRegenerate?: () => void;
  onEdit?: () => void;
};

const actionClass =
  'rounded-full px-2.5 py-1 text-[12px] font-medium text-gray-500 transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:bg-black/[0.04] hover:text-black hover:opacity-80 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]';

export function MessageActions({
  text,
  disabled = false,
  showCopy = true,
  onRegenerate,
  onEdit
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (disabled) return;
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be unavailable in tests or restricted webviews.
    }
  }

  return (
    <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
      {showCopy ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => void copy()}
          className={actionClass}
        >
          {copied ? '已复制' : '复制'}
        </button>
      ) : null}
      {onRegenerate ? (
        <button type="button" disabled={disabled} onClick={onRegenerate} className={actionClass}>
          重新生成
        </button>
      ) : null}
      {onEdit ? (
        <button type="button" disabled={disabled} onClick={onEdit} className={actionClass}>
          编辑
        </button>
      ) : null}
    </div>
  );
}
