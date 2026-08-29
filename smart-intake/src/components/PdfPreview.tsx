"use client";

import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useCallback, useEffect, useRef, useState } from "react";

type PreviewState = "loading" | "ready" | "error";

function responseError(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

export default function PdfPreview({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [state, setState] = useState<PreviewState>("loading");
  const [error, setError] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [documentState, setDocumentState] = useState("DRAFT_PREVIEW");

  useEffect(() => {
    let cancelled = false;
    let loadedPdf: PDFDocumentProxy | null = null;

    async function loadPdf() {
      setState("loading");
      setError("");
      setPageCount(0);
      setPageNumber(1);
      try {
        const [pdfjs, response] = await Promise.all([
          import("pdfjs-dist"),
          fetch(src, { cache: "no-store", credentials: "same-origin" }),
        ]);
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(responseError(body, `Preview request failed (${response.status}).`));
        }
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.toLowerCase().includes("application/pdf")) {
          throw new Error("The preview service did not return a PDF.");
        }
        setDocumentState(response.headers.get("x-smart-intake-document-state") || "DRAFT_PREVIEW");
        const data = new Uint8Array(await response.arrayBuffer());
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        loadedPdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled) {
          await loadedPdf.destroy();
          return;
        }
        pdfRef.current = loadedPdf;
        setPageCount(loadedPdf.numPages);
        setState("ready");
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "The PDF preview could not be loaded.");
        setState("error");
      }
    }

    void loadPdf();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      if (pdfRef.current === loadedPdf) pdfRef.current = null;
      if (loadedPdf) void loadedPdf.destroy();
    };
  }, [retryKey, src]);

  const renderPage = useCallback(async () => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!pdf || !canvas || !container || state !== "ready") return;

    renderTaskRef.current?.cancel();
    setRendering(true);
    try {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(280, container.clientWidth - 24);
      const cssScale = Math.min(1.65, availableWidth / baseViewport.width);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: cssScale * pixelRatio });
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("This browser could not create the PDF drawing surface.");

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${Math.ceil(viewport.width / pixelRatio)}px`;
      canvas.style.height = `${Math.ceil(viewport.height / pixelRatio)}px`;
      const task = page.render({ canvasContext: context, viewport });
      renderTaskRef.current = task;
      await task.promise;
      if (renderTaskRef.current === task) renderTaskRef.current = null;
    } catch (cause) {
      if (cause instanceof Error && cause.name === "RenderingCancelledException") return;
      setError(cause instanceof Error ? cause.message : "This PDF page could not be rendered.");
      setState("error");
    } finally {
      setRendering(false);
    }
  }, [pageNumber, state]);

  useEffect(() => {
    if (state !== "ready") return;
    void renderPage();
    const onResize = () => { void renderPage(); };
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, [renderPage, state]);

  const goToPage = (value: number) => {
    setPageNumber(Math.min(Math.max(1, value), Math.max(pageCount, 1)));
  };

  return (
    <section aria-labelledby="pdf-preview-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div>
          <h2 id="pdf-preview-title" className="font-bold text-slate-900">Packet PDF preview</h2>
          <p className="text-xs text-slate-500">
            {documentState === "DRAFT_PREVIEW" ? "Draft preview — generation locks the final packet version." : "Current locked packet version."}
          </p>
        </div>
        {state === "ready" && (
          <div className="flex flex-wrap items-center gap-2" aria-label="PDF page navigation">
            <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={pageNumber <= 1 || rendering} onClick={() => goToPage(pageNumber - 1)}>
              Previous
            </button>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              Page
              <input
                aria-label="PDF page number"
                className="input h-10 w-20 py-1 text-center"
                type="number"
                min={1}
                max={pageCount}
                value={pageNumber}
                onChange={(event) => goToPage(Number(event.target.value) || 1)}
              />
              of {pageCount}
            </label>
            <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={pageNumber >= pageCount || rendering} onClick={() => goToPage(pageNumber + 1)}>
              Next
            </button>
          </div>
        )}
      </div>

      {state === "loading" && (
        <div role="status" className="flex min-h-[55vh] items-center justify-center rounded-xl border border-slate-300 bg-white p-6 text-center text-slate-600">
          Loading the packet preview…
        </div>
      )}
      {state === "error" && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-5 text-red-900">
          <p className="font-bold">The packet preview could not be shown.</p>
          <p className="mt-1 text-sm">{error}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => setRetryKey((key) => key + 1)}>Try preview again</button>
            <a className="btn-ghost" href={src} target="_blank" rel="noreferrer">Open the PDF in a new tab</a>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className={`${state === "ready" ? "flex" : "hidden"} min-h-[60vh] justify-center overflow-auto rounded-xl border border-slate-300 bg-slate-200 p-3`}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`PDF page ${pageNumber} of ${pageCount}`}
          className="h-auto max-w-full bg-white shadow-lg"
        />
      </div>
      {state === "ready" && rendering && <p role="status" className="text-center text-sm text-slate-500">Rendering page {pageNumber}…</p>}
    </section>
  );
}
