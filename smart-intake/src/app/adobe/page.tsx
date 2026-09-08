import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staffGuard";
import AdobePreparation from "@/components/AdobePreparation";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ providerId?: string }> }) {
  const { providerId } = await searchParams;
  const { provider, deny } = await requireStaff({ providerId });
  if (deny || !provider) redirect(`/provider?next=${encodeURIComponent(`/adobe${providerId ? `?providerId=${encodeURIComponent(providerId)}` : ""}`)}`);
  return <AdobePreparation providerId={provider.id} />;
}
