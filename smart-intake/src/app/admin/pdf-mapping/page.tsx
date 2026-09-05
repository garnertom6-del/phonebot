import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { isMasterUser } from "@/lib/staffGuard";
import PdfMappingEditor from "@/components/PdfMappingEditor";

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PdfMappingPage(
  props: {
    searchParams: Promise<{ providerId?: string | string[]; templateId?: string | string[] }>;
  }
) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!isMasterUser(user)) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section className="card">
          <h1 className="text-2xl font-bold">Packet mapping needs a master administrator</h1>
          <p className="mt-3 text-sm text-slate-600">Your provider workspace remains available. Ask your master administrator to upload, map, and approve your provider packet.</p>
          <Link href="/provider/settings" className="btn-primary mt-4 inline-flex">Back to provider settings</Link>
          <Link href="/dashboard" className="btn-ghost ml-2">Intake dashboard</Link>
        </section>
      </main>
    );
  }
  const searchParams = await props.searchParams;
  const providerId = firstParam(searchParams?.providerId);
  const templateId = firstParam(searchParams?.templateId);
  const providerMode = !!providerId || !!templateId;
  const dashboardHref = providerMode
    ? `/master/dashboard${providerId ? `?providerId=${encodeURIComponent(providerId)}` : ""}`
    : "/dashboard";

  return (
    <main className="mx-auto max-w-[1800px] p-6">
      <Link href={dashboardHref} className="text-sm text-brand hover:underline">{providerMode ? "Back to Master intake setup" : "Dashboard"}</Link>
      <h1 className="mb-1 mt-1 text-2xl font-bold">
        PDF Field Mapping{providerMode ? " - Provider Packet" : " - Moore Divine Care Client Intake Package"}
      </h1>
      <p className="mb-4 text-sm text-slate-500">
        {providerMode
          ? "Map the selected provider's uploaded packet. These placements are saved only for that provider template."
          : "The base map was generated from the actual PDF. Adjustments here are saved as default packet overrides."}
      </p>
      <PdfMappingEditor providerId={providerId} templateId={templateId} />
    </main>
  );
}
