import { redirect } from "next/navigation";
import PortalLoginForm from "@/components/PortalLoginForm";
import { currentUser } from "@/lib/auth";

export default async function ProviderPortalPage() {
  const user = await currentUser();
  if (user) redirect("/dashboard");
  return <PortalLoginForm portal="provider" />;
}
