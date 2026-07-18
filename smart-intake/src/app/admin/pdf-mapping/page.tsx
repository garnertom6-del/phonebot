"use client";
import Link from "next/link";
import dynamic from "next/dynamic";

const PdfFieldMapper = dynamic(() => import("@/components/PdfFieldMapper"), { ssr: false });

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default function PdfMappingPage({
  searchParams,
}: {
  searchParams?: { providerId?: string | string[]; templateId?: string | string[] };
}) {
  const providerId = firstParam(searchParams?.providerId);
  const templateId = firstParam(searchParams?.templateId);
  const providerMode = !!providerId || !!templateId;
  const dashboardHref = providerMode
    ? `/master/dashboard${providerId ? `?providerId=${encodeURIComponent(providerId)}` : ""}`
    : "/dashboard";

  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <Link href={dashboardHref} className="text-sm text-brand hover:underline">{providerMode ? "Back to Master dashboard" : "Dashboard"}</Link>
      <h1 className="mb-1 mt-1 text-2xl font-bold">
        PDF Field Mapping{providerMode ? " - Provider Packet" : " - Moore Divine Care Client Intake Package"}
      </h1>
      <p className="mb-4 text-sm text-slate-500">
        {providerMode
          ? "Map the selected provider's uploaded packet. These placements are saved only for that provider template."
          : "The base map was generated from the actual PDF. Adjustments here are saved as default packet overrides."}
      </p>
      <PdfFieldMapper providerId={providerId} templateId={templateId} />
    </main>
  );
}
