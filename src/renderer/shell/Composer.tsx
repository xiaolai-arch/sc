import { useState } from 'react';
import {
  ChevronDownIcon,
  LockIcon,
  PlusIcon,
  SendIcon
} from '../ui/icons';

type ComposerProps = {
  modelLabel: string;
  onSend: (text: string) => void;
  disabled?: boolean;
};

export function Composer({ modelLabel, onSend, disabled = false }: ComposerProps) {
  const [text, setText] = useState('');

  function send() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  }

  return (
    <div className="shrink-0 px-4 pb-4 pt-2 md:px-6">
      <div className="mx-auto w-full max-w-[760px] rounded-2xl border border-black/[0.08] bg-white p-3 shadow-sm">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="向管家提问，或说「记一下…」"
          aria-label="向管家提问"
          className="max-h-32 min-h-[44px] w-full resize-none bg-transparent px-1 py-1 text-[13px] leading-5 text-[#1d1d1f] outline-none placeholder:text-gray-500"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="添加附件"
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-black/[0.04] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-gray-500 transition-colors duration-150 hover:bg-black/[0.04] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
            >
              <LockIcon className="h-3.5 w-3.5" />
              计划模式
              <ChevronDownIcon className="h-3 w-3" />
            </button>
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden min-w-0 items-center gap-1.5 text-[11px] text-gray-500 sm:flex">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#34c759]" />
              <span className="truncate">{modelLabel}</span>
            </span>
            <button
              type="button"
              aria-label="发送"
              disabled={!text.trim() || disabled}
              onClick={send}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0071e3] text-white transition-all duration-300 hover:opacity-80 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
