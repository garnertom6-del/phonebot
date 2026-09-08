"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AdobePdfReview from "./AdobePdfReview";
import { ADOBE_OPERATIONS, estimatedAdobeUnits, type AdobeOperation, type PreparationData } from "@/lib/adobePreparationTypes";

const size = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
export default function AdobePreparation({ providerId }: { providerId: string }) {
  const base = `/api/providers/${providerId}/adobe`;
  const [data, setData] = useState<PreparationData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const pollLock = useRef(false);
  const loadSequence = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [uploadConfirmed, setUploadConfirmed] = useState(false);
  const [sourceFileId, setSourceFileId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [addId, setAddId] = useState("");
  const [previewId, setPreviewId] = useState("");
  const [compareId, setCompareId] = useState("");
  const [operation, setOperation] = useState<AdobeOperation>("ocr");
  const [pages, setPages] = useState("");
  const [pageSize, setPageSize] = useState(1);
  const [angle, setAngle] = useState(90);
  const [basePage, setBasePage] = useState(1);
  const [password, setPassword] = useState("");
  const [compression, setCompression] = useState("MEDIUM");
  const [cloudConfirmed, setCloudConfirmed] = useState(false);
  const [providerConfirmed, setProviderConfirmed] = useState(false);
  const [showAllJobs, setShowAllJobs] = useState(false);
  const pendingKey = useRef<string | null>(null);
  const [uncertainRequest, setUncertainRequest] = useState(false);
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const response = await fetch(base, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Preparation workspace could not be loaded.");
    if (sequence === loadSequence.current) setData(body); return body as PreparationData;
  }, [base]);
  useEffect(() => { void load().catch(e => setError(e.message)); }, [load]);
  const activeJobs = data?.jobs.filter(j => ["RUNNING", "SUBMITTING"].includes(j.status)).map(j => j.id).join(",") || "";
  useEffect(() => {
    if (!activeJobs || !data?.canWrite || !data.configured) return;
    let disposed = false;
    const timer = setInterval(() => {
      if (document.hidden || lock.current || pollLock.current || disposed) return;
      pollLock.current = true;
      void (async () => {
        try {
          for (const id of activeJobs.split(",").slice(0, 3)) await fetch(`${base}/jobs/${id}`, { method: "POST" });
          if (!disposed) await load();
        } catch { /* Keep saved state and let the user explicitly refresh after a network interruption. */ }
        finally { pollLock.current = false; }
      })();
    }, 8000);
    return () => { disposed = true; clearInterval(timer); };
  }, [activeJobs, base, data?.canWrite, data?.configured, load]);
  async function action(run: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try { await run(); }
    catch (e) { setError(e instanceof Error ? e.message : "The action could not be completed."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function post(url: string, body?: unknown) {
    const response = await fetch(url, { method: "POST", ...(body instanceof FormData ? { body } : body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "The action was not saved."); return result;
  }
  const inputs = selected.map(id => data?.files.find(f => f.id === id)).filter(f => !!f);
  const totalPages = inputs.reduce((n, f) => n + (f.pageCount || 50), 0);
  const units = estimatedAdobeUnits(operation, totalPages);
  const selectedOperation = ADOBE_OPERATIONS.find(o => o.id === operation)!;
  const preview = data?.files.find(f => f.id === previewId);
  const compare = data?.files.find(f => f.id === compareId);
  const multiple = ["combine", "insert", "replace", "watermark"].includes(operation);
  const toolsDisabled = busy || uncertainRequest;
  function changeSelection(ids: string[]) { setSelected(ids); setCloudConfirmed(false); }
  async function upload() {
    if (!file) return;
    const form = new FormData(); form.set("file", file); form.set("confirmedNoClientData", String(uploadConfirmed)); if (sourceFileId) form.set("sourceFileId", sourceFileId);
    const saved = await post(base, form);
    setFile(null); if (fileInput.current) fileInput.current.value = ""; setUploadConfirmed(false); setSourceFileId("");
    setPreviewId(saved.id); changeSelection([saved.id]); await load(); setMessage("Blank form saved and inspected. Choose an Adobe tool or send the reviewed PDF to mapping.");
  }
  async function start() {
    if (!pendingKey.current) pendingKey.current = crypto.randomUUID();
    setUncertainRequest(true);
    try {
      const response = await fetch(`${base}/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: pendingKey.current, operation, inputIds: selected, options: { pages, pageSize, angle, basePage, password: password || undefined, compression }, confirmedNoClientData: cloudConfirmed, acknowledgedUnits: units }) });
      const result = await response.json();
      if (!response.ok) {
        // Validation failures are known; a lost response keeps the request key for a safe retry.
        if (response.status < 500) { pendingKey.current = null; setUncertainRequest(false); }
        throw new Error(result.error || "The job could not be submitted.");
      }
      pendingKey.current = null; setUncertainRequest(false); setPassword(""); setCloudConfirmed(false);
      await load(); setMessage("Job saved. Status checks retrieve this job's result without submitting it again.");
    } catch (error) { throw error; }
  }
  async function promote() {
    if (!preview) return;
    const result = await post(`${base}/files/${preview.id}/promote`, { confirmedProviderForm: providerConfirmed });
    await load(); setMessage("Prepared copy added as an inactive draft. Open mapping, check the preview, then approve through packet setup.");
    setPreviewId(preview.id); setProviderConfirmed(false); return result;
  }
  return <main className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-500">Smart Intake · {data?.providerName || "Provider documents"}</p><h1 className="text-2xl font-bold">Adobe preparation workspace</h1><p className="mt-1 max-w-3xl text-slate-600">Prepare blank forms, review each result and move the right version into packet mapping.</p></div><Link className="btn-ghost" href={`/dashboard?providerId=${providerId}`}>Back to dashboard</Link></header>
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">{error}</div>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-emerald-900">{message}</p>}
    {!data ? <p role="status">Loading Adobe tools…</p> : <>
      <section className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-3" aria-label="Adobe connection status"><div><p className="text-sm text-slate-500">Cloud PDF tools</p><strong>{data.configured ? "Connected" : "Setup required"}</strong></div><div><p className="text-sm text-slate-500">This month's estimated transactions</p><strong>{data.monthlyEstimatedUnits} / {data.monthlyBudget}</strong><p className="text-xs text-slate-500">App budget, including failed or uncertain jobs. Adobe usage may differ.</p></div><div><p className="text-sm text-slate-500">Source documents</p><strong>Blank forms and synthetic samples</strong><p className="text-xs text-slate-500">Client records stay in Document Center.</p></div></section>
      <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">Cloud tools send the selected file to Adobe PDF Services. Use only blank forms or synthetic samples here. Originals are preserved. Acrobat Pro desktop tools and the PDF Services API have separate access and usage terms.</p>
      {!data.configured && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Adobe cloud credentials are not configured. You can still upload, inspect, preview, download for Acrobat and send a reviewed blank PDF to the existing mapper.</p>}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border bg-white p-4" aria-labelledby="adobe-upload-heading"><h2 id="adobe-upload-heading" className="text-lg font-bold">1. Add a blank form</h2>{data.canWrite && <button className="btn-ghost" disabled={busy} onClick={() => void action(async () => { const saved = await post(base, { action: "create_sample" }); await load(); setPreviewId(saved.id); changeSelection([saved.id]); setMessage("Synthetic sample created and selected. Choose an Adobe tool to try it."); })}>Try with a synthetic sample</button>}<p className="text-sm text-slate-600">Upload a source or a copy edited in Acrobat. PDF, DOCX, XLSX, PPTX, TXT, PNG or JPEG; up to 25 MB and 100 PDF pages.</p>
          {data.canWrite ? <form className="space-y-3" onSubmit={e => { e.preventDefault(); void action(upload); }}><label className="block text-sm font-semibold">Source file<input ref={fileInput} className="mt-1 block w-full min-w-0 text-sm" type="file" accept=".pdf,.docx,.xlsx,.pptx,.txt,.png,.jpg,.jpeg" required disabled={busy} onChange={e => { setFile(e.target.files?.[0] || null); setUploadConfirmed(false); }} /></label><label className="block text-sm font-semibold">Edited version of (optional)<select className="input mt-1 w-full" value={sourceFileId} onChange={e => setSourceFileId(e.target.value)} disabled={busy}><option value="">New original source</option>{data.files.map(f => <option key={f.id} value={f.id}>{f.name} · {new Date(f.createdAt).toLocaleString()}</option>)}</select></label><label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={uploadConfirmed} onChange={e => setUploadConfirmed(e.target.checked)} disabled={busy} required /><span>I checked this file: it is a blank form or synthetic sample with no client information or signatures.</span></label><button className="btn-primary w-full sm:w-auto" disabled={busy || !file || !uploadConfirmed}>Save and inspect source</button></form> : <p className="text-sm text-slate-600">A provider administrator can upload and prepare forms. You can review saved results.</p>}
        </section>
        <section className="space-y-3 rounded-xl border bg-white p-4" aria-labelledby="adobe-operation-heading"><h2 id="adobe-operation-heading" className="text-lg font-bold">2. Run an Adobe tool</h2><label className="block text-sm font-semibold">Preparation tool<select className="input mt-1 w-full" value={operation} disabled={toolsDisabled || !data.canWrite} onChange={e => { setOperation(e.target.value as AdobeOperation); setCloudConfirmed(false); }}>{[...new Set(ADOBE_OPERATIONS.map(o => o.group))].map(group => <optgroup key={group} label={group}>{ADOBE_OPERATIONS.filter(o => o.group === group).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup>)}</select></label><p className="text-sm text-slate-600">{selectedOperation.description}</p>
          <div className="flex items-end gap-2"><label className="min-w-0 flex-1 text-sm font-semibold">Add source in order<select className="input mt-1 w-full" value={addId} disabled={toolsDisabled || !data.canWrite} onChange={e => setAddId(e.target.value)}><option value="">Choose a saved file</option>{data.files.filter(f => !selected.includes(f.id)).map(f => <option key={f.id} value={f.id}>{f.name} · {f.pageCount || "?"} pages</option>)}</select></label><button className="btn-ghost" disabled={toolsDisabled || !addId || !data.canWrite} onClick={() => { changeSelection(multiple ? [...selected, addId].slice(0, 5) : [addId]); setAddId(""); }}>Add</button></div>
          <ol className="space-y-2">{inputs.map((f, i) => <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2 text-sm"><span className="min-w-0 flex-1 break-words">{i + 1}. {f.name} · {f.pageCount || "Unknown"} pages</span><button className="btn-ghost px-2 py-1 text-xs" disabled={toolsDisabled || i === 0} aria-label={`Move ${f.name} earlier`} onClick={() => { const next = [...selected]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; changeSelection(next); }}>Move up</button><button className="btn-ghost px-2 py-1 text-xs" disabled={toolsDisabled} aria-label={`Remove ${f.name} from selection`} onClick={() => changeSelection(selected.filter(id => id !== f.id))}>Remove</button></li>)}</ol>
          {multiple && <p className="text-xs text-slate-600">{operation === "combine" ? "Select 2–5 PDFs." : "Select exactly 2 PDFs. The first is the base document."}</p>}
          {["rotate", "reorder", "delete"].includes(operation) && <label className="block text-sm font-semibold">Pages {operation === "reorder" ? "in the new order" : "to change"}<input className="input mt-1 w-full" value={pages} onChange={e => setPages(e.target.value)} disabled={toolsDisabled} placeholder={operation === "reorder" ? "3,1,2 (include every page)" : "1,3-5 (blank means all pages)"} /></label>}
          {operation === "split" && <label className="block text-sm font-semibold">Pages in each output<input className="input mt-1 w-full" type="number" min="1" max="100" value={pageSize} disabled={toolsDisabled} onChange={e => setPageSize(Number(e.target.value))} /></label>}
          {operation === "rotate" && <label className="block text-sm font-semibold">Clockwise rotation<select className="input mt-1 w-full" value={angle} disabled={toolsDisabled} onChange={e => setAngle(Number(e.target.value))}><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label>}
          {["insert", "replace"].includes(operation) && <label className="block text-sm font-semibold">{operation === "insert" ? "Insert before page" : "Replace starting at page"}<input className="input mt-1 w-full" type="number" min="1" max="101" value={basePage} disabled={toolsDisabled} onChange={e => setBasePage(Number(e.target.value))} /></label>}
          {operation === "compress" && <label className="block text-sm font-semibold">Compression<select className="input mt-1 w-full" value={compression} disabled={toolsDisabled} onChange={e => setCompression(e.target.value)}><option value="LOW">Low · preserve more detail</option><option value="MEDIUM">Medium</option><option value="HIGH">High · smaller copy</option></select></label>}
          {["protect", "unprotect"].includes(operation) && <label className="block text-sm font-semibold">{operation === "protect" ? "New document password" : "Existing document password"}<input className="input mt-1 w-full" type="password" autoComplete="new-password" maxLength={128} value={password} disabled={toolsDisabled} onChange={e => setPassword(e.target.value)} /><span className="text-xs font-normal text-slate-500">Used for this request only; not saved by Smart Intake. Removing protection requires the owner's permission.</span></label>}
          <p className="font-semibold">Estimated usage: {units} Adobe transaction{units === 1 ? "" : "s"}</p>{operation === "create" && <p className="text-xs text-slate-500">Unknown page counts are estimated as 50 pages. Actual Adobe usage depends on the converted output.</p>}
          {data.canWrite && <><label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={cloudConfirmed} disabled={toolsDisabled} onChange={e => setCloudConfirmed(e.target.checked)} /><span>Send these blank or synthetic files to Adobe and use the estimated transactions shown above.</span></label><button className="btn-primary w-full" disabled={toolsDisabled || !data.configured || !selected.length || !cloudConfirmed} onClick={() => void action(start)}>Run Adobe tool</button></>}
          {uncertainRequest && <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950"><p>The response was interrupted. Keep these options unchanged and check the same request to avoid duplicate processing.</p><button className="btn-ghost mt-2" disabled={busy} onClick={() => void action(start)}>Check the same request</button></div>}
        </section>
      </div>
      <section className="space-y-3 rounded-xl border bg-white p-4" aria-labelledby="adobe-history-heading"><div className="flex flex-wrap items-center justify-between gap-2"><h2 id="adobe-history-heading" className="text-lg font-bold">Processing history</h2><button className="btn-ghost" disabled={busy} onClick={() => void action(async () => { await load(); setMessage("Saved files and job history refreshed."); })}>Reload history</button></div>{!data.jobs.length && <p className="text-sm text-slate-500">No Adobe jobs yet. Uploading and local inspection do not use Adobe transactions.</p>}<div className="space-y-2">{data.jobs.slice(0, showAllJobs ? data.jobs.length : 5).map(job => <article key={job.id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{ADOBE_OPERATIONS.find(o => o.id === job.operation)?.label || job.operation}</strong><p className="text-xs text-slate-500">{new Date(job.createdAt).toLocaleString()} · {job.createdByName} · estimated {job.estimatedUnits} transactions</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${job.status === "DONE" ? "bg-emerald-100 text-emerald-900" : job.status === "RUNNING" ? "bg-sky-100 text-sky-900" : "bg-amber-100 text-amber-900"}`}>{job.status.replaceAll("_", " ")}</span></div>{job.message && <p className="mt-2 text-sm">{job.message}</p>}{job.status === "SUBMITTING" && <p className="mt-2 text-sm text-amber-900">Uploading or awaiting Adobe confirmation. Do not create a duplicate request if this remains unchanged.</p>}{job.cleanupPending && <p className="mt-1 text-xs text-slate-600">Adobe temporary assets await cleanup. Completed jobs request deletion; Adobe normally expires assets after 24 hours.</p>}<div className="mt-2 flex flex-wrap gap-2">{data.files.filter(f => f.jobId === job.id).map(f => <button key={f.id} className="btn-ghost px-3 py-1.5 text-sm" onClick={() => { setPreviewId(f.id); setProviderConfirmed(false); document.getElementById("adobe-review-heading")?.scrollIntoView({ behavior: "smooth" }); }}>Review {f.name}</button>)}{data.canWrite && data.configured && (job.status !== "DONE" || job.cleanupPending) && <button className="btn-ghost px-3 py-1.5 text-sm" disabled={busy} onClick={() => void action(async () => { await post(`${base}/jobs/${job.id}`); await load(); })}>Check status / cleanup</button>}</div></article>)}</div>{data.jobs.length > 5 && <button className="btn-ghost" onClick={() => setShowAllJobs(v => !v)}>{showAllJobs ? "Show recent jobs" : `Show all ${data.jobs.length} jobs`}</button>}</section>
      <section className="space-y-4 rounded-xl border bg-white p-4" aria-labelledby="adobe-review-heading"><h2 id="adobe-review-heading" className="text-lg font-bold">3. Review originals and prepared copies</h2><label className="block text-sm font-semibold">Saved file<select className="input mt-1 w-full" value={previewId} onChange={e => { setPreviewId(e.target.value); setProviderConfirmed(false); }}><option value="">Choose a saved file</option>{data.files.map(f => <option key={f.id} value={f.id}>{f.name} · {new Date(f.createdAt).toLocaleString()}</option>)}</select></label>
        {preview && <><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold break-all">{preview.name}</p><p className="text-sm text-slate-600">{preview.pageCount || "Unknown"} pages · {size(preview.byteCount)} · {preview.inspection.fieldCount ?? "Unknown"} PDF form fields</p>{preview.inspection.warnings?.map(w => <p key={w} className="text-sm text-amber-900">{w}</p>)}</div><a className="btn-ghost" href={`${base}/files/${preview.id}?download=1`}>Download / open in Acrobat</a></div>
          <details className="text-xs text-slate-600"><summary>Source and form inspection</summary><p className="mt-2 break-all">SHA-256: {preview.sha256}</p><p>Original: {preview.sourceFileId ? data.files.find(f => f.id === preview.sourceFileId)?.name || preview.sourceFileId : "Uploaded original"}</p><p className="break-words">Fields: {preview.inspection.fields?.join(", ") || "None detected / unavailable"}</p></details>
          {preview.mimeType === "application/pdf" && !preview.inspection.encrypted ? <><label className="block text-sm font-semibold">Compare alongside (optional)<select className="input mt-1 w-full" value={compareId} onChange={e => setCompareId(e.target.value)}><option value="">Single document</option>{data.files.filter(f => f.id !== preview.id && f.mimeType === "application/pdf" && !f.inspection.encrypted).map(f => <option key={f.id} value={f.id}>{f.name} · {new Date(f.createdAt).toLocaleString()}</option>)}</select></label><div className={`grid gap-4 ${compare && compare.id !== preview.id ? "xl:grid-cols-2" : ""}`}><div className="min-w-0"><p className="mb-2 text-sm font-semibold">Selected copy</p><AdobePdfReview purpose="preparation" key={preview.id} reviewId={preview.id} src={`${base}/files/${preview.id}`} clientId={data.adobeClientId} /></div>{compare && compare.id !== preview.id && <div className="min-w-0"><p className="mb-2 text-sm font-semibold">Comparison: {compare.name}</p><AdobePdfReview purpose="preparation" key={compare.id} reviewId={compare.id} src={`${base}/files/${compare.id}`} clientId={data.adobeClientId} /></div>}</div></> : <p className="rounded-lg bg-slate-50 p-4 text-sm">Download this {preview.inspection.encrypted ? "password-protected PDF" : "report or converted document"} to review it in the appropriate desktop application.</p>}
          {data.canWrite && <button className="btn-secondary" disabled={toolsDisabled} onClick={() => { changeSelection([preview.id]); setMessage("This saved file is selected for the next Adobe tool."); }}>Use this copy for another tool</button>}
          <div className="space-y-3 border-t pt-4"><h2 className="text-lg font-bold">4. Map and approve the provider template</h2><p className="text-sm text-slate-600">Preparation does not verify provider identity, consent wording or answer placement. Send the reviewed blank PDF to the existing mapper, run mapping, inspect the filled preview and approve it in packet setup.</p>{preview.promotedTemplateId ? <Link className="btn-primary inline-flex" href={`/admin/pdf-mapping?providerId=${providerId}&templateId=${preview.promotedTemplateId}`}>Open this template in mapping</Link> : data.canWrite && preview.mimeType === "application/pdf" && !preview.inspection.encrypted && <><label className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={providerConfirmed} disabled={busy} onChange={e => setProviderConfirmed(e.target.checked)} /><span>I reviewed this copy and verified it is the correct blank form for {data.providerName}.</span></label><button className="btn-primary" disabled={busy || !providerConfirmed} onClick={() => void action(promote)}>Send reviewed copy to mapping</button></>}<Link className="btn-ghost ml-0 inline-flex sm:ml-3" href={data.isMaster ? `/master/dashboard?providerId=${providerId}#provider-packet-setup` : `/provider/settings?providerId=${providerId}`}>Open packet setup</Link></div>
        </>}
      </section>
      <section className="space-y-3 rounded-xl border bg-white p-4"><h2 className="text-lg font-bold">Acrobat Pro desktop workflow</h2><p className="text-sm text-slate-600">For Edit PDF, automatic Prepare Form field detection, detailed redaction, document comparison, advanced print production and desktop accessibility repair: download the blank form, open it in Acrobat Pro, save a new PDF and upload it above as an edited version of the original.</p><p className="text-sm text-slate-600">This page integrates Adobe's available PDF Services operations. It does not embed the full Acrobat Pro desktop app, Acrobat AI Assistant or desktop plug-ins. Smart Intake continues to use its existing answer-filling engine and DocuSign signing workflow.</p><div className="flex flex-wrap gap-3 text-sm font-semibold"><a className="text-brand underline" href="https://helpx.adobe.com/acrobat/using/pdf-forms.html" target="_blank" rel="noreferrer">Adobe Prepare Form guide</a><a className="text-brand underline" href="https://developer.adobe.com/document-services/pricing/" target="_blank" rel="noreferrer">Adobe API usage and pricing</a><a className="text-brand underline" href="https://www.adobe.com/trust/compliance/compliance-list.html" target="_blank" rel="noreferrer">Adobe service compliance information</a></div></section>
    </>}
  </main>;
}
