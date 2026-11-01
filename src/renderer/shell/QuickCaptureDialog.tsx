import { useEffect, useState } from 'react';
import { Dialog } from '../ui/Dialog';

type QuickCaptureDialogProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
  disabled?: boolean;
};

export function QuickCaptureDialog({
  open,
  onClose,
  onSubmit,
  disabled = false
}: QuickCaptureDialogProps) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (!open) setText('');
  }, [open]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setText('');
  }

  return (
    <Dialog open={open} onClose={onClose} title="快速记录">
      <textarea
        aria-label="快速记录内容"
        rows={4}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="记一下今天做了什么，或告诉阿咲下一步…"
        className="min-h-[104px] w-full resize-none rounded-xl border-0 bg-[#f5f5f7] px-4 py-3 text-[14px] leading-6 text-[#1d1d1f] outline-none transition-all duration-200 placeholder:text-gray-500 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
      />
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-4 py-2 text-[13px] text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#a1a1a6] dark:hover:bg-white/[0.06]"
        >
          取消
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || disabled}
          className="rounded-full bg-[#0071e3] px-4 py-2 text-[13px] font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100"
        >
          发送给阿咲
        </button>
      </div>
    </Dialog>
  );
}
