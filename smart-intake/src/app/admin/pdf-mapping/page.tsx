"use client";
import Link from "next/link";
import dynamic from "next/dynamic";

const PdfFieldMapper = dynamic(() => import("@/components/PdfFieldMapper"), { ssr: false });

export default function PdfMappingPage() {
  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <Link href="/dashboard" className="text-sm text-brand hover:underline">← Dashboard</Link>
      <h1 className="mb-1 mt-1 text-2xl font-bold">PDF Field Mapping - Moore Divine Care Client Intake Package</h1>
      <p className="mb-4 text-sm text-slate-500">
        The base map was generated from the actual PDF (870 anchored placements). Adjust anything
        here - your changes are saved as database overrides and used the next time a packet is generated.
      </p>
      <PdfFieldMapper />
    </main>
  );
}
