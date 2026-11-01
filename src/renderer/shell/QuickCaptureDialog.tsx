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
        placeholder="记一下今天做了什么，或告诉管家下一步…"
        className="min-h-[96px] w-full resize-none rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-[13px] leading-6 text-[#1d1d1f] outline-none placeholder:text-gray-500 focus:border-[#0071e3]/40 focus:ring-2 focus:ring-[#0071e3]/20"
      />
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-3 py-1.5 text-[12px] text-gray-600 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
        >
          取消
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || disabled}
          className="rounded-md bg-[#0071e3] px-3 py-1.5 text-[12px] font-medium text-white disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
        >
          发送给管家
        </button>
      </div>
    </Dialog>
  );
}
