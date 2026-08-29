"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import PdfPreview from "@/components/PdfPreview";
import { messageForPdfPreviewFailure, parsePdfPreviewErrorBody } from "@/lib/pdfPreviewError";

export default function PdfPreviewPage({ params }: { params: { id: string } }) {
  const [bust, setBust] = useState(0);
  const [pdfUrl, setPdfUrl] = useState("");
  const [warning, setWarning] = useState("");
  const [failure, setFailure] = useState<{ title: string; detail: string; backHref: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const src = `/api/intakes/${params.id}/pdf?preview=1&t=${bust}`;
    let cancelled = false;
    let objectUrl = "";
    setLoading(true);
    setFailure(null);
    setWarning("");
    setPdfUrl("");
    void (async () => {
      try {
        const response = await fetch(src, { cache: "no-store" });
        const buffer = await response.arrayBuffer();
        if (cancelled) return;
        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !contentType.includes("pdf")) {
          const text = new TextDecoder().decode(buffer);
          setFailure(messageForPdfPreviewFailure(
            response.status,
            parsePdfPreviewErrorBody(text),
            params.id,
          ));
          return;
        }
        const fillWarnings = Number(response.headers.get("X-Smart-Intake-Fill-Warnings") || 0);
        if (fillWarnings > 0) {
          setWarning(`${fillWarnings} field${fillWarnings === 1 ? "" : "s"} could not be drawn and ${fillWarnings === 1 ? "was" : "were"} left blank. The rest of the packet is shown below.`);
        }
        objectUrl = URL.createObjectURL(new Blob([buffer], { type: "application/pdf" }));
        setPdfUrl(objectUrl);
      } catch {
        if (!cancelled) {
          setFailure(messageForPdfPreviewFailure(500, { error: "The packet preview could not be loaded." }, params.id));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [params.id, bust]);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-3 flex items-center justify-between">
        <Link href={`/intakes/${params.id}`} className="text-sm text-brand hover:underline">Back to intake</Link>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setBust(Date.now())}>Refresh</button>
          {pdfUrl && <a className="btn-primary" href={pdfUrl} download>Download shown PDF</a>}
        </div>
      </div>
      {failure ? (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-950" role="alert">
          <h1 className="text-xl font-bold">{failure.title}</h1>
          <p className="mt-2 text-sm leading-6">{failure.detail}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={failure.backHref} className="btn-primary">Back to intake</Link>
            <button className="btn-ghost" onClick={() => setBust(Date.now())}>Try again</button>
          </div>
        </section>
      ) : (
        <>
          {warning && (
            <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-950" role="status">
              {warning}
            </p>
          )}
          {loading && !pdfUrl ? (
            <p className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">Loading packet preview...</p>
          ) : pdfUrl ? (
            <PdfPreview src={pdfUrl} />
          ) : null}
        </>
      )}
    </main>
  );
}
