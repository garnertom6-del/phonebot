"use client";
/**
 * Admin PDF field mapper: intake catalog palette, snap/align, honest save
 * counts, whole-packet AI review, and a quality panel that lists missing
 * required fields instead of a score-only badge.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FieldMapping } from "@/config/mooreDivinePacketMap";
import {
  bestPageForSource,
  catalogEntryByKey,
  defaultFieldSize,
  demoValueForSource,
  HEADER_SOURCES,
  mappingCatalog,
  mappedSourceKeys,
  newCatalogField,
  sourceBase,
  type CatalogEntry,
} from "@/lib/mappingCatalog";
import { packetDisplayStatus } from "@/lib/mappingStatus";
import type { MappingHealth } from "@/lib/mappingHealth";
import type { PacketFilenameWarning } from "@/lib/packetFilenameGuard";

type Field = FieldMapping & { deleted?: boolean };

const TYPES = ["text", "checkbox", "date", "signature", "signature_small", "initials", "survey_rating"];
const ROLES = ["client", "guardian", "staff", "clinician", "medicalDirector", "witness", "auto"];
const SNAP = 4;

function queryString(providerId?: string, templateId?: string) {
  const params = new URLSearchParams();
  if (providerId) params.set("providerId", providerId);
  if (templateId) params.set("templateId", templateId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function parseAiConfidence(field: Field): number | null {
  if (typeof field.confidence === "number" && Number.isFinite(field.confidence)) return field.confidence;
  const match = /AI suggestion \((\d+)%\)/.exec(field.notes || "");
  return match ? Number(match[1]) / 100 : null;
}

function isPendingAi(field: Field): boolean {
  return field.aiStatus === "pending" || (field.fieldKey.startsWith("ai_") && field.aiStatus !== "accepted" && field.aiStatus !== "rejected");
}

function snapValue(value: number, guides: number[]): { value: number; guide: number | null } {
  let best: { value: number; guide: number | null } = { value, guide: null };
  let bestDist = SNAP;
  for (const guide of guides) {
    const dist = Math.abs(value - guide);
    if (dist <= bestDist) {
      bestDist = dist;
      best = { value: guide, guide };
    }
  }
  return best;
}

export default function PdfFieldMapper({ providerId, templateId }: { providerId?: string; templateId?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pageNum, setPageNum] = useState(1);
  const [pageCount, setPageCount] = useState(43);
  const [pageSize, setPageSize] = useState({ w: 612, h: 792 });
  const [scale, setScale] = useState(1.2);
  const [fields, setFields] = useState<Field[]>([]);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [testFill, setTestFill] = useState<"off" | "labels" | "demo">("off");
  const [templateName, setTemplateName] = useState("Moore Divine Care Client Intake Package");
  const [providerName, setProviderName] = useState("");
  const [providerSpecific, setProviderSpecific] = useState(false);
  const [mappingStatus, setMappingStatus] = useState("DRAFT");
  const [mappingScore, setMappingScore] = useState<number | null>(null);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);
  const [isActivePacket, setIsActivePacket] = useState(false);
  const [health, setHealth] = useState<MappingHealth | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [previewRotation, setPreviewRotation] = useState<0 | 180>(0);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [placing, setPlacing] = useState<CatalogEntry | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [filenameWarning, setFilenameWarning] = useState<PacketFilenameWarning | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [showOverride, setShowOverride] = useState(false);
  const pdfRef = useRef<unknown>(null);
  const renderTaskRef = useRef<{ promise: Promise<void>; cancel: () => void } | null>(null);
  const renderSequenceRef = useRef(0);
  const dragRef = useRef<{ key: string; startX: number; startY: number; ox: number; oy: number; ow: number; oh: number; resize: boolean } | null>(null);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  const qs = queryString(providerId, templateId);
  const catalog = useMemo(() => mappingCatalog(), []);

  useEffect(() => {
    setNote("");
    setSelected(null);
    setDirty(false);
    setHealth(null);
    setStatusError("");
    setPlacing(null);
    setOverrideReason("");
    setShowOverride(false);
    const rotationKey = `pdf-mapper-rotation:${templateId || providerId || "default"}`;
    const savedRotation = window.localStorage.getItem(rotationKey);
    setPreviewRotation(savedRotation === "180" ? 180 : 0);
    fetch(`/api/mapping${qs}`).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Mapping could not be loaded");
      const loaded: Field[] = d.fields || [];
      setFields(loaded);
      setPageCount(d.pageCount);
      setPageSize({ w: d.pageWidth, h: d.pageHeight });
      setTemplateName(d.originalFileName || d.templateName || "Packet template");
      setProviderName(d.providerName || "");
      setProviderSpecific(!!d.providerSpecific);
      setMappingStatus(d.mappingStatus || "DRAFT");
      setMappingScore(typeof d.mappingScore === "number" ? d.mappingScore : null);
      setApprovedAt(d.approvedAt || null);
      setIsActivePacket(!!d.isActive);
      setFilenameWarning(d.filenameWarning || null);
      const savedCount = typeof d.savedMappingCount === "number" ? d.savedMappingCount : loaded.length;
      if (d.providerSpecific && loaded.length > savedCount) {
        setDirty(true);
        setNote(`${loaded.length} boxes are on the packet, but only ${savedCount} are saved. Save mapping to make the count honest.`);
      }
    }).catch((err) => {
      setFields([]);
      setStatusError(err instanceof Error ? err.message : "Mapping could not be loaded");
    });
  }, [qs]);

  useEffect(() => {
    pdfRef.current = null;
    renderSequenceRef.current += 1;
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
  }, [qs]);

  const renderPage = useCallback(async () => {
    const sequence = ++renderSequenceRef.current;
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    if (!pdfRef.current) {
      pdfRef.current = await pdfjs.getDocument(`/api/template${qs}`).promise;
    }
    if (sequence !== renderSequenceRef.current) return;
    const doc = pdfRef.current as { getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: object) => { promise: Promise<void>; cancel: () => void } }> };
    const page = await doc.getPage(pageNum);
    if (sequence !== renderSequenceRef.current) return;
    renderTaskRef.current?.cancel();
    const viewport = page.getViewport({ scale });
    const canvas = canvasRef.current!;
    canvas.width = viewport.width; canvas.height = viewport.height;
    const renderTask = page.render({ canvasContext: canvas.getContext("2d")!, viewport });
    renderTaskRef.current = renderTask;
    try {
      await renderTask.promise;
    } catch (error) {
      if (sequence !== renderSequenceRef.current || (error instanceof Error && error.name === "RenderingCancelledException")) return;
      throw error;
    } finally {
      if (renderTaskRef.current === renderTask) renderTaskRef.current = null;
    }
  }, [pageNum, scale, qs]);

  useEffect(() => {
    void renderPage().catch((error) => {
      if (error instanceof Error) setStatusError(error.message || "The PDF preview could not be rendered.");
    });
    return () => {
      renderSequenceRef.current += 1;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [renderPage]);

  const toScreen = (f: Field) => ({
    left: previewRotation === 180 ? (pageSize.w - f.x - f.width) * scale : f.x * scale,
    top: previewRotation === 180 ? f.y * scale : (pageSize.h - f.y - f.height) * scale,
    width: f.width * scale, height: f.height * scale,
  });

  const mappedKeys = useMemo(() => mappedSourceKeys(fields), [fields]);
  const unmappedRequired = useMemo(
    () => catalog.flatMap((section) => section.entries).filter((entry) => entry.required && !mappedKeys.has(entry.key)),
    [catalog, mappedKeys],
  );
  const displayStatus = packetDisplayStatus({
    mappingStatus,
    mappingScore,
    isActive: isActivePacket,
    approvedAt,
  });
  const pendingAi = fields.filter(isPendingAi);

  function markDirty() { setDirty(true); setHealth(null); }

  function update(key: string, patch: Partial<Field>) {
    setFields((fs) => fs.map((f) => (f.fieldKey === key ? { ...f, ...patch } : f)));
    markDirty();
  }

  function addField(field: Field) {
    setFields((fs) => [...fs, field]);
    setSelected(field.fieldKey);
    markDirty();
  }

  function placeCatalogEntry(entry: CatalogEntry, visualX: number, visualY: number, optionValue?: string) {
    const size = defaultFieldSize(optionValue ? "checkbox" : entry.mapperType, entry.key);
    const px = previewRotation === 180 ? pageSize.w - visualX - size.width : visualX;
    const py = previewRotation === 180 ? visualY - size.height : pageSize.h - visualY - size.height;
    const field = newCatalogField(
      entry,
      pageNum,
      Math.round(Math.max(0, Math.min(pageSize.w - size.width, px))),
      Math.round(Math.max(0, Math.min(pageSize.h - size.height, py))),
      optionValue,
    );
    addField(field);
    setPlacing(null);
    setNote(`Placed ${entry.easyLabel} on page ${pageNum}.`);
  }

  function addFieldAt(e: React.MouseEvent) {
    if ((e.target as HTMLElement).dataset.fieldkey) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const visualX = (e.clientX - rect.left) / scale;
    const visualY = (e.clientY - rect.top) / scale;
    if (placing) {
      placeCatalogEntry(placing, visualX, visualY);
      return;
    }
    const size = defaultFieldSize("text");
    const px = previewRotation === 180 ? pageSize.w - visualX - size.width : visualX;
    const py = previewRotation === 180 ? visualY - size.height : pageSize.h - visualY - size.height;
    const key = `custom_${Date.now()}`;
    addField({
      page: pageNum, fieldKey: key, source: "", type: "text",
      x: Math.round(Math.max(0, Math.min(pageSize.w - size.width, px))),
      y: Math.round(Math.max(0, Math.min(pageSize.h - size.height, py))),
      width: size.width, height: size.height, fontSize: 9, lines: 1, lineHeight: 11.6,
      required: false, role: "client", consentKey: null, notes: "added in mapper",
    });
  }

  function deleteSelected() {
    if (!selected) return;
    setFields((fs) => fs.filter((f) => f.fieldKey !== selected));
    setSelected(null);
    markDirty();
  }

  function onPointerDown(e: React.PointerEvent, f: Field, resize: boolean) {
    e.stopPropagation();
    setSelected(f.fieldKey);
    dragRef.current = {
      key: f.fieldKey, startX: e.clientX, startY: e.clientY,
      ox: f.x, oy: f.y, ow: f.width, oh: f.height, resize,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    const others = fieldsRef.current.filter((field) => field.page === pageNum && field.fieldKey !== d.key);
    const xs = others.flatMap((field) => [field.x, field.x + field.width]);
    const ys = others.flatMap((field) => [field.y, field.y + field.height]);
    if (d.resize) {
      const nextW = Math.max(10, Math.round(previewRotation === 180 ? d.ow - dx : d.ow + dx));
      const nextH = Math.max(8, Math.round(previewRotation === 180 ? d.oh - dy : d.oh + dy));
      const snappedW = snapValue(d.ox + nextW, xs);
      const snappedH = snapValue(d.oy + nextH, ys);
      setGuides({ v: snappedW.guide != null ? [snappedW.guide] : [], h: snappedH.guide != null ? [snappedH.guide] : [] });
      update(d.key, { width: Math.max(10, snappedW.value - d.ox), height: Math.max(8, snappedH.value - d.oy) });
    } else {
      const rawX = Math.round(previewRotation === 180 ? d.ox - dx : d.ox + dx);
      const rawY = Math.round(previewRotation === 180 ? d.oy + dy : d.oy - dy);
      const snappedX = snapValue(rawX, xs);
      const snappedY = snapValue(rawY, ys);
      const right = snapValue(rawX + d.ow, xs);
      const top = snapValue(rawY + d.oh, ys);
      const x = right.guide != null && snappedX.guide == null ? right.value - d.ow : snappedX.value;
      const y = top.guide != null && snappedY.guide == null ? top.value - d.oh : snappedY.value;
      setGuides({
        v: [snappedX.guide, right.guide].filter((value): value is number => value != null),
        h: [snappedY.guide, top.guide].filter((value): value is number => value != null),
      });
      update(d.key, { x, y });
    }
  }
  function onPointerUp() { dragRef.current = null; setGuides({ v: [], h: [] }); }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (!selected) return;
      const field = fieldsRef.current.find((item) => item.fieldKey === selected);
      if (!field) return;
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") { e.preventDefault(); update(field.fieldKey, { x: field.x - step }); }
      if (e.key === "ArrowRight") { e.preventDefault(); update(field.fieldKey, { x: field.x + step }); }
      if (e.key === "ArrowUp") { e.preventDefault(); update(field.fieldKey, { y: field.y + step }); }
      if (e.key === "ArrowDown") { e.preventDefault(); update(field.fieldKey, { y: field.y - step }); }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); }
      if (e.key === "Escape") { setSelected(null); setPlacing(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  function matchWidth() {
    const field = fields.find((item) => item.fieldKey === selected);
    if (!field) return;
    const row = fields.filter((item) => item.page === field.page && item.fieldKey !== field.fieldKey && Math.abs(item.y - field.y) <= 8);
    if (!row.length) { setNote("No nearby fields on this row to match width."); return; }
    const widths = row.map((item) => item.width).sort((a, b) => a - b);
    update(field.fieldKey, { width: widths[Math.floor(widths.length / 2)] });
    setNote("Matched width to the fields on this row.");
  }

  function copyToHeaderPages() {
    const field = fields.find((item) => item.fieldKey === selected);
    if (!field) return;
    const headerPages = new Set(
      fields.filter((item) => HEADER_SOURCES.includes(sourceBase(item.source) as typeof HEADER_SOURCES[number])).map((item) => item.page),
    );
    if (!headerPages.size) {
      for (let page = 1; page <= pageCount; page++) headerPages.add(page);
    }
    const copies: Field[] = [];
    for (const page of headerPages) {
      if (page === field.page) continue;
      if (fields.some((item) => item.page === page && sourceBase(item.source) === sourceBase(field.source) && Math.abs(item.y - field.y) <= 6 && Math.abs(item.x - field.x) <= 6)) continue;
      copies.push({
        ...field,
        fieldKey: `${field.fieldKey}_p${page}_${Date.now().toString(36)}`.slice(0, 120),
        page,
        notes: `${field.notes || field.source} (copied header row)`,
      });
    }
    if (!copies.length) { setNote("This field is already on every header page."); return; }
    setFields((current) => [...current, ...copies]);
    markDirty();
    setNote(`Copied to ${copies.length} page${copies.length === 1 ? "" : "s"} that share this header/table.`);
  }

  async function saveOverrides() {
    const r = await fetch(`/api/mapping${qs}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields, replace: true }),
    });
    const body = await r.json().catch(() => ({}));
    setNote(r.ok ? `Saved ${typeof body.saved === "number" ? body.saved : fields.length} placed field${fields.length === 1 ? "" : "s"}` : (body.error || "Save failed"));
    if (r.ok) {
      setDirty(false);
      setHealth(null);
      setMappingStatus("DRAFT");
      setIsActivePacket(false);
      setApprovedAt(null);
    }
  }

  async function runAiMapping() {
    if (dirty) {
      const confirmed = window.confirm("You have unsaved mapping changes. Running AI will replace the current draft map after the AI review. Continue?");
      if (!confirmed) return;
    }
    setAiBusy(true);
    setStatusError("");
    setNote("AI is mapping the whole packet and saving a review draft...");
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
      setDirty(false);
      setHealth(null);
      setNote(`AI saved ${result.appliedCount || 0} suggestions as a draft. Accept or reject low-confidence boxes, then run the quality check.`);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "AI mapping could not finish.");
    } finally {
      setAiBusy(false);
    }
  }

  async function stopAiMapping() {
    setAiBusy(true);
    setStatusError("");
    try {
      const r = await fetch(`/api/mapping/ai-suggest${qs}`, { method: "DELETE" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || "AI mapping could not be stopped.");
      setMappingStatus(body.mappingStatus || "DRAFT");
      setNote("AI mapping stopped.");
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : "AI mapping could not be stopped.");
    } finally {
      setAiBusy(false);
    }
  }

  function acceptAi(fieldKey?: string) {
    setFields((current) => current.map((field) => {
      if (fieldKey && field.fieldKey !== fieldKey) return field;
      if (!isPendingAi(field)) return field;
      return { ...field, aiStatus: "accepted" as const, notes: (field.notes || "").replace(/^AI suggestion/, "Accepted AI") };
    }));
    markDirty();
  }

  function rejectAi(fieldKey: string) {
    setFields((current) => current.filter((field) => field.fieldKey !== fieldKey));
    if (selected === fieldKey) setSelected(null);
    markDirty();
  }

  async function runHealthCheck() {
    setNote("Checking mapping quality...");
    const r = await fetch(`/api/mapping/health${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const getFallback = await fetch(`/api/mapping/health${qs}`);
      const fallback = await getFallback.json().catch(() => ({}));
      if (!getFallback.ok) {
        setNote(body.error || fallback.error || "Mapping quality check failed.");
        return;
      }
      setHealth(fallback.health || null);
      setNote(fallback.health?.ready ? "Mapping quality check passed." : "Mapping needs attention before approval.");
      return;
    }
    setHealth(body.health || null);
    setNote(body.health?.ready ? "Mapping quality check passed. A master can approve this packet." : "Mapping needs attention before approval.");
  }

  async function approvePacket(override = false) {
    if (!providerId || !templateId) return;
    if (dirty) {
      setNote("Save the mapping changes before approval.");
      return;
    }
    if (filenameWarning && !override && !overrideReason.trim()) {
      setShowOverride(true);
      setNote(filenameWarning.message);
      return;
    }
    setNote("Checking the packet before approval...");
    const healthResponse = await fetch(`/api/mapping/health${qs}`);
    const healthBody = await healthResponse.json().catch(() => ({}));
    const nextHealth = healthBody.health as MappingHealth | undefined;
    setHealth(nextHealth || null);
    if (!healthResponse.ok || !nextHealth?.ready) {
      if (!override || overrideReason.trim().length < 8) {
        setShowOverride(true);
        setNote(healthBody.error || "Required fields are still missing. Add an override reason to approve anyway.");
        return;
      }
    }
    const response = await fetch(`/api/master/providers/${encodeURIComponent(providerId)}/packet-template/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId,
        overrideReason: override ? overrideReason.trim() : undefined,
        filenameAcknowledged: !!filenameWarning,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setHealth(body.health || nextHealth || null);
      setNote(body.error || "Packet approval failed.");
      if (body.filenameWarning) setFilenameWarning(body.filenameWarning);
      return;
    }
    setHealth(body.health || nextHealth || null);
    setMappingStatus("APPROVED");
    setIsActivePacket(true);
    setApprovedAt(new Date().toISOString());
    setMappingScore(body.health?.score ?? nextHealth?.score ?? null);
    setShowOverride(false);
    setNote("Packet approved and activated for provider signatures.");
  }

  function jumpToCatalog(entry: CatalogEntry) {
    const page = bestPageForSource(fields, entry.key);
    setPageNum(page);
    const existing = fields.find((field) => sourceBase(field.source) === entry.key && field.page === page);
    if (existing) {
      setSelected(existing.fieldKey);
      setPlacing(null);
      setNote(`Jumped to ${entry.easyLabel} on page ${page}.`);
      return;
    }
    setPlacing(entry);
    setNote(`Page ${page}: click the blank to place ${entry.easyLabel}.`);
  }

  function clearMap() {
    setFields([]);
    setSelected(null);
    markDirty();
    setNote("Map cleared locally. Save mapping to apply.");
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ pageCount, pageWidth: pageSize.w, pageHeight: pageSize.h, fields }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${templateName.replace(/\W+/g, "-")}-mapping.json`;
    a.click();
  }

  function togglePreviewRotation() {
    const next = previewRotation === 180 ? 0 : 180;
    const rotationKey = `pdf-mapper-rotation:${templateId || providerId || "default"}`;
    setPreviewRotation(next);
    window.localStorage.setItem(rotationKey, String(next));
  }

  const pageFields = fields.filter((f) => f.page === pageNum);
  const sel = fields.find((f) => f.fieldKey === selected);

  return (
    <div className="flex gap-4">
      <MappingPalette
        catalog={catalog}
        mappedKeys={mappedKeys}
        query={paletteQuery}
        onQuery={setPaletteQuery}
        placing={placing}
        onPlace={setPlacing}
        onJump={jumpToCatalog}
        unmappedRequired={unmappedRequired.length}
      />
      <div className="min-w-0 flex-1">
        <div className="mb-2 rounded-md bg-slate-50 p-3 text-sm text-slate-600">
          Mapping: <strong>{templateName}</strong>{providerSpecific ? " (provider packet)" : " (default packet)"}
          {providerName ? <span className="ml-1 text-slate-500">for {providerName}</span> : null}
          {providerSpecific && (
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${displayStatus.className}`}>
              {displayStatus.label}
            </span>
          )}
          <span className="ml-2 text-xs text-slate-500">{fields.length} placed · {unmappedRequired.length} required unmapped</span>
        </div>
        {filenameWarning && (
          <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">Wrong-packet guard</p>
            <p className="mt-1">{filenameWarning.message}</p>
          </div>
        )}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-ghost px-3 py-1" onClick={() => setPageNum((p) => Math.max(1, p - 1))}>Prev</button>
          <span className="text-sm font-semibold">Page {pageNum} / {pageCount}</span>
          <button type="button" className="btn-ghost px-3 py-1" onClick={() => setPageNum((p) => Math.min(pageCount, p + 1))}>Next</button>
          <select className="input w-auto py-1" value={pageNum} onChange={(e) => setPageNum(Number(e.target.value))}>
            {Array.from({ length: pageCount }, (_, i) => <option key={i + 1} value={i + 1}>Page {i + 1}</option>)}
          </select>
          <button className="btn-ghost px-3 py-1" onClick={() => setScale((s) => s + 0.2)}>Zoom +</button>
          <button className="btn-ghost px-3 py-1" onClick={() => setScale((s) => Math.max(0.6, s - 0.2))}>Zoom -</button>
          <button type="button" className="btn-ghost px-3 py-1" onClick={togglePreviewRotation}>
            {previewRotation === 180 ? "Use normal orientation" : "Rotate 180 deg"}
          </button>
          <label className="ml-2 flex items-center gap-1 text-sm">
            Test-fill
            <select className="input w-auto py-1" value={testFill} onChange={(e) => setTestFill(e.target.value as typeof testFill)}>
              <option value="off">Off</option>
              <option value="labels">Labels</option>
              <option value="demo">Demo client</option>
            </select>
          </label>
          <button className="btn-primary px-3 py-1" onClick={() => void saveOverrides()}>
            Save mapping ({fields.length}){dirty ? " · unsaved" : ""}
          </button>
          {providerSpecific && <button className="btn-ghost px-3 py-1" onClick={() => void runHealthCheck()}>Check mapping quality</button>}
          {providerSpecific && mappingStatus !== "APPROVED" && (
            <button
              className="btn-primary px-3 py-1"
              disabled={dirty || mappingStatus === "MAPPING"}
              onClick={() => void approvePacket(false)}
            >
              Approve packet
            </button>
          )}
          {providerSpecific && <button type="button" className="btn-ghost px-3 py-1" disabled={aiBusy || mappingStatus === "MAPPING"} onClick={() => void runAiMapping()}>{aiBusy || mappingStatus === "MAPPING" ? "AI mapping..." : "Run AI mapping"}</button>}
          {providerSpecific && mappingStatus === "MAPPING" && <button type="button" className="btn-ghost border-red-300 px-3 py-1 text-red-700 hover:bg-red-50" disabled={aiBusy} onClick={() => void stopAiMapping()}>Stop AI mapping</button>}
          <button className="btn-ghost px-3 py-1" onClick={clearMap}>Clear map</button>
          <button className="btn-ghost px-3 py-1" onClick={exportJson}>Export JSON</button>
          {(statusError || note) && <span role={statusError ? "alert" : "status"} className={`text-sm ${statusError ? "text-red-700" : "text-emerald-600"}`}>{statusError || note}</span>}
        </div>
        <p className="mb-2 text-xs text-slate-500">
          {placing ? `Click or drop onto the PDF to place “${placing.easyLabel}”. Esc cancels.` : "Search the intake catalog, drag a field onto the PDF, or click it then click the blank. Drag a box to move. Corner dot resizes. Arrow keys nudge (Shift for 10pt)."}
        </p>
        {pendingAi.length > 0 && (
          <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
            <p className="font-semibold">{pendingAi.length} AI suggestion{pendingAi.length === 1 ? "" : "s"} need a human decision</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => acceptAi()}>Accept all AI boxes</button>
            </div>
          </div>
        )}
        {health && (
          <QualityPanel
            health={health}
            onJump={(key) => {
              const entry = catalogEntryByKey(key);
              if (entry) jumpToCatalog(entry);
            }}
          />
        )}
        {showOverride && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <p className="font-semibold text-amber-950">Approval override</p>
            <p className="mt-1 text-amber-900">Required fields are missing or the filename looks wrong. Type a reason to approve anyway. This is recorded in the audit log.</p>
            <textarea className="input mt-2" rows={2} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Why this packet can go live without the missing required mappings" />
            <button className="btn-primary mt-2 px-3 py-1.5 text-xs" disabled={overrideReason.trim().length < 8} onClick={() => void approvePacket(true)}>
              Approve with override
            </button>
          </div>
        )}
        <div className="relative inline-block border border-slate-300 shadow"
          style={{ transform: previewRotation === 180 ? "rotate(180deg)" : undefined }}
          onClick={addFieldAt}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const key = event.dataTransfer.getData("text/intake-key");
            const entry = catalogEntryByKey(key) || placing;
            if (!entry) return;
            const rect = event.currentTarget.getBoundingClientRect();
            placeCatalogEntry(entry, (event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale);
          }}
          onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
          <canvas ref={canvasRef} />
          {guides.v.map((x) => (
            <div key={`v-${x}`} className="pointer-events-none absolute top-0 z-20 w-px bg-fuchsia-500" style={{ left: x * scale, height: pageSize.h * scale }} />
          ))}
          {guides.h.map((y) => (
            <div key={`h-${y}`} className="pointer-events-none absolute left-0 z-20 h-px bg-fuchsia-500" style={{ bottom: y * scale, width: pageSize.w * scale }} />
          ))}
          {pageFields.map((f) => {
            const s = toScreen(f);
            const isSel = selected === f.fieldKey;
            const pending = isPendingAi(f);
            const fillText = testFill === "demo" ? demoValueForSource(f.source || f.fieldKey)
              : testFill === "labels" ? (f.source || f.fieldKey)
              : "";
            return (
              <div key={f.fieldKey} data-fieldkey={f.fieldKey}
                onPointerDown={(e) => onPointerDown(e, f, false)}
                className={`absolute cursor-move border text-[9px] leading-tight ${
                  isSel ? "z-10 border-red-500 bg-red-200/50"
                    : pending ? "border-fuchsia-500 bg-fuchsia-200/40"
                    : f.type === "signature" || f.type === "signature_small" ? "border-purple-500 bg-purple-200/40"
                    : f.type === "checkbox" ? "border-amber-500 bg-amber-200/40"
                    : f.type === "date" ? "border-emerald-500 bg-emerald-200/40"
                    : "border-sky-500 bg-sky-200/40"
                }`}
                style={{ left: s.left, top: s.top, width: s.width, height: Math.max(s.height, 10) }}
                title={`${f.fieldKey} from ${f.source}`}>
                {fillText && <span className="pointer-events-none block truncate px-0.5 text-sky-900">{fillText}</span>}
                {pending && !fillText && <span className="pointer-events-none block truncate px-0.5 text-fuchsia-900">{Math.round((parseAiConfidence(f) || 0) * 100)}%</span>}
                {isSel && (
                  <div onPointerDown={(e) => onPointerDown(e, f, true)}
                    className={`absolute h-3 w-3 rounded-full bg-red-500 ${previewRotation === 180 ? "-left-1.5 -top-1.5 cursor-nwse-resize" : "-bottom-1.5 -right-1.5 cursor-nwse-resize"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="w-80 shrink-0">
        <div className="card sticky top-4 space-y-4">
          <div>
            <h3 className="mb-2 font-bold">Field properties</h3>
            {!sel && <p className="text-sm text-slate-400">Select a field, or pick one from the intake palette.</p>}
            {sel && (
              <div className="space-y-2 text-sm">
                <div><label className="label">Field key</label><input className="input" value={sel.fieldKey} disabled /></div>
                <div><label className="label">Intake answer key</label>
                  <input className="input" value={sel.source} onChange={(e) => update(sel.fieldKey, { source: e.target.value })} />
                  {catalogEntryByKey(sel.source) && <p className="mt-1 text-xs text-slate-500">{catalogEntryByKey(sel.source)?.easyLabel}</p>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="label">Type</label>
                    <select className="input" value={sel.type} onChange={(e) => update(sel.fieldKey, { type: e.target.value as Field["type"] })}>
                      {TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select></div>
                  <div><label className="label">Role</label>
                    <select className="input" value={sel.role} onChange={(e) => update(sel.fieldKey, { role: e.target.value as Field["role"] })}>
                      {ROLES.map((t) => <option key={t}>{t}</option>)}
                    </select></div>
                  <div><label className="label">X</label><input className="input" type="number" value={sel.x} onChange={(e) => update(sel.fieldKey, { x: Number(e.target.value) })} /></div>
                  <div><label className="label">Y</label><input className="input" type="number" value={sel.y} onChange={(e) => update(sel.fieldKey, { y: Number(e.target.value) })} /></div>
                  <div><label className="label">Width</label><input className="input" type="number" value={sel.width} onChange={(e) => update(sel.fieldKey, { width: Number(e.target.value) })} /></div>
                  <div><label className="label">Height</label><input className="input" type="number" value={sel.height} onChange={(e) => update(sel.fieldKey, { height: Number(e.target.value) })} /></div>
                </div>
                {isPendingAi(sel) && (
                  <div className="flex gap-2">
                    <button className="btn-primary flex-1 px-2 py-1 text-xs" onClick={() => acceptAi(sel.fieldKey)}>Accept AI</button>
                    <button className="btn-ghost flex-1 px-2 py-1 text-xs" onClick={() => rejectAi(sel.fieldKey)}>Reject</button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={matchWidth}>Match width</button>
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={copyToHeaderPages}>Copy to header pages</button>
                </div>
                <label className="flex items-center gap-2"><input type="checkbox" checked={sel.required} onChange={(e) => update(sel.fieldKey, { required: e.target.checked })} /> Required</label>
                <button className="btn-ghost w-full border-red-200 text-red-700" onClick={deleteSelected}>Delete selected field</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MappingPalette({
  catalog, mappedKeys, query, onQuery, placing, onPlace, onJump, unmappedRequired,
}: {
  catalog: ReturnType<typeof mappingCatalog>;
  mappedKeys: Set<string>;
  query: string;
  onQuery: (value: string) => void;
  placing: CatalogEntry | null;
  onPlace: (entry: CatalogEntry | null) => void;
  onJump: (entry: CatalogEntry) => void;
  unmappedRequired: number;
}) {
  const q = query.trim().toLowerCase();
  const sections = catalog.map((section) => ({
    ...section,
    entries: section.entries.filter((entry) => {
      if (!q) return true;
      return [entry.key, entry.label, entry.easyLabel, entry.sectionTitle].join(" ").toLowerCase().includes(q);
    }),
  })).filter((section) => section.entries.length);
  return (
    <aside className="w-72 shrink-0">
      <div className="card sticky top-4 max-h-[calc(100vh-6rem)] overflow-hidden p-3">
        <h3 className="font-bold">Intake field palette</h3>
        <p className="mt-1 text-xs text-slate-500">{unmappedRequired} required field{unmappedRequired === 1 ? "" : "s"} still unmapped.</p>
        <input className="input mt-2" placeholder="Search name, DOB, MID, consent..." value={query} onChange={(e) => onQuery(e.target.value)} />
        <div className="mt-3 max-h-[calc(100vh-14rem)] space-y-3 overflow-y-auto pr-1">
          {sections.map((section) => (
            <div key={section.key}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{section.title}</p>
              <ul className="mt-1 space-y-1">
                {section.entries.map((entry) => {
                  const mapped = mappedKeys.has(entry.key);
                  return (
                    <li key={entry.key}>
                      <button
                        type="button"
                        draggable
                        className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${
                          placing?.key === entry.key ? "border-brand bg-brand-light"
                            : mapped ? "border-emerald-200 bg-emerald-50"
                            : entry.required ? "border-amber-200 bg-amber-50"
                            : "border-slate-200 bg-white"
                        }`}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/intake-key", entry.key);
                          event.dataTransfer.effectAllowed = "copy";
                          onPlace(entry);
                        }}
                        onClick={() => onJump(entry)}
                      >
                        <span className="block font-semibold text-slate-800">{entry.easyLabel}</span>
                        <span className="block text-[10px] text-slate-500">{entry.key} · {mapped ? "mapped" : entry.required ? "required · unmapped" : "unmapped"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function QualityPanel({ health, onJump }: { health: MappingHealth; onJump: (key: string) => void }) {
  return (
    <div className={`mb-3 rounded-lg border p-3 text-sm ${health.ready ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>
      <p className="font-semibold">Mapping score: {health.score}/100 {health.ready ? "- ready for master approval" : "- missing required fields"}</p>
      <p className="mt-1 text-xs">{health.counts.fields} fields, {health.counts.signatures} signature fields, {health.counts.pagesWithFields} pages with mappings.</p>
      {health.missingRequired?.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-semibold">Missing required</p>
          <ul className="mt-1 space-y-1">
            {health.missingRequired.slice(0, 12).map((item) => (
              <li key={item.key}>
                <button type="button" className="text-xs font-semibold underline" onClick={() => onJump(item.key)}>
                  {item.label}
                </button>
                <span className="text-xs"> · {item.section}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {health.blockingIssues.length > 0 && health.missingRequired?.length === 0 && (
        <p className="mt-2 text-xs"><b>Blocking:</b> {health.blockingIssues.slice(0, 5).join(" ")}</p>
      )}
      {health.warnings.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-semibold">{health.warnings.length} warning{health.warnings.length === 1 ? "" : "s"}</summary>
          <ul className="mt-1 list-disc pl-4">
            {health.warnings.slice(0, 8).map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
