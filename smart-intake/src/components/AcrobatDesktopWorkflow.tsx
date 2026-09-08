"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { PreparationData, PreparationFile } from "@/lib/adobePreparationTypes";

export function PreparationTemplateStatus({ file }: { file: PreparationFile }) {
  const template = file.template;
  if (!file.promotedTemplateId) return <p className="text-sm text-slate-600">Next: compare the pages and send the reviewed copy to mapping.</p>;
  if (!template) return <p className="text-sm text-amber-900">The linked template is unavailable. Ask the master administrator to check packet setup.</p>;
  if (template.mappingStatus === "APPROVED") return <p className="text-sm text-emerald-900">Template approved · {template.isActive ? "active" : "not active"}. Packet readiness checks still apply.</p>;
  return <p className="text-sm text-amber-900">Awaiting template review · {template.mappingStatus.replaceAll("_", " ")}. The master administrator must review mapping and the filled preview before approval.</p>;
}

type Props = {
  data: PreparationData;
  sourceId: string;
  onSourceChange: (id: string) => void;
  onReview: (id: string, sourceId: string) => void;
  onSaved: (id: string, sourceId: string) => Promise<void>;
  disabled: boolean;
};

export default function AcrobatDesktopWorkflow({ data, sourceId, onSourceChange, onReview, onSaved, disabled }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const source = data.files.find(f => f.id === sourceId);
  const revisions = data.files.filter(f => f.sourceFileId === sourceId && !f.jobId);
  const base = `/api/providers/${data.providerId}/adobe/files`;
  const locked = disabled || busy;

  async function action(run: () => Promise<void>) {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await run(); }
    catch (e) { setError(e instanceof Error ? e.message : "The Acrobat handoff could not be completed."); }
    finally { lock.current = false; setBusy(false); }
  }

  function resetUpload() {
    setFile(null); setConfirmed(false); setError(""); setNotice("");
    if (input.current) input.current.value = "";
  }

  async function upload() {
    if (!source || !file || !confirmed) return;
    const parentId = source.id;
    const form = new FormData(); form.set("file", file); form.set("confirmedNoClientData", "true");
    const response = await fetch(`${base}/${parentId}/desktop`, { method: "POST", body: form });
    const saved = await response.json();
    if (!response.ok) throw new Error(saved.error || "The revised PDF could not be saved.");
    resetUpload();
    try { await onSaved(saved.id, parentId); }
    catch { setNotice("The revision was saved. Reload history to view it; uploading the same revision again will reuse that saved copy."); return; }
    setNotice(saved.reused ? "This revision is already saved. Its existing copy is selected for comparison." : "Revised PDF saved and linked to its source. Compare the pages below before sending it to mapping.");
  }

  return <section id="acrobat-desktop" aria-labelledby="acrobat-desktop-heading" className="scroll-mt-4 space-y-4 rounded-xl border border-indigo-200 bg-white p-4">
    <div><h2 id="acrobat-desktop-heading" className="text-xl font-bold">Prepare Form & desktop editing</h2><p className="mt-1 text-sm text-slate-600">Download → edit in Acrobat Pro → upload a revised PDF → review and map. This handoff does not send files to Adobe PDF Services or use cloud transactions.</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-sky-50 p-3 text-sm text-sky-950">{notice}</p>}
    <label className="block text-sm font-semibold">Blank PDF to edit
      <select className="input mt-1 w-full" value={sourceId} disabled={locked} onChange={e => { resetUpload(); onSourceChange(e.target.value); }}>
        <option value="">Choose a saved blank PDF</option>
        {data.files.filter(f => f.mimeType === "application/pdf" && !f.inspection.encrypted).map(f => <option key={f.id} value={f.id}>{f.name} · {new Date(f.createdAt).toLocaleString()}</option>)}
      </select>
    </label>
    {!source && <p className="text-sm text-slate-600">Choose a saved PDF, or <a className="font-semibold text-brand underline" href="#adobe-upload-heading">add a blank source below</a>.</p>}
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <div className="space-y-3 rounded-lg bg-slate-50 p-3"><h3 className="font-bold">1. Download a working copy</h3><p className="text-sm text-slate-600">The original remains saved in Smart Intake. On a phone, move the working copy to the computer where Acrobat Pro is installed.</p>{source ? <a className="btn-secondary inline-flex w-full justify-center" href={`${base}/${source.id}?workingCopy=1`} aria-disabled={locked} onClick={e => { if (locked) e.preventDefault(); }}>Download working copy</a> : <button className="btn-secondary w-full" disabled>Download working copy</button>}</div>
      <div className="space-y-3 rounded-lg bg-slate-50 p-3"><h3 className="font-bold">2. Edit in Acrobat Pro</h3><p className="text-sm text-slate-600">Open the downloaded PDF. Use Prepare a form to detect fields, then check field names, types and tab order. Use Edit PDF or other desktop tools for layout changes.</p><p className="text-sm text-slate-600">Save as a new, unsigned PDF without password protection. Keep form fields editable if you want Smart Intake to inspect them.</p><a className="inline-block text-sm font-semibold text-brand underline" href="https://helpx.adobe.com/acrobat/using/pdf-forms.html" target="_blank" rel="noreferrer">Adobe Prepare Form instructions</a></div>
      <div className="space-y-3 rounded-lg bg-slate-50 p-3"><h3 className="font-bold">3. Return the edited PDF</h3>{data.canWrite ? <form className="space-y-3" onSubmit={e => { e.preventDefault(); void action(upload); }}>
        <label className="block text-sm font-semibold">Revised PDF<input ref={input} className="mt-1 block w-full min-w-0 text-sm" type="file" accept=".pdf,application/pdf" required disabled={locked || !source} onChange={e => { setFile(e.target.files?.[0] || null); setConfirmed(false); }} /></label>
        <p className="break-words text-xs text-slate-600">Linked source: {source?.name || "Choose a source first"}</p>
        <label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" required checked={confirmed} disabled={locked || !source} onChange={e => setConfirmed(e.target.checked)} /><span>I checked the revised PDF: it is blank or synthetic, with no client information or signatures.</span></label>
        <button className="btn-primary w-full" disabled={locked || !source || !file || !confirmed}>{busy ? "Working…" : "Upload Acrobat revision"}</button>
      </form> : <p className="text-sm text-slate-600">A provider administrator uploads revised PDFs. You can download and review saved versions.</p>}</div>
    </div>
    {source && <div className="space-y-3"><h3 className="font-bold">Returned versions for this source</h3>{!revisions.length && <p className="text-sm text-slate-600">No revised PDF uploaded yet. The app cannot observe edits made in Acrobat.</p>}{revisions.map(revision => <article className="space-y-2 rounded-lg border p-3" key={revision.id}>
      <p className="break-words font-semibold">{revision.name}</p><p className="text-xs text-slate-500">{new Date(revision.createdAt).toLocaleString()} · {revision.createdByName}</p>
      <p className="text-sm">Pages: {source.pageCount ?? "?"} → {revision.pageCount ?? "?"} · Form fields: {source.inspection.fieldCount ?? "?"} → {revision.inspection.fieldCount ?? "?"}</p>
      <PreparationTemplateStatus file={revision} />
      <button className="btn-ghost" onClick={() => onReview(revision.id, source.id)}>Compare revised PDF with source</button>
      {revision.promotedTemplateId && revision.template && <Link className="btn-ghost ml-2" href={`/admin/pdf-mapping?providerId=${data.providerId}&templateId=${revision.promotedTemplateId}`}>Continue mapping review</Link>}
    </article>)}</div>}
    <p className="text-sm text-slate-600">4. Review the revised pages and field placement, then send the chosen version to the existing mapper as an inactive draft. The master administrator reviews the filled preview and approves the template in packet setup. Smart Intake keeps its existing filling engine and DocuSign workflow.</p>
  </section>;
}
