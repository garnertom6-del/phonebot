"use client";
/**
 * Admin PDF field mapper: renders packet pages with pdfjs, overlays the saved
 * coordinate map, and lets staff add, move, resize, delete, and save fields.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { SECTIONS } from "@/config/mooreDivineQuestions";

interface Field {
  page: number; fieldKey: string; source: string; type: string;
  x: number; y: number; width: number; height: number;
  fontSize: number; lines: number; lineHeight: number;
  required: boolean; role: string; consentKey: string | null; notes: string;
  flowLines?: number; startLine?: number; deleted?: boolean;
}

interface MappingHealth {
  ready: boolean;
  score: number;
  blockingIssues: string[];
  warnings: string[];
  counts: { fields: number; text: number; checkboxes: number; signatures: number; pagesWithFields: number };
}

const TYPES = ["text", "checkbox", "signature", "signature_small", "initials", "survey_rating"];
const ROLES = ["client", "guardian", "staff", "clinician", "medicalDirector", "witness", "auto"];
const SOURCE_OPTIONS = Array.from(new Set([
  ...SECTIONS.flatMap((section) => section.questions.map((q) => q.key)),
  "signature",
  "guardian_signature",
  "staff_signature",
  "clinician_signature",
  "medical_director_signature",
  "sign_date",
  "staff_sign_date",
  "clinician_sign_date",
  "medical_director_sign_date",
])).sort();

function queryString(providerId?: string, templateId?: string) {
  const params = new URLSearchParams();
  if (providerId) params.set("providerId", providerId);
  if (templateId) params.set("templateId", templateId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export default function PdfFieldMapper({ providerId, templateId }: { providerId?: string; templateId?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(43);
  const [pageSize, setPageSize] = useState({ w: 612, h: 792 });
  const [scale, setScale] = useState(1.2);
  const [fields, setFields] = useState<Field[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [deletedFields, setDeletedFields] = useState<Field[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [testFill, setTestFill] = useState(false);
  const [templateName, setTemplateName] = useState("Moore Divine Care Client Intake Package");
  const [providerSpecific, setProviderSpecific] = useState(false);
  const [mappingStatus, setMappingStatus] = useState("APPROVED");
  const [health, setHealth] = useState<MappingHealth | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<Field[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [replaceMappingOnSave, setReplaceMappingOnSave] = useState(false);
  const pdfRef = useRef<unknown>(null);
  const dragRef = useRef<{ key: string; startX: number; startY: number; ox: number; oy: number; resize: boolean } | null>(null);
  const qs = queryString(providerId, templateId);

  useEffect(() => {
    setNote("");
    setSelected(null);
    setDirty(new Set());
    setDeletedFields([]);
    setHealth(null);
    setAiSuggestions([]);
    setStatusError("");
    setReplaceMappingOnSave(false);
    fetch(`/api/mapping${qs}`).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Mapping could not be loaded");
      setFields(d.fields || []);
      setPageCount(d.pageCount);
      setPageSize({ w: d.pageWidth, h: d.pageHeight });
      setTemplateName(d.originalFileName || d.templateName || "Packet template");
      setProviderSpecific(!!d.providerSpecific);
      setMappingStatus(d.mappingStatus || "APPROVED");
    }).catch((err) => {
      setFields([]);
      setStatusError(err instanceof Error ? err.message : "Mapping could not be loaded");
    });
  }, [qs]);

  useEffect(() => { pdfRef.current = null; }, [qs]);

  const renderPage = useCallback(async () => {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    if (!pdfRef.current) {
      pdfRef.current = await pdfjs.getDocument(`/api/template${qs}`).promise;
    }
    const doc = pdfRef.current as { getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: object) => { promise: Promise<void> } }> };
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = canvasRef.current!;
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
  }, [pageNum, scale, qs]);

  useEffect(() => { void renderPage(); }, [renderPage]);

  const toScreen = (f: Field) => ({
    left: f.x * scale, top: (pageSize.h - f.y - f.height) * scale,
    width: f.width * scale, height: f.height * scale,
  });

  function update(key: string, patch: Partial<Field>) {
    setFields((fs) => fs.map((f) => (f.fieldKey === key ? { ...f, ...patch } : f)));
    setDirty((d) => new Set(d).add(key));
  }

  function addFieldAt(e: React.MouseEvent) {
    if ((e.target as HTMLElement).dataset.fieldkey) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = (e.clientX - rect.left) / scale;
    const py = pageSize.h - (e.clientY - rect.top) / scale - 12;
    const key = `custom_${Date.now()}`;
    const f: Field = {
      page: pageNum, fieldKey: key, source: "", type: "text", x: Math.round(px), y: Math.round(py),
      width: 140, height: 12, fontSize: 9, lines: 1, lineHeight: 11.6,
      required: false, role: "client", consentKey: null, notes: "added in mapper",
    };
    setFields((fs) => [...fs, f]);
    setDirty((d) => new Set(d).add(key));
    setSelected(key);
  }

  function deleteSelected() {
    const field = fields.find((f) => f.fieldKey === selected);
    if (!field) return;
    setFields((fs) => fs.filter((f) => f.fieldKey !== field.fieldKey));
    setDeletedFields((current) => [...current.filter((f) => f.fieldKey !== field.fieldKey), { ...field, deleted: true }]);
    setDirty((current) => {
      const next = new Set(current);
      next.delete(field.fieldKey);
      return next;
    });
    setSelected(null);
  }

  function onPointerDown(e: React.PointerEvent, f: Field, resize: boolean) {
    e.stopPropagation();
    setSelected(f.fieldKey);
    dragRef.current = { key: f.fieldKey, startX: e.clientX, startY: e.clientY, ox: resize ? f.width : f.x, oy: resize ? f.height : f.y, resize };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    if (d.resize) update(d.key, { width: Math.max(10, Math.round(d.ox + dx)), height: Math.max(8, Math.round(d.oy + dy)) });
    else update(d.key, { x: Math.round(d.ox + dx), y: Math.round(d.oy - dy) });
  }
  function onPointerUp() { dragRef.current = null; }

  async function saveOverrides() {
    const changed = fields.filter((f) => dirty.has(f.fieldKey));
    const payload = [...changed, ...deletedFields];
    const r = await fetch(`/api/mapping${qs}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: payload, replace: replaceMappingOnSave }),
    });
    setNote(r.ok ? `Saved ${payload.length} mapping change(s)` : "Save failed");
    if (r.ok) { setDirty(new Set()); setDeletedFields([]); setHealth(null); setReplaceMappingOnSave(false); }
  }

  async function runAiMapping() {
    if (dirty.size > 0 || deletedFields.length > 0) {
      const confirmed = window.confirm("You have unsaved mapping changes. Running AI will replace the current draft map after the AI review. Continue?");
      if (!confirmed) return;
    }
    setAiBusy(true);
    setStatusError("");
    setNote("AI is reviewing the packet layout and saving a review draft...");
    try {
      const r = await fetch(`/api/mapping/ai-suggest${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true, background: true }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setStatusError(body.error || "AI mapping could not be completed.");
        return;
      }
      let result = body as { mappingStatus?: string; mappingIssues?: { error?: string }; appliedCount?: number };
      for (let attempt = 0; attempt < 90 && result.mappingStatus === "MAPPING"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const statusResponse = await fetch(`/api/mapping/ai-suggest${qs}`, { cache: "no-store" });
        const statusBody = await statusResponse.json().catch(() => ({}));
        if (!statusResponse.ok) throw new Error(statusBody.error || "AI mapping status could not be checked.");
        result = statusBody;
        if (result.mappingStatus !== "MAPPING") break;
      }
      if (result.mappingStatus === "MAPPING") throw new Error("AI mapping is still running. Return to the master dashboard shortly to check the packet status.");
      if (result.mappingIssues?.error) throw new Error(result.mappingIssues.error);
      const mappingResponse = await fetch(`/api/mapping${qs}`, { cache: "no-store" });
      const mappingBody = await mappingResponse.json().catch(() => ({}));
      if (!mappingResponse.ok) throw new Error(mappingBody.error || "The saved AI map could not be loaded.");
      setFields(mappingBody.fields || []);
      setPageCount(mappingBody.pageCount);
      setPageSize({ w: mappingBody.pageWidth, h: mappingBody.pageHeight });
      setTemplateName(mappingBody.originalFileName || mappingBody.templateName || "Packet template");
      setMappingStatus(mappingBody.mappingStatus || "DRAFT");
      setDirty(new Set());
      setDeletedFields([]);
      setAiSuggestions([]);
      setHealth(null);
      setNote(`AI saved ${result.appliedCount || 0} mapping suggestions as a draft. Review the packet, then run the quality check and approve it.`);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "AI mapping could not finish. Check the system AI setup or return to the master dashboard to try again.");
    } finally {
      setAiBusy(false);
    }
  }

  async function stopAiMapping() {
    setAiBusy(true);
    setStatusError("");
    setNote("Stopping AI mapping and keeping this packet as a review draft...");
    try {
      const r = await fetch(`/api/mapping/ai-suggest${qs}`, { method: "DELETE" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "AI mapping could not be stopped.");
      setMappingStatus(body.mappingStatus || "DRAFT");
      setNote("AI mapping stopped. You can run it again when the system AI connection is ready.");
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "AI mapping could not be stopped.");
    } finally {
      setAiBusy(false);
    }
  }

  function applyAiSuggestions(replace: boolean) {
    if (!aiSuggestions.length) return;
    if (replace) {
      setFields(aiSuggestions);
      setDirty(new Set(aiSuggestions.map((field) => field.fieldKey)));
      setDeletedFields([]);
      setReplaceMappingOnSave(true);
    } else {
      setFields((current) => [...current, ...aiSuggestions.filter((suggestion) => !current.some((field) => field.fieldKey === suggestion.fieldKey))]);
      setDirty((current) => new Set([...current, ...aiSuggestions.map((field) => field.fieldKey)]));
    }
    setAiSuggestions([]);
    setHealth(null);
    setNote("AI suggestions applied locally only. Review the boxes, then save and run the quality check.");
  }

  async function runHealthCheck() {
    setNote("Checking mapping quality...");
    const r = await fetch(`/api/mapping/health${qs}`);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      setNote(body.error || "Mapping quality check failed.");
      return;
    }
    setHealth(body.health || null);
    setNote(body.health?.ready ? "Mapping quality check passed. A master can approve this packet." : "Mapping needs attention before approval.");
  }

  async function approvePacket() {
    if (!providerId || !templateId) return;
    if (dirty.size > 0 || deletedFields.length > 0) {
      setNote("Save the mapping changes before approval.");
      return;
    }
    setNote("Checking the packet before approval...");
    const healthResponse = await fetch(`/api/mapping/health${qs}`);
    const healthBody = await healthResponse.json().catch(() => ({}));
    if (!healthResponse.ok || !healthBody.health?.ready) {
      setHealth(healthBody.health || null);
      setNote(healthBody.error || "Mapping needs attention before approval.");
      return;
    }
    const response = await fetch(`/api/master/providers/${encodeURIComponent(providerId)}/packet-template/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setHealth(body.health || null);
      setNote(body.error || "Packet approval failed.");
      return;
    }
    setHealth(body.health || healthBody.health);
    setMappingStatus("APPROVED");
    setNote("Packet approved and activated for provider signatures.");
  }

  async function loadMooreDraft() {
    const r = await fetch("/api/mapping");
    const d = await r.json();
    if (!r.ok) {
      setNote(d.error || "Could not load default map");
      return;
    }
    const draft = (d.fields || []).filter((f: Field) => f.page <= pageCount);
    setFields(draft);
    setDirty(new Set(draft.map((f: Field) => f.fieldKey)));
    setDeletedFields([]);
    setSelected(null);
    setNote(`Loaded ${draft.length} Moore fields as a draft. Review and save before using.`);
  }

  function clearMap() {
    setDeletedFields((current) => [
      ...current,
      ...fields.map((field) => ({ ...field, deleted: true })),
    ]);
    setFields([]);
    setDirty(new Set());
    setSelected(null);
    setNote("Map cleared locally. Save mapping to apply.");
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ pageCount, pageWidth: pageSize.w, pageHeight: pageSize.h, fields }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${templateName.replace(/\W+/g, "-")}-mapping.json`;
    a.click();
  }

  const pageFields = fields.filter((f) => f.page === pageNum);
  const sel = fields.find((f) => f.fieldKey === selected);

  return (
    <div className="flex gap-4">
      <div className="flex-1">
        <div className="mb-2 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
          Mapping: <strong>{templateName}</strong>{providerSpecific ? " (provider packet)" : " (default packet)"}
          {providerSpecific && <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${mappingStatus === "APPROVED" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{mappingStatus}</span>}
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost px-3 py-1" onClick={() => setPageNum((p) => Math.max(1, p - 1))}>Prev</button>
          <span className="text-sm font-semibold">Page {pageNum} / {pageCount}</span>
           <button type="button" className="btn-ghost px-3 py-1" onClick={() => setPageNum((p) => Math.min(pageCount, p + 1))}>Next</button>
          <select className="input w-auto py-1" value={pageNum} onChange={(e) => setPageNum(Number(e.target.value))}>
            {Array.from({ length: pageCount }, (_, i) => <option key={i + 1} value={i + 1}>Page {i + 1}</option>)}
          </select>
          <button className="btn-ghost px-3 py-1" onClick={() => setScale((s) => s + 0.2)}>Zoom +</button>
          <button className="btn-ghost px-3 py-1" onClick={() => setScale((s) => Math.max(0.6, s - 0.2))}>Zoom -</button>
          <label className="ml-2 flex items-center gap-1 text-sm">
            <input type="checkbox" checked={testFill} onChange={(e) => setTestFill(e.target.checked)} /> Test-fill labels
          </label>
          <button className="btn-primary px-3 py-1" onClick={saveOverrides}>Save mapping ({dirty.size + deletedFields.length})</button>
          {providerSpecific && <button className="btn-ghost px-3 py-1" onClick={runHealthCheck}>Check mapping quality</button>}
          {providerSpecific && mappingStatus === "DRAFT" && (
            <button className="btn-primary px-3 py-1" disabled={!health?.ready || dirty.size > 0 || deletedFields.length > 0} onClick={() => void approvePacket()}>
              Approve packet
            </button>
          )}
          {providerSpecific && <button type="button" className="btn-ghost px-3 py-1" disabled={aiBusy || mappingStatus === "MAPPING"} onClick={() => void runAiMapping}>{aiBusy || mappingStatus === "MAPPING" ? "AI mapping..." : "Run AI mapping"}</button>}
          {providerSpecific && mappingStatus === "MAPPING" && <button type="button" className="btn-ghost border-red-300 px-3 py-1 text-red-700 hover:bg-red-50" disabled={aiBusy} onClick={() => void stopAiMapping}>Stop AI mapping</button>}
          {providerSpecific && <button className="btn-ghost px-3 py-1" onClick={loadMooreDraft}>Load Moore draft</button>}
          <button className="btn-ghost px-3 py-1" onClick={clearMap}>Clear map</button>
          <button className="btn-ghost px-3 py-1" onClick={exportJson}>Export JSON</button>
          {(statusError || note) && <span role={statusError ? "alert" : "status"} className={`text-sm ${statusError ? "text-red-700" : "text-emerald-600"}`}>{statusError || note}</span>}
        </div>
        <p className="mb-2 text-xs text-slate-500">Click empty space to add a field. Drag a box to move. Drag the corner dot to resize. Click a box to edit its properties.</p>
        {health && (
          <div className={`mb-3 rounded-lg border p-3 text-sm ${health.ready ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
            <p className="font-semibold">Mapping score: {health.score}/100 {health.ready ? "- ready for master approval" : "- fix blocking items first"}</p>
            <p className="mt-1 text-xs">{health.counts.fields} fields, {health.counts.signatures} signature fields, {health.counts.pagesWithFields} pages with mappings.</p>
            {health.blockingIssues.length > 0 && <p className="mt-2 text-xs"><b>Blocking:</b> {health.blockingIssues.slice(0, 5).join(" ")}{health.blockingIssues.length > 5 ? " More issues remain." : ""}</p>}
            {health.warnings.length > 0 && <p className="mt-2 text-xs"><b>Warnings:</b> {health.warnings.slice(0, 3).join(" ")}{health.warnings.length > 3 ? " More warnings remain." : ""}</p>}
          </div>
        )}
        {aiSuggestions.length > 0 && (
          <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
            <p className="font-semibold">AI prepared {aiSuggestions.length} unsaved suggestions</p>
            <p className="mt-1 text-xs">These are recommendations only. Review the highlighted boxes before saving.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => applyAiSuggestions(true)}>Apply as new draft map</button>
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => applyAiSuggestions(false)}>Add to current map</button>
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setAiSuggestions([])}>Discard</button>
            </div>
            <p className="mt-2 text-xs">Preview: {aiSuggestions.slice(0, 5).map((field) => `${field.source} p${field.page}`).join("; ")}{aiSuggestions.length > 5 ? "; ..." : ""}</p>
          </div>
        )}
        <div className="relative inline-block border border-slate-300 shadow" onClick={addFieldAt}
          onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
          <canvas ref={canvasRef} />
          {pageFields.map((f) => {
            const s = toScreen(f);
            const isSel = selected === f.fieldKey;
            return (
              <div key={f.fieldKey} data-fieldkey={f.fieldKey}
                onPointerDown={(e) => onPointerDown(e, f, false)}
                className={`absolute cursor-move border text-[9px] leading-tight ${isSel ? "z-10 border-red-500 bg-red-200/50" : f.type === "signature" || f.type === "signature_small" ? "border-purple-500 bg-purple-200/40" : f.type === "checkbox" ? "border-amber-500 bg-amber-200/40" : "border-sky-500 bg-sky-200/40"}`}
                style={{ left: s.left, top: s.top, width: s.width, height: Math.max(s.height, 10) }}
                title={`${f.fieldKey} from ${f.source}`}>
                {testFill && <span className="pointer-events-none block truncate px-0.5 text-sky-900">{f.source || f.fieldKey}</span>}
                {isSel && (
                  <div onPointerDown={(e) => onPointerDown(e, f, true)}
                    className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-full bg-red-500" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="w-80 shrink-0">
        <div className="card sticky top-4">
          <h3 className="mb-2 font-bold">Field properties</h3>
          {!sel && <p className="text-sm text-slate-400">Select a field on the page.</p>}
          {sel && (
            <div className="space-y-2 text-sm">
              <div><label className="label">Field key</label><input className="input" value={sel.fieldKey} disabled /></div>
              <div><label className="label">Question key (source)</label>
                <input className="input" list="mapping-source-options" value={sel.source} onChange={(e) => update(sel.fieldKey, { source: e.target.value })} />
                <datalist id="mapping-source-options">
                  {SOURCE_OPTIONS.map((source) => <option key={source} value={source} />)}
                </datalist>
                <p className="text-xs text-slate-400">Plain key = text. key=Value = checkbox match. key~Value = multi-select match.</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="label">Type</label>
                  <select className="input" value={sel.type} onChange={(e) => update(sel.fieldKey, { type: e.target.value })}>
                    {TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select></div>
                <div><label className="label">Role</label>
                  <select className="input" value={sel.role} onChange={(e) => update(sel.fieldKey, { role: e.target.value })}>
                    {ROLES.map((t) => <option key={t}>{t}</option>)}
                  </select></div>
                <div><label className="label">X</label><input className="input" type="number" value={sel.x} onChange={(e) => update(sel.fieldKey, { x: Number(e.target.value) })} /></div>
                <div><label className="label">Y</label><input className="input" type="number" value={sel.y} onChange={(e) => update(sel.fieldKey, { y: Number(e.target.value) })} /></div>
                <div><label className="label">Width</label><input className="input" type="number" value={sel.width} onChange={(e) => update(sel.fieldKey, { width: Number(e.target.value) })} /></div>
                <div><label className="label">Height</label><input className="input" type="number" value={sel.height} onChange={(e) => update(sel.fieldKey, { height: Number(e.target.value) })} /></div>
                <div><label className="label">Font size</label><input className="input" type="number" value={sel.fontSize} onChange={(e) => update(sel.fieldKey, { fontSize: Number(e.target.value) })} /></div>
                <div><label className="label">Lines</label><input className="input" type="number" value={sel.lines} onChange={(e) => update(sel.fieldKey, { lines: Number(e.target.value) })} /></div>
              </div>
              <div><label className="label">Consent key (blank = always fill)</label>
                <input className="input" value={sel.consentKey || ""} onChange={(e) => update(sel.fieldKey, { consentKey: e.target.value || null })} /></div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={sel.required} onChange={(e) => update(sel.fieldKey, { required: e.target.checked })} /> Required</label>
              <div><label className="label">Notes</label><input className="input" value={sel.notes} onChange={(e) => update(sel.fieldKey, { notes: e.target.value })} /></div>
              <button className="btn-ghost w-full border-red-200 text-red-700" onClick={deleteSelected}>Delete selected field</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
