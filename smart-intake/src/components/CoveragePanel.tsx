"use client";
/**
 * NC Tracks direct-eligibility panel for the staff intake page.
 * Reads the saved coverage snapshot on load and offers "Check NC Tracks now".
 * Self-contained (fetches its own state) so it does not couple to the rest of
 * the detail page. Shows clear active / needs-review / not-checked states, and
 * a plain "not connected yet" message while the EDI credentials are absent.
 */
import { useCallback, useEffect, useState } from "react";

type Status = "active" | "inactive" | "needs_review" | "not_checked";
interface Snapshot {
  status: Status; planName?: string; memberId?: string;
  effectiveDate?: string; rejectReason?: string; checkedAt?: string;
}
interface State {
  configured: boolean; canCheck: boolean; snapshot: Snapshot; message: string;
}

const BADGE: Record<Status, string> = {
  active: "bg-emerald-100 text-emerald-800",
  inactive: "bg-amber-100 text-amber-800",
  needs_review: "bg-amber-100 text-amber-800",
  not_checked: "bg-slate-100 text-slate-600",
};
const LABEL: Record<Status, string> = {
  active: "Coverage active",
  inactive: "Needs review",
  needs_review: "Needs review",
  not_checked: "Not checked",
};

export default function CoveragePanel({ intakeId }: { intakeId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/intakes/${intakeId}/eligibility`);
    if (r.ok) setState(await r.json());
  }, [intakeId]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function check() {
    setBusy(true); setNote("Checking NC Tracks...");
    try {
      const r = await fetch(`/api/intakes/${intakeId}/eligibility`, { method: "POST" });
      const b = await r.json().catch(() => ({}));
      setNote(r.ok ? b.message || "Done." : b.error || "Could not check NC Tracks.");
      await refresh();
    } finally { setBusy(false); }
  }

  if (!state) return null;
  const s = state.snapshot;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-slate-500">NC Medicaid (NC Tracks):</span>
        <span className={`badge ${BADGE[s.status]}`}>{LABEL[s.status]}</span>
        {s.planName && <span className="text-slate-600">{s.planName}</span>}
        {s.memberId && <span className="text-slate-400">MID {s.memberId}</span>}
        {s.effectiveDate && <span className="text-slate-400">since {s.effectiveDate}</span>}
        <span className="grow" />
        {state.configured ? (
          <button className="btn-ghost px-3 py-1 text-xs" disabled={busy || !state.canCheck}
            title={state.canCheck ? "" : "Need the client's name and date of birth first"}
            onClick={() => { void check(); }}>
            {busy ? "Checking..." : s.status === "not_checked" ? "Check NC Tracks now" : "Re-check"}
          </button>
        ) : (
          <span className="text-xs text-slate-400">
            Direct check not connected — enroll as an NC Tracks Trading Partner (see README_NCTRACKS_EDI.md).
          </span>
        )}
      </div>
      {s.rejectReason && s.status === "needs_review" && (
        <p className="mt-1 text-xs text-amber-700">{s.rejectReason}</p>
      )}
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
      {s.checkedAt && (
        <p className="mt-1 text-[11px] text-slate-400">
          Last checked {new Date(s.checkedAt).toLocaleString("en-US")}
        </p>
      )}
    </div>
  );
}
