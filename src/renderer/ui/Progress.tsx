type ProgressProps = {
  value: number;
  max: number;
  label?: string;
};

export function Progress({ value, max, label }: ProgressProps) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;

  return (
    <div>
      {label ? (
        <div className="mb-2 flex items-center justify-between gap-4 text-sm text-gray-600">
          <span>{label}</span>
          <span>
            {value} / {max}
          </span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        className="h-2 w-full overflow-hidden rounded-full bg-[#e5e5e7]"
      >
        <div
          className="h-full rounded-full bg-[#0071e3] transition-all duration-300 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
