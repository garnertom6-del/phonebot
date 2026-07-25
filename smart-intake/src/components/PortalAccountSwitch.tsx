"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PortalAccountSwitch() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function switchToMaster() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Sign out failed");
      router.replace("/master");
      router.refresh();
    } catch {
      setError("The provider account could not be signed out. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <section className="card w-full max-w-md">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">Master intake setup</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Switch to the master account</h1>
        <p className="mt-3 text-sm text-slate-600">
          You are signed in with a provider or staff account. That account can manage client intakes, but it cannot create provider companies.
        </p>
        <button type="button" className="btn-primary mt-6 w-full" disabled={busy} onClick={switchToMaster}>
          {busy ? "Signing out..." : "Sign out and use master account"}
        </button>
        <Link href="/dashboard" className="btn-secondary mt-3 block w-full text-center">
          Return to provider dashboard
        </Link>
        {error && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{error}</p>}
      </section>
    </main>
  );
}
