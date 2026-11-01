import { useId, useState } from 'react';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon
} from '../ui/icons';
import type { ChatStep } from './types';

type ReasoningBlockProps = {
  reasoning?: string;
  steps?: ChatStep[];
  streaming?: boolean;
  startedAt?: number;
  endedAt?: number;
};

function durationLabel(startedAt?: number, endedAt?: number): string {
  if (startedAt === undefined) return '思考过程';
  const seconds = Math.max(1, Math.round(((endedAt ?? Date.now()) - startedAt) / 1000));
  return `思考了 ${seconds} 秒`;
}

function StepIcon({ status }: { status: ChatStep['status'] }) {
  if (status === 'running') {
    return (
      <span
        aria-hidden="true"
        className="h-3 w-3 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent"
      />
    );
  }
  if (status === 'done') {
    return <CheckIcon className="h-3 w-3 shrink-0 text-[#34c759]" />;
  }
  return <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff3b30]" />;
}

export function ReasoningBlock({
  reasoning,
  steps,
  streaming,
  startedAt,
  endedAt
}: ReasoningBlockProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const panelId = useId();
  const stepList = steps ?? [];
  const hasReasoning = Boolean(reasoning?.trim());

  if (!hasReasoning && stepList.length === 0) return null;

  const waitingForAnswer = streaming === true && endedAt === undefined;
  const open = userOpen ?? (waitingForAnswer && hasReasoning);
  const header = !hasReasoning
    ? '工作过程'
    : waitingForAnswer
      ? '正在思考…'
      : durationLabel(startedAt, endedAt);

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-black/[0.06] dark:border-white/10 bg-[#f7f7f8] dark:bg-white/[0.06]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setUserOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] text-gray-500 dark:text-[#8e8e93] transition-colors duration-150 hover:text-black dark:hover:text-[#f5f5f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
      >
        {open ? (
          <ChevronDownIcon className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRightIcon className="h-3 w-3 shrink-0" />
        )}
        {waitingForAnswer ? (
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#0071e3]"
          />
        ) : null}
        <span role={waitingForAnswer ? 'status' : undefined}>{header}</span>
      </button>

      {open ? (
        <div
          id={panelId}
          className="max-h-[240px] overflow-y-auto border-t border-black/[0.06] dark:border-white/10 px-3 py-2"
        >
          {hasReasoning ? (
            <p className="whitespace-pre-wrap text-[12px] leading-5 text-gray-600 dark:text-[#a1a1a6]">
              {reasoning}
            </p>
          ) : null}

          {stepList.length > 0 ? (
            <ul className={hasReasoning ? 'mt-2 space-y-1.5' : 'space-y-1.5'}>
              {stepList.map((step) => (
                <li key={step.id} className="flex items-start gap-2 text-[11px] text-gray-600 dark:text-[#a1a1a6]">
                  <span className="mt-0.5 flex h-3 w-3 items-center justify-center">
                    <StepIcon status={step.status} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{step.label}</span>
                    {step.detail ? (
                      <span className="mt-0.5 block text-[10px] text-gray-500 dark:text-[#8e8e93]">
                        {step.detail}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
