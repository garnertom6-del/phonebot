import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staffGuard";
import PlanBenefitDirectory from "@/components/PlanBenefitDirectory";

export const dynamic = "force-dynamic";

export default async function DirectoryPage(props: { searchParams: Promise<{ providerId?: string }> }) {
  const query = await props.searchParams;
  const { user, provider, deny } = await requireStaff({ providerId: query.providerId });
  if (!user) redirect("/login");
  if (deny || !provider) return <main className="p-6">This provider directory is not available to your account.</main>;
  return <PlanBenefitDirectory key={provider.id} providerId={provider.id} />;
}
