import { redirect } from "next/navigation";
import PortalAccountSwitch from "@/components/PortalAccountSwitch";
import PortalLoginForm from "@/components/PortalLoginForm";
import { currentUser } from "@/lib/auth";
import { isMasterUser } from "@/lib/staffGuard";

export default async function MasterPortalPage() {
  const user = await currentUser();
  if (user && isMasterUser(user)) redirect("/master/dashboard");
  if (user) return <PortalAccountSwitch />;
  return <PortalLoginForm portal="master" />;
}
