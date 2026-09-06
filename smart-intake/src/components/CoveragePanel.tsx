"use client";
/**
 * NC Tracks direct-eligibility panel for the staff intake page.
 * Reads the saved coverage snapshot on load and offers "Check NC Tracks now".
 * Self-contained (fetches its own state) so it does not couple to the rest of
 * the detail page. Shows clear active / needs-review / not-checked states, and
 * a plain "not connected yet" message while the EDI credentials are absent.
 */
import { useCallback, useEffect, useRef, useState } from "react";

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
  active: "Active at last check",
  inactive: "Needs review",
  needs_review: "Needs review",
  not_checked: "Not checked",
};

export default function CoveragePanel({ intakeId }: { intakeId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [loadError, setLoadError] = useState(false);
  const requestVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const r = await fetch(`/api/intakes/${intakeId}/eligibility`, { cache: "no-store" });
      const body = r.ok ? await r.json() as State : null;
      if (version !== requestVersion.current) return;
      if (body) { setState(body); setLoadError(false); }
      else setLoadError(true);
    } catch { if (version === requestVersion.current) setLoadError(true); }
  }, [intakeId]);
  useEffect(() => {
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { requestVersion.current++; window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  async function check() {
    setBusy(true); setNote("Checking NC Tracks...");
    try {
      const r = await fetch(`/api/intakes/${intakeId}/eligibility`, { method: "POST" });
      const b = await r.json().catch(() => ({}));
      setNote(r.ok ? b.message || "Done." : b.error || "Could not check NC Tracks.");
      if (r.ok && b.snapshot) setState((previous) => previous
        ? { ...previous, snapshot: b.snapshot, message: b.message || "" }
        : null);
      await refresh();
    } catch {
      setNote("The coverage check could not finish. The saved result may be out of date. Try again or verify coverage with NC Tracks.");
    } finally { setBusy(false); }
  }

  if (!state) {
    if (!loadError) return null; // still loading
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <span className="font-semibold">NC Medicaid (NC Tracks):</span> coverage status could not be loaded.{" "}
        <button type="button" className="font-semibold underline" onClick={() => { void refresh(); }}>Try again</button>
      </div>
    );
  }
  const s = state.snapshot;

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-slate-500">NC Medicaid (NC Tracks):</span>
        <span className={`badge ${BADGE[loadError ? "needs_review" : s.status]}`}>
          {loadError ? "Refresh needed" : LABEL[s.status]}
        </span>
        {s.planName && <span className="text-slate-600">{s.planName}</span>}
        {s.memberId && <span className="text-slate-400">MID {s.memberId}</span>}
        {s.effectiveDate && <span className="text-slate-400">since {s.effectiveDate}</span>}
        <span className="grow" />
        {state.configured ? (
          <button className="btn-ghost min-h-11 px-3 py-2 text-xs" disabled={busy || !state.canCheck}
            title={state.canCheck ? "" : "Need the client's name and date of birth first"}
            onClick={() => { void check(); }}>
            {busy ? "Checking..." : s.status === "not_checked" ? "Check NC Tracks now" : "Re-check"}
          </button>
        ) : (
          <span className="text-xs text-slate-400">
        Direct check not connected. Enroll as an NC Tracks Trading Partner, or enter coverage by hand.
          </span>
        )}
      </div>
      {loadError && <p role="alert" className="mt-2 text-amber-800">
        The latest coverage status could not be loaded. Details shown are from the last saved result.{" "}
        <button type="button" className="min-h-11 font-semibold underline" onClick={() => { void refresh(); }}>Reload coverage status</button>
      </p>}
      {s.rejectReason && s.status === "needs_review" && (
        <p className="mt-1 text-xs text-amber-700">{s.rejectReason}</p>
      )}
      {note && <p role="status" className="mt-1 text-xs text-slate-500">{note}</p>}
      {s.checkedAt && (
        <p className="mt-1 text-[11px] text-slate-400">
          Last checked {new Date(s.checkedAt).toLocaleString("en-US")}
        </p>
      )}
    </div>
  );
}
