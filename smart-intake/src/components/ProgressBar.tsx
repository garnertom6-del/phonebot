export default function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  return (
    <div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <p className="mt-1 text-xs font-semibold text-slate-500">{label ?? `You are ${percent}% complete.`}</p>
    </div>
  );
}
