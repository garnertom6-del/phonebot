import { redirect } from "next/navigation";
import PortalLoginForm from "@/components/PortalLoginForm";
import { currentUser } from "@/lib/auth";
import { isMasterUser } from "@/lib/staffGuard";

export default async function MasterPortalPage() {
  const user = await currentUser();
  if (user) redirect(isMasterUser(user) ? "/master/dashboard" : "/dashboard");
  return <PortalLoginForm portal="master" />;
}
