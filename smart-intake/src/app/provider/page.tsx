import { redirect } from "next/navigation";
import PortalLoginForm from "@/components/PortalLoginForm";
import { currentUser } from "@/lib/auth";

export default async function ProviderPortalPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const query = await searchParams;
  const returnTo = query.next === "/nctracks" ? "/nctracks" : undefined;
  const user = await currentUser();
  if (user) redirect(returnTo || "/dashboard");
  return <PortalLoginForm portal="provider" returnTo={returnTo} />;
}
