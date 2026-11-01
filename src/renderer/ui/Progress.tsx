type ProgressProps = {
  value: number;
  max: number;
  label?: string;
  ariaLabel?: string;
};

export function Progress({ value, max, label, ariaLabel }: ProgressProps) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  return (
    <div>
      {label ? (
        <div className="mb-2 flex items-center justify-between gap-4 text-sm text-gray-600 dark:text-[#a1a1a6]">
          <span>{label}</span>
          <span>
            {value} / {max}
          </span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={ariaLabel ?? label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className="h-2 w-full overflow-hidden rounded-full bg-[#e5e5e7] dark:bg-white/10"
      >
        <div
          className="h-full rounded-full bg-[#0071e3] transition-all duration-300 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
