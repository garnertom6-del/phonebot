import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staffGuard";
import NcTracksWorkspace from "@/components/NcTracksWorkspace";

export const dynamic = "force-dynamic";

export default async function NcTracksPage({ searchParams }: { searchParams: Promise<{ providerId?: string }> }) {
  const query = await searchParams;
  const { provider, membership, deny } = await requireStaff({ providerId: query.providerId });
  if (deny) {
    if (deny.status === 401) redirect("/provider?next=/nctracks");
    return <main className="mx-auto max-w-2xl p-4 sm:p-6"><h1 className="text-2xl font-bold">NCTracks lookup</h1><p className="mt-3" role="alert">This provider workspace is not available to your account.</p><Link href="/dashboard" className="btn-secondary mt-4 inline-flex min-h-11 items-center">Return to dashboard</Link></main>;
  }
  if (!provider) redirect("/dashboard");
  return <NcTracksWorkspace providerId={provider.id} providerName={provider.name} readOnly={membership?.role === "REVIEWER"} />;
}
