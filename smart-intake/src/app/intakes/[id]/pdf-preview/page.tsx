"use client";
import Link from "next/link";
import { useState } from "react";
import PdfPreview from "@/components/PdfPreview";

export default function PdfPreviewPage({ params }: { params: { id: string } }) {
  const [bust, setBust] = useState(0);
  const src = `/api/intakes/${params.id}/pdf?preview=1&t=${bust}`;
  const downloadSrc = `/api/intakes/${params.id}/pdf?preview=1&download=1&t=${bust}`;
  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-3 flex items-center justify-between">
        <Link href={`/intakes/${params.id}`} className="text-sm text-brand hover:underline">Back to intake</Link>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setBust(Date.now())}>Refresh</button>
          <a className="btn-primary" href={downloadSrc} download>Download shown PDF</a>
        </div>
      </div>
      <PdfPreview src={src} />
    </main>
  );
}
