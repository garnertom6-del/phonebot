"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DIRECTORY_RELEASE } from "@/lib/directoryCatalog";
import { INSURANCE_PLAN_DIRECTORY } from "@/lib/insurancePlans";
import { BENEFIT_RESOURCES } from "@/lib/benefitsResources";
import { providerWorkflowHref } from "@/lib/providerWorkflowHref";

type ReviewEvent = { id: number; action: string; ownerName: string; actorName: string; ownerUserId: string; createdAt: string; note: string };
type Stewardship = {
  provider: { id: string; name: string }; version: string;
  assignment: ReviewEvent | null; review: ReviewEvent | null; history: ReviewEvent[];
  permissions: { canAssign: boolean; canReview: boolean };
  members: Array<{ id: string; name: string }>;
  state: { status: string; dueOn: string; hopDueOn: string };
};

export default function PlanBenefitDirectory({ providerId }: { providerId: string }) {
  const [data, setData] = useState<Stewardship | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/provider/directory?providerId=${encodeURIComponent(providerId)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load directory reviews.");
      setData(body);
      setOwnerId(body.assignment?.ownerUserId || "");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load directory reviews."); }
  }, [providerId]);
  useEffect(() => { void load(); }, [load]);

  async function record(action: "assign" | "review") {
    if (busy) return;
    setBusy(true); setNotice(""); setError("");
    try {
      const response = await fetch("/api/provider/directory", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, version: DIRECTORY_RELEASE.version, action, ...(action === "assign" ? { ownerUserId: ownerId } : { note }) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The review record did not save.");
      setNotice(action === "assign" ? "Review owner assigned." : "Provider review recorded.");
      if (action === "review") setNote("");
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The review record did not save. Try again."); }
    finally { setBusy(false); }
  }

  return <main className="mx-auto max-w-6xl p-4 sm:p-6">
    <Link href={providerWorkflowHref("/dashboard", providerId)} className="font-semibold text-brand underline">Back to dashboard</Link>
    <header className="mt-4 rounded-xl bg-slate-900 p-6 text-white">
      <p className="text-sm text-sky-200">Staff reference · {data?.provider.name || "Provider workspace"}</p>
      <h1 className="mt-2 text-3xl font-bold">Plan and benefit directory</h1>
      <p className="mt-3">Official sources for checking plan names and benefit rules. Confirm current enrollment, eligibility and availability with the program.</p>
      <p className="mt-3 text-sm text-slate-200">Version {DIRECTORY_RELEASE.version} · Directory effective {DIRECTORY_RELEASE.effectiveOn} · Sources checked {DIRECTORY_RELEASE.checkedOn}</p>
      <p className="mt-1 text-sm text-slate-200">Responsible role: {DIRECTORY_RELEASE.ownerRole}. Review every 30 days and when rules change; review HOP weekly while restart details are pending.</p>
    </header>

    <section className="mt-5 rounded-xl border bg-white p-5" aria-labelledby="directory-review">
      <h2 id="directory-review" className="text-xl font-bold">Provider review ownership</h2>
      {error && <p role="alert" className="mt-3 text-red-700">{error} <button className="underline" onClick={() => void load()}>Retry loading</button></p>}
      {notice && <p role="status" className="mt-3 text-green-800">{notice}</p>}
      {!data && !error && <p className="mt-3" role="status">Loading review history…</p>}
      {data && <>
        <p className="mt-3 font-semibold">{data.state.status} · Owner: {data.assignment?.ownerName || "Not assigned"}</p>
        <p className="mt-1 text-sm text-slate-600">Latest provider review: {data.review ? `${new Date(data.review.createdAt).toLocaleString()} by ${data.review.actorName}` : "Not recorded"}. Next full review: {data.state.dueOn}; HOP review: {data.state.hopDueOn}.</p>
        {data.permissions.canAssign && <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-1 text-sm font-semibold">Assign an active staff member
            <select className="input mt-1 w-full" value={ownerId} onChange={(event) => setOwnerId(event.target.value)} disabled={busy}>
              <option value="">Select review owner</option>
              {data.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </label>
          <button className="btn-secondary min-h-11" disabled={busy || !ownerId} onClick={() => void record("assign")}>Assign owner</button>
        </div>}
        {data.permissions.canReview && <div className="mt-4">
          <label className="text-sm font-semibold">After checking all listed sources, record findings or needed corrections. Keep client information out of this note.
            <textarea className="input mt-2 min-h-24 w-full" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} disabled={busy} />
          </label>
          <button className="btn-primary mt-2 min-h-11" disabled={busy || !note.trim()} onClick={() => void record("review")}>{busy ? "Saving…" : "Record source review"}</button>
        </div>}
        <p className="mt-3 text-sm text-slate-600">Provider reviews record who checked this published version. They do not change source content, member coverage or referral status.</p>
        {data.history.length > 0 && <details className="mt-4"><summary className="cursor-pointer font-semibold">Recent ownership and review history</summary>
          <ol className="mt-3 space-y-3">{data.history.map((event) => <li key={event.id} className="border-t pt-2 text-sm">
            <p className="font-semibold">{event.action === "ASSIGN" ? "Owner assigned" : "Source review recorded"} · {new Date(event.createdAt).toLocaleString()} · {event.actorName}</p>
            <p>Owner: {event.ownerName}. {event.note}</p>
          </li>)}</ol>
        </details>}
      </>}
    </section>

    <section className="mt-6" aria-labelledby="plan-directory">
      <h2 id="plan-directory" className="text-2xl font-bold">Plan names and legacy records</h2>
      <p className="mt-2 text-sm text-slate-600">Display labels clarify current and historical names. Stored answers, packet mappings and record-number prefixes remain unchanged.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">{INSURANCE_PLAN_DIRECTORY.map((plan) => <article key={plan.id} className="rounded-xl border bg-white p-5">
        <p className="text-xs font-semibold uppercase text-slate-600">{plan.status === "historical" ? "Historical NC Medicaid plan" : plan.status === "verify-product" ? "Verify product" : "Current NC Medicaid roster"} · {plan.category}</p>
        <h3 className="mt-2 text-lg font-bold">{plan.label}</h3>
        <p className="mt-2 text-sm">{plan.note}</p>
        <p className="mt-2 text-xs text-slate-600">Stored label: {plan.storedValue} · Source effective date: {plan.source.effectiveOn || "Not specified"} · Checked {plan.source.checkedOn}</p>
        <a className="mt-3 inline-block py-2 text-sm font-semibold text-brand underline" href={plan.source.url} target="_blank" rel="noopener noreferrer">{plan.source.title}<span className="sr-only"> (opens a new tab)</span></a>
      </article>)}</div>
    </section>

    <section className="mt-6" aria-labelledby="benefit-directory">
      <h2 id="benefit-directory" className="text-2xl font-bold">Benefit source directory</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">{BENEFIT_RESOURCES.map((resource) => <article key={resource.id} className="rounded-xl border bg-white p-5">
        <h3 className="text-lg font-bold">{resource.title}</h3>
        {resource.availability && <p className="mt-2 font-semibold text-amber-900">{resource.availability}</p>}
        <p className="mt-2 text-sm">{resource.why}</p>
        <p className="mt-2 text-sm">{resource.verify}</p>
        <p className="mt-2 text-xs text-slate-600">Source effective date: {resource.sourceEffectiveOn || "Not specified"} · Checked {resource.checkedOn} · Review every {resource.reviewEveryDays} days</p>
        <a className="mt-3 inline-block py-2 text-sm font-semibold text-brand underline" href={resource.url} target="_blank" rel="noopener noreferrer">{resource.source} source<span className="sr-only"> for {resource.title} (opens a new tab)</span></a>
      </article>)}</div>
    </section>
  </main>;
}
