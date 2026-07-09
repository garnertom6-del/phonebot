export default function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  const safePercent = Math.max(0, Math.min(100, percent));
  return (
    <div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safePercent}
        aria-label={label ?? `You are ${safePercent}% complete.`}
      >
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${safePercent}%` }} />
      </div>
      <p className="mt-1 text-xs font-semibold text-slate-500">{label ?? `You are ${safePercent}% complete.`}</p>
    </div>
  );
}
