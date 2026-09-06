"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BENEFIT_NEEDS, BENEFIT_RESOURCES } from "@/lib/benefitsResources";
import {
  activeReferralPermission, SUPPORT_REFERRAL_LABELS, SUPPORT_REFERRAL_STATUSES,
  type ReferralStaff, type SupportReferralPatch, type SupportReferralStatus, type SupportReferralView,
} from "@/lib/supportReferralTypes";

function localDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function shownDate(value: string | null) { return value ? new Date(value).toLocaleString() : "Not recorded"; }
function isoDate(value: string, label: string) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new Error(`Enter a valid ${label}.`);
  return date.toISOString();
}

export default function ReferralTracker({ intakeId, readOnly = false }: { intakeId: string; readOnly?: boolean }) {
  const [referrals, setReferrals] = useState<SupportReferralView[]>([]);
  const [staff, setStaff] = useState<ReferralStaff[]>([]);
  const [serverReadOnly, setServerReadOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [category, setCategory] = useState("");
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const loadGeneration = useRef(0);
  const locked = readOnly || serverReadOnly;
  const resource = BENEFIT_RESOURCES.find((item) => item.id === resourceId);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/intakes/${intakeId}/support-referrals`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Referral tracking could not be loaded.");
      if (generation !== loadGeneration.current) return;
      setReferrals(body.referrals || []);
      setStaff(body.staff || []);
      setServerReadOnly(!!body.readOnly);
    } catch (problem) {
      if (generation === loadGeneration.current) setError(problem instanceof Error ? problem.message : "Check your connection and reload referrals.");
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [intakeId]);
  useEffect(() => { void load(); return () => { loadGeneration.current += 1; }; }, [load]);

  async function addSuggestion(event: React.FormEvent) {
    event.preventDefault();
    if (creatingRef.current || locked) return;
    creatingRef.current = true;
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/intakes/${intakeId}/support-referrals`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resourceId, category }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Suggestion could not be saved. Reload before retrying.");
      setReferrals((current) => [...current.filter((item) => item.id !== body.referral.id), body.referral]);
      setResourceId("");
      setCategory("");
      setNotice("Suggestion saved. Confirm the client's permission before progressing or contacting a resource.");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Save could not be confirmed. Reload referrals before retrying.");
    } finally { creatingRef.current = false; setCreating(false); }
  }

  return (
    <section className="card mt-5 min-w-0" aria-labelledby={`referrals-heading-${intakeId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={`referrals-heading-${intakeId}`} className="text-xl font-bold">Benefits & support follow-up</h2>
          <p className="mt-1 text-sm text-slate-600">Track the client's choices, assigned staff, actual contact and confirmed assistance. An approval alone does not confirm receipt of help.</p>
        </div>
        <button type="button" className="btn-ghost text-sm" disabled={loading || creating} onClick={() => void load()}>Reload referrals</button>
      </div>
      <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">Source links provide information only. This tracker does not send messages or submit applications.</p>
      {loading && <p className="mt-3 text-sm" role="status">Loading referrals...</p>}
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {notice && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{notice}</p>}
      {locked && !loading && <p className="mt-3 text-sm text-slate-600">Referral records are read-only for this account.</p>}
      {!locked && (
        <form onSubmit={addSuggestion} className="mt-4 rounded-xl border border-slate-200 p-4">
          <fieldset disabled={creating || loading} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <legend className="mb-2 font-semibold">Add a suggested resource</legend>
            <label><span className="label">Resource</span>
              <select className="input min-h-11" required value={resourceId} onChange={(event) => {
                const selected = BENEFIT_RESOURCES.find((item) => item.id === event.target.value);
                setResourceId(event.target.value); setCategory(selected?.needs[0] || "");
              }}>
                <option value="">Choose a resource</option>
                {BENEFIT_RESOURCES.map((item) => <option key={item.id} value={item.id} disabled={referrals.some((referral) => referral.resourceId === item.id)}>{item.title}{referrals.some((referral) => referral.resourceId === item.id) ? " (already tracked)" : ""}</option>)}
              </select>
            </label>
            <label><span className="label">Support topic</span>
              <select className="input min-h-11" required value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">Choose a topic</option>
                {BENEFIT_NEEDS.filter((need) => resource?.needs.some((item) => item === need.id)).map((need) => <option key={need.id} value={need.id}>{need.label}</option>)}
              </select>
            </label>
            {resource && <p className="text-sm text-slate-600 sm:col-span-2">{resource.verify} <a className="font-semibold text-brand underline" href={resource.url} target="_blank" rel="noreferrer">Open official information</a></p>}
            <button type="submit" className="btn-primary sm:col-span-2" disabled={!resourceId || !category}>{creating ? "Saving suggestion..." : "Add as suggested"}</button>
          </fieldset>
        </form>
      )}
      {!loading && !referrals.length && !error && <p className="mt-4 text-sm text-slate-500">No support referrals have been recorded for this intake.</p>}
      <div className="mt-4 space-y-4">
        {referrals.map((referral) => <ReferralEditor key={`${referral.id}:${referral.revision}`} referral={referral} staff={staff} readOnly={locked} onSaved={(saved) => {
          setReferrals((current) => current.map((item) => item.id === saved.id ? saved : item));
          setNotice("Referral updated. The change is recorded in its history.");
        }} onReload={load} />)}
      </div>
    </section>
  );
}

function ReferralEditor({ referral, staff, readOnly, onSaved, onReload }: {
  referral: SupportReferralView; staff: ReferralStaff[]; readOnly: boolean;
  onSaved: (saved: SupportReferralView) => void; onReload: () => Promise<void>;
}) {
  const [status, setStatus] = useState(referral.status);
  const [assignedUserId, setAssignedUserId] = useState(referral.assignedUserId || "");


  const [confirmedAssistanceAt, setConfirmedAssistanceAt] = useState("");
  const [permissionAction, setPermissionAction] = useState<"" | "GRANT" | "WITHDRAW">("");

  const [permissionSource, setPermissionSource] = useState<"CLIENT" | "LEGAL_REPRESENTATIVE">("CLIENT");
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const permitted = activeReferralPermission(referral);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const dateFields = new FormData(event.currentTarget as HTMLFormElement);
    const nextContactValue = String(dateFields.get("nextContactAt") || "");
    const permissionValue = String(dateFields.get("permissionAt") || "");
    const contactedValue = String(dateFields.get("contactedAt") || "");
    const assistanceValue = String(dateFields.get("confirmedAssistanceAt") || "");
    if (busyRef.current || readOnly || conflict) return;
    if (permissionAction === "GRANT" && !permissionConfirmed) { setError("Confirm that the client or legal representative explicitly gave permission for this resource."); return; }
    busyRef.current = true; setBusy(true); setError("");
    try {
      const patch: SupportReferralPatch = { expectedRevision: referral.revision };
      if (status !== referral.status) patch.status = status;
      if (assignedUserId !== (referral.assignedUserId || "")) patch.assignedUserId = assignedUserId || null;
      if (nextContactValue !== localDate(referral.nextContactAt)) patch.nextContactAt = nextContactValue ? isoDate(nextContactValue, "next contact date and time") : null;
      if (permissionAction) {
        patch.permissionAction = permissionAction;
        patch.permissionAt = isoDate(permissionValue, "permission decision date and time");
        if (permissionAction === "GRANT") { patch.permissionSource = permissionSource; patch.permissionConfirmed = permissionConfirmed; }
      }
      if (contactedValue) patch.contactedAt = isoDate(contactedValue, "actual contact date and time");
      if (assistanceValue) patch.confirmedAssistanceAt = isoDate(assistanceValue, "confirmed assistance date and time");
      if (note.trim()) patch.note = note.trim();
      const response = await fetch(`/api/intakes/${referral.intakeId}/support-referrals/${referral.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const body = await response.json();
      if (!response.ok) {
        setConflict(response.status === 409);
        throw new Error(body.error || "The update was not saved.");
      }
      onSaved(body.referral);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The update could not be confirmed. Reload before retrying.");
    } finally { busyRef.current = false; setBusy(false); }
  }

  return (
    <article className="min-w-0 rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-bold">{referral.resourceName}</h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold">{SUPPORT_REFERRAL_LABELS[referral.status]}</span>
      </div>
      <a className="mt-2 inline-block text-sm font-semibold text-brand underline" href={referral.resourceUrl} target="_blank" rel="noreferrer">Open source information</a>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold">Assigned staff</dt><dd>{referral.assignedUser?.name || "Unassigned"}</dd></div>
        <div><dt className="font-semibold">Next contact</dt><dd>{shownDate(referral.nextContactAt)}</dd></div>
        <div><dt className="font-semibold">Client permission</dt><dd>{permitted ? `Recorded ${shownDate(referral.permissionGrantedAt)}` : referral.permissionWithdrawnAt ? `Withdrawn ${shownDate(referral.permissionWithdrawnAt)}` : "Not recorded"}</dd></div>
        <div><dt className="font-semibold">Actual contact</dt><dd>{shownDate(referral.contactedAt)}</dd></div>
        <div className="sm:col-span-2"><dt className="font-semibold">Receipt of assistance confirmed</dt><dd>{shownDate(referral.confirmedAssistanceAt)}{!referral.confirmedAssistanceAt && referral.status === "APPROVED" ? " — approval alone is not receipt" : ""}</dd></div>
      </dl>
      {!readOnly && <details className="mt-4">
        <summary className="cursor-pointer font-semibold text-brand">Update referral</summary>
        <form onSubmit={save} className="mt-3">
          <fieldset disabled={busy || conflict} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label><span className="label">Status</span><select className="input min-h-11" value={status} onChange={(event) => setStatus(event.target.value as SupportReferralStatus)}>{SUPPORT_REFERRAL_STATUSES.map((item) => <option key={item} value={item}>{SUPPORT_REFERRAL_LABELS[item]}</option>)}</select></label>
            <label><span className="label">Assigned staff</span><select className="input min-h-11" value={assignedUserId} onChange={(event) => setAssignedUserId(event.target.value)}><option value="">Unassigned</option>{referral.assignedUserId && !staff.some((item) => item.id === referral.assignedUserId) && <option value={referral.assignedUserId}>{referral.assignedUser?.name || "Former staff"} (inactive — reassign)</option>}{staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label><span className="label">Next contact date and time</span><input className="input min-h-11" type="datetime-local" name="nextContactAt" defaultValue={localDate(referral.nextContactAt)} /></label>
            <label><span className="label">Permission action</span><select className="input min-h-11" value={permissionAction} onChange={(event) => { setPermissionAction(event.target.value as typeof permissionAction); setPermissionConfirmed(false); }}><option value="">No permission change</option><option value="GRANT">Record explicit permission</option><option value="WITHDRAW">Record withdrawal</option></select></label>
            {permissionAction && <>
              <label><span className="label">When the decision was confirmed</span><input className="input min-h-11" type="datetime-local" name="permissionAt" required defaultValue="" /></label>
              {permissionAction === "GRANT" && <label><span className="label">Who gave permission?</span><select className="input min-h-11" value={permissionSource} onChange={(event) => setPermissionSource(event.target.value as typeof permissionSource)}><option value="CLIENT">Client</option><option value="LEGAL_REPRESENTATIVE">Legal representative</option></select></label>}
              {permissionAction === "GRANT" ? <label className="flex items-start gap-3 rounded-lg bg-amber-50 p-3 text-sm sm:col-span-2"><input className="mt-1 h-4 w-4" type="checkbox" required checked={permissionConfirmed} onChange={(event) => setPermissionConfirmed(event.target.checked)} /><span>I confirmed explicit permission to help with and contact this specific resource. I will document how below.</span></label> : <p className="rounded-lg bg-amber-50 p-3 text-sm sm:col-span-2">Withdrawal records Declined and clears the next contact date. Earlier contact and assistance history stays preserved.</p>}
            </>}
            <label><span className="label">Record actual contact date</span><input className="input min-h-11" type="datetime-local" name="contactedAt" defaultValue="" /><span className="text-xs text-slate-500">Enter only after actual contact, not after opening a link.</span></label>
            <label><span className="label">Confirm actual receipt of assistance</span><input className="input min-h-11" type="datetime-local" name="confirmedAssistanceAt" defaultValue="" onChange={(event) => setConfirmedAssistanceAt(event.target.value)} /><span className="text-xs text-slate-500">Enter the verified receipt date and explain the confirmation below.</span></label>
            <label className="sm:col-span-2"><span className="label">Decision or outcome note</span><textarea className="input min-h-24" maxLength={2000} required={!!permissionAction || !!confirmedAssistanceAt} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record the confirmed decision or outcome and how it was verified." /></label>
            <button type="submit" className="btn-primary sm:col-span-2">{busy ? "Saving..." : "Save referral update"}</button>
          </fieldset>
          {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
          {conflict && <button type="button" className="btn-ghost mt-3 text-sm" onClick={() => void onReload()}>Reload latest details and discard these unsaved edits</button>}
        </form>
      </details>}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold">Recorded history ({referral.events.length})</summary>
        <ol className="mt-3 space-y-3 border-l-2 border-slate-200 pl-4 text-sm">
          {referral.events.map((event) => {
            let note = "";
            try { const details = JSON.parse(event.detailsJson); note = typeof details.note === "string" ? details.note : ""; } catch { /* historical event has no display note */ }
            return <li key={event.id}><p className="font-semibold">{SUPPORT_REFERRAL_LABELS[event.toStatus as SupportReferralStatus] || event.toStatus} · {event.kind.replaceAll("_", " ").toLowerCase()}</p><p className="text-xs text-slate-500">{new Date(event.occurredAt).toLocaleString()} · {event.actorUser.name} · revision {event.revision}</p>{note && <p className="mt-1 whitespace-pre-wrap break-words">{note}</p>}</li>;
          })}
        </ol>
      </details>
    </article>
  );
}
