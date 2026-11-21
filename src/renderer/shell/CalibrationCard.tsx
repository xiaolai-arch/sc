import type { PracticeAttempt, PracticeConfidence } from '../../shared/practice';
import { calibration } from './calibration';

type CalibrationCardProps = {
  attempts: readonly PracticeAttempt[];
  today: Date;
};

type ConfidencePickerProps = {
  value: PracticeConfidence | undefined;
  disabled?: boolean;
  onChange: (value: PracticeConfidence | undefined) => void;
};

/**
 * Two mutually exclusive marks, neither selected by default: the learner's
 * pre-answer sense of 有把握 / 不确定. Tapping the selected one clears it, so
 * the picker is never a forced answer and an attempt can stay unmarked.
 */
export function ConfidencePicker({ value, disabled, onChange }: ConfidencePickerProps) {
  const options: { key: PracticeConfidence; label: string }[] = [
    { key: 'sure', label: '有把握' },
    { key: 'unsure', label: '不确定' }
  ];
  const base =
    'rounded-full border px-3 py-1 text-[12px] transition-colors duration-200 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30';
  return (
    <div role="group" aria-label="答题前的把握度" className="mt-4 flex items-center gap-2">
      <span className="text-[12px] text-gray-500 dark:text-[#8e8e93]">答题前</span>
      {options.map((option) => {
        const selected = value === option.key;
        return (
          <button
            key={option.key}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(selected ? undefined : option.key)}
            className={`${base} ${
              selected
                ? 'border-[#0071e3]/30 bg-[#0071e3]/10 text-[#0071e3] dark:border-[#0a84ff]/40 dark:bg-[#0a84ff]/15 dark:text-[#4da3ff]'
                : 'border-gray-200/70 bg-white text-gray-500 hover:bg-[#f5f5f7] dark:border-white/10 dark:bg-[#242426] dark:text-[#a1a1a6] dark:hover:bg-white/[0.06]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One honest line about where confidence and correctness disagree. Renders
 * nothing before the first confidence-marked answer — an empty card would only
 * teach the learner to ignore this row.
 */
export function CalibrationCard({ attempts, today }: CalibrationCardProps) {
  const data = calibration(attempts, today);
  if (!data.hasData || data.line === null) return null;

  return (
    <section
      aria-label="把握度校准"
      className="mb-4 rounded-2xl border border-gray-200/70 bg-white px-4 py-3.5 dark:border-white/10 dark:bg-[#1c1c1e]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
          把握度校准
        </h2>
        {data.sureWrong > 0 ? (
          <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">
            自认有把握却答错的，正是要重点练的
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] text-gray-400 dark:text-[#8e8e93]">{data.line}</p>
    </section>
  );
}
