import Link from "next/link";
import { redirect } from "next/navigation";
import InstallApp from "@/components/InstallApp";
import { currentUser } from "@/lib/auth";
import { isMasterUser } from "@/lib/staffGuard";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(isMasterUser(user) ? "/master/dashboard" : "/dashboard");

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <section className="card w-full max-w-md">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">Smart Intake</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Where do you need to work?</h1>
        <p className="mb-6 mt-2 text-sm text-slate-600">Choose the job you need to do.</p>
        <div className="grid gap-4">
          <div>
            <Link href="/provider" className="btn-primary w-full text-center">
              Provider / Staff Dashboard
            </Link>
            <p className="mt-1.5 text-center text-xs text-slate-500">Create and manage client intakes.</p>
          </div>
          <div>
            <Link href="/master" className="btn-secondary w-full text-center">
              Master Intake Setup
            </Link>
            <p className="mt-1.5 text-center text-xs text-slate-500">Create providers and map their intake packets.</p>
          </div>
        </div>
        <div className="relative mt-4 flex justify-center">
          <InstallApp />
        </div>
      </section>
    </main>
  );
}
