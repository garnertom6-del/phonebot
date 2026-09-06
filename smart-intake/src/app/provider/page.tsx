import { redirect } from "next/navigation";
import PortalLoginForm from "@/components/PortalLoginForm";
import { currentUser } from "@/lib/auth";
import { loginDestination, safeStaffReturnPath } from "@/lib/safeReturnPath";
import { isMasterUser } from "@/lib/staffGuard";

export default async function ProviderPortalPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const query = await searchParams;
  const returnTo = safeStaffReturnPath(typeof query.next === "string" ? query.next : null);
  const user = await currentUser();
  if (user) {
    redirect(loginDestination({
      isMaster: isMasterUser(user),
      portal: "provider",
      requested: returnTo,
      defaultDestination: "/dashboard",
    }));
  }
  return <PortalLoginForm portal="provider" returnTo={returnTo || undefined} />;
}
