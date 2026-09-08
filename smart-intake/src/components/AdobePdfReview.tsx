"use client";
import { useEffect, useId, useState } from "react";
import PdfPreview from "./PdfPreview";

type AdobeView = { previewFile: (file: { content: { promise: Promise<ArrayBuffer> }; metaData: { fileName: string; id: string; hasReadOnlyAccess: boolean } }, options: Record<string, unknown>) => Promise<unknown> };
declare global { interface Window { AdobeDC?: { View: new (options: { clientId: string; divId: string; sendAutoPDFAnalytics: boolean }) => AdobeView } } }
let sdkPromise: Promise<void> | undefined;
function loadAdobe() {
  if (window.AdobeDC) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const finish = (error?: Error) => {
      clearTimeout(timer);
      document.removeEventListener("adobe_dc_view_sdk.ready", ready);
      if (error) { script.remove(); sdkPromise = undefined; reject(error); } else resolve();
    };
    const ready = () => finish();
    const timer = setTimeout(() => finish(new Error("Adobe took too long to load.")), 20000);
    document.addEventListener("adobe_dc_view_sdk.ready", ready, { once: true });
    script.src = "https://acrobatservices.adobe.com/view-sdk/viewer.js";
    script.async = true;
    script.onerror = () => finish(new Error("Adobe could not be reached."));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export default function AdobePdfReview({ src, reviewId, clientId }: { src: string; reviewId: string; clientId: string | null }) {
  const id = `adobe-${useId().replace(/:/g, "")}`;
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [fallback, setFallback] = useState(!clientId);
  useEffect(() => {
    if (!clientId || fallback) return;
    let cancelled = false;
    const controller = new AbortController();
    setState("loading");
    const timer = setTimeout(() => { if (!cancelled) setState("error"); }, 45000);
    async function open() {
      try {
        await loadAdobe();
        const response = await fetch(src, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) throw new Error("Review PDF unavailable.");
        const bytes = await response.arrayBuffer();
        if (cancelled) return;
        const view = new window.AdobeDC!.View({ clientId: clientId!, divId: id, sendAutoPDFAnalytics: false });
        await view.previewFile({ content: { promise: Promise.resolve(bytes) }, metaData: { fileName: "Smart Intake review copy.pdf", id: reviewId, hasReadOnlyAccess: true } }, {
          embedMode: "FULL_WINDOW", defaultViewMode: "FIT_WIDTH", showAnnotationTools: false,
          enableFormFilling: false, showDownloadPDF: false, showPrintPDF: true, showThumbnails: true,
        });
        if (!cancelled) { clearTimeout(timer); setState("ready"); }
      } catch { if (!cancelled) { clearTimeout(timer); setState("error"); } }
    }
    void open();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); document.getElementById(id)?.replaceChildren(); };
  }, [clientId, fallback, id, reviewId, src]);
  if (fallback) return <div className="space-y-3"><p className="text-sm text-slate-600">Standard PDF viewer. Correction notes are saved in Smart Intake.</p><PdfPreview src={src} /></div>;
  return <section aria-label="Adobe PDF review" className="space-y-3">
    <a href="https://acrobat.adobe.com" target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand underline">Powered by Adobe Document Cloud</a>
    <div className="flex flex-wrap items-center justify-between gap-2"><p role="status" className="text-sm text-slate-600">{state === "ready" ? "Adobe viewer ready. Add saved corrections beside the document." : state === "loading" ? "Opening Adobe PDF viewer…" : "Adobe could not display this file. Use the standard viewer to continue."}</p><button className="btn-ghost text-sm" onClick={() => setFallback(true)}>Use standard viewer</button></div>
    <div id={id} className={`${state === "error" ? "hidden" : "block"} h-[70vh] min-h-[420px] w-full overflow-hidden rounded-xl border border-slate-200 bg-white`} />
  </section>;
}
