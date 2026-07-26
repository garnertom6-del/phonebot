import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { isMasterUser } from "@/lib/staffGuard";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  redirect(isMasterUser(user) ? "/master/dashboard" : "/dashboard");
}
