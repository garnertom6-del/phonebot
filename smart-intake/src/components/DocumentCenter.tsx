"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AdobePdfReview from "./AdobePdfReview";
import type { DocumentCenterData, ReviewCorrection, ReviewVersion } from "@/lib/documentReviewTypes";

function versionLabel(v: ReviewVersion) { return `${v.source === "DRAFT" ? "Draft" : `Packet v${v.packetVersion}`} · revision ${v.contentRevision} · ${new Date(v.createdAt).toLocaleString()}`; }
const date = (v: string) => new Date(v).toLocaleString();

export default function DocumentCenter({ intakeId, initialReviewId }: { intakeId: string; initialReviewId?: string }) {
  const [data, setData] = useState<DocumentCenterData | null>(null);
  const [selectedId, setSelectedId] = useState(initialReviewId || "");
  const [packetId, setPacketId] = useState("");
  const [saving, setBusy] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const busy = saving || refreshRequired;
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [page, setPage] = useState("1");
  const [comment, setComment] = useState("");
  const [assignedId, setAssignedId] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const base = `/api/intakes/${intakeId}/document-reviews`;
  const load = useCallback(async () => {
    const response = await fetch(base, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Document reviews could not be loaded.");
    setData(body);
    setRefreshRequired(false);
    setSelectedId(current => body.versions.some((v: ReviewVersion) => v.id === current) ? current : body.versions[0]?.id || "");
    return body as DocumentCenterData;
  }, [base]);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);
  async function mutate(url: string, method: string, body: unknown) {
    if (lock.current || refreshRequired) return null;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The change was not saved.");
      try { await load(); }
      catch {
        setRefreshRequired(true);
        setError("Your change was saved, but the updated details could not be loaded. Reload latest details before making another change.");
      }
      return result;
    } catch (e) { setError(e instanceof Error ? e.message : "The change was not saved. Reload before retrying."); return null; }
    finally { lock.current = false; setBusy(false); }
  }
  async function createCopy() {
    if (!data) return;
    const result = await mutate(base, "POST", { expectedContentRevision: data.contentRevision, ...(packetId ? { sourcePacketId: packetId } : {}) });
    if (result) { setSelectedId(result.id); setPage("1"); setMessage("Review copy saved. The original packet is preserved."); }
  }
  async function addCorrection() {
    const result = await mutate(`${base}/corrections`, "POST", { reviewId: selectedId, page: Number(page), comment, assignedUserId: assignedId });
    if (result) { setComment(""); setMessage("Correction saved and assigned."); }
  }
  const selected = data?.versions.find(v => v.id === selectedId);
  const pending = data?.corrections.filter(c => c.status === "OPEN") || [];
  const notes = data?.corrections.filter(c => c.reviewId === selectedId && (showResolved || c.status === "OPEN")) || [];
  return <main className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-500">Smart Intake · Documents</p><h1 className="text-2xl font-bold">Document Center</h1><Link href="/documents/test" className="text-sm font-semibold text-brand underline">Test Adobe viewer</Link>{data && <p className="mt-1 text-slate-600">{data.clientName}</p>}</div><Link className="btn-ghost" href={`/intakes/${intakeId}`}>Back to intake</Link></div>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900"><p>{error}</p><button disabled={saving} className="btn-ghost mt-2" onClick={() => { void load().then(() => { setError(""); setMessage("Latest details loaded. Check the saved changes before continuing."); }).catch(e => setError(e.message)); }}>Reload latest details</button><p className="mt-2 text-sm">Your unsaved correction text stays here while you reload.</p></div>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-900">{message}</p>}
    {!data && !error && <p role="status">Loading document reviews…</p>}
    {data && <>
      <div className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3"><div><p className="text-sm text-slate-500">Review copies</p><strong>{data.versions.length}</strong></div><div><p className="text-sm text-slate-500">Open corrections across all copies</p><strong>{pending.length}</strong></div><div><p className="text-sm text-slate-500">PDF viewer</p><strong>{data.adobeClientId ? "Adobe configured" : "Standard viewer available"}</strong></div></div>
      {!data.adobeClientId && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Adobe viewer setup is pending. Saved review copies, correction assignments, and version history are available now.</p>}
      <section className="space-y-3 rounded-xl border bg-white p-4" aria-label="Review copies and version history"><h2 className="font-bold">Review copies and version history</h2><p className="text-sm text-slate-600">Save a copy of the current draft or an existing packet before commenting. Each copy keeps its original pages. Resolve corrections in the intake answers, regenerate, then review the new copy.</p>
        {!data.readOnly && <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm font-semibold">Copy source<select className="input mt-1 w-full" value={packetId} onChange={e => setPacketId(e.target.value)} disabled={busy}><option value="">Current draft · revision {data.contentRevision}</option>{data.packets.map(p => <option key={p.id} value={p.id}>Saved packet v{p.packetVersion} · revision {p.contentRevision}</option>)}</select></label><button className="btn-primary" disabled={busy || !!comment.trim()} onClick={() => void createCopy()}>{busy ? "Saving…" : "Save review copy"}</button></div>}
        {data.versions.length > 0 && <label className="block text-sm font-semibold">Saved review copy<select aria-label="Saved review copy" className="input mt-1 w-full" value={selectedId} onChange={e => { setSelectedId(e.target.value); setPage("1"); }} disabled={busy || !!comment.trim()}>{data.versions.map(v => <option key={v.id} value={v.id}>{versionLabel(v)}</option>)}</select>{!!comment.trim() && <span className="text-xs font-normal text-slate-500">Save or clear your correction before changing copies.</span>}</label>}
      </section>
      {pending.some(c => c.reviewId !== selectedId) && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{pending.filter(c => c.reviewId !== selectedId).length} open correction(s) belong to other review copies. Select those copies to review and resolve them.</div>}
      {selected ? <>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">{versionLabel(selected)}</h2><p className="text-sm text-slate-600">Saved by {selected.createdByName} · {selected.pageCount} pages</p>{selected.source === "DRAFT" && <p className="text-sm font-semibold text-amber-800">Draft review copy — not a completed packet.</p>}{selected.fillWarningCount > 0 && <p role="alert" className="text-sm font-semibold text-red-800">{selected.fillWarningCount} field(s) could not be drawn. Review blank fields before completing the packet.</p>}{selected.contentRevision !== data.contentRevision && <p className="text-sm font-semibold text-amber-800">Historical content: current intake revision is {data.contentRevision}.</p>}</div><a className="btn-ghost" href={`${base}/${selected.id}/pdf?download=1`}>Download review copy for Acrobat</a></div>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"><div className="min-w-0"><AdobePdfReview key={selected.id} reviewId={selected.id} src={`${base}/${selected.id}/pdf`} clientId={data.adobeClientId} /><details className="mt-3 text-xs text-slate-500"><summary>File fingerprint</summary><p className="break-all">SHA-256: {selected.sha256}</p></details></div>
          <aside className="space-y-4 rounded-xl border bg-white p-4"><div><h2 className="font-bold">Correction notes</h2><p className="text-sm text-slate-600">Notes refer to this saved copy. Resolving a note records your review; it does not sign or approve the packet.</p></div>
            <Link className="btn-secondary block text-center" href={`/intakes/${intakeId}/review`}>Correct intake answers</Link>
            {!data.readOnly && <form className="space-y-3" onSubmit={e => { e.preventDefault(); void addCorrection(); }}><label className="block text-sm font-semibold">Page number<input className="input mt-1 w-full" type="number" min="1" max={selected.pageCount} required value={page} onChange={e => setPage(e.target.value)} disabled={busy} /></label><label className="block text-sm font-semibold">Correction needed<textarea className="input mt-1 min-h-24 w-full" maxLength={2000} minLength={3} required value={comment} onChange={e => setComment(e.target.value)} disabled={busy} /></label><label className="block text-sm font-semibold">Responsible staff<select className="input mt-1 w-full" required value={assignedId} onChange={e => setAssignedId(e.target.value)} disabled={busy}><option value="">Choose staff</option>{data.staff.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>{!data.staff.length && <p className="text-sm text-amber-800">Add active staff to this provider to assign corrections.</p>}<button className="btn-primary w-full" disabled={busy || !data.staff.length}>Save correction</button></form>}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} />Show resolved corrections</label>
            {notes.length === 0 && <p className="text-sm text-slate-500">No {showResolved ? "" : "open "}corrections on this copy.</p>}
            {notes.map(note => <CorrectionCard key={note.id} note={note} staff={data.staff} readOnly={data.readOnly} busy={busy} save={async body => { const result = await mutate(`${base}/corrections/${note.id}`, "PATCH", { ...body, expectedRevision: note.revision }); if (result) setMessage("Correction updated."); return !!result; }} />)}
          </aside>
        </div>
      </> : <p className="rounded-xl border border-dashed p-8 text-center text-slate-500">Save your first review copy to open the PDF and assign corrections.</p>}
    </>}
  </main>;
}

function CorrectionCard({ note, staff, readOnly, busy, save }: { note: ReviewCorrection; staff: DocumentCenterData["staff"]; readOnly: boolean; busy: boolean; save: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [resolution, setResolution] = useState("");
  const [owner, setOwner] = useState(note.assignedUserId);
  return <article className="space-y-2 rounded-xl border border-slate-200 p-3"><div className="flex justify-between gap-2 text-sm font-bold"><span>Page {note.page}</span><span>{note.status === "OPEN" ? "Open" : "Resolved"}</span></div><p className="whitespace-pre-wrap break-words text-sm">{note.comment}</p><p className="text-xs text-slate-500">{note.createdByName} · {date(note.createdAt)}</p><p className="text-sm">Responsible: {note.assignedName}{!note.ownerActive && <span className="text-amber-800"> · reassignment needed</span>}</p>
    {note.resolutionNote && <p className="whitespace-pre-wrap break-words rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">{note.resolutionNote}<span className="mt-1 block text-xs">{note.resolvedByName} · {note.resolvedAt && date(note.resolvedAt)}</span></p>}
    {!readOnly && <details><summary className="cursor-pointer py-2 text-sm font-semibold">Update correction</summary><div className="space-y-2"><label className="block text-sm">Assign to<select className="input mt-1 w-full" value={owner} onChange={e => setOwner(e.target.value)} disabled={busy}>{!staff.some(u => u.id === note.assignedUserId) && <option value={note.assignedUserId}>{note.assignedName} (inactive)</option>}{staff.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label><button className="btn-ghost w-full text-sm" disabled={busy || owner === note.assignedUserId} onClick={() => void save({ assignedUserId: owner })}>Save assignment</button>{note.status === "OPEN" ? <><label className="block text-sm">What was corrected and verified?<textarea className="input mt-1 w-full" maxLength={2000} value={resolution} onChange={e => setResolution(e.target.value)} disabled={busy} /></label><button className="btn-secondary w-full" disabled={busy || resolution.trim().length < 3} onClick={() => void save({ status: "RESOLVED", resolutionNote: resolution })}>Mark resolved</button></> : <button className="btn-ghost w-full" disabled={busy} onClick={() => void save({ status: "OPEN" })}>Reopen correction</button>}</div></details>}
  </article>;
}
