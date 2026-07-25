"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import InstallApp from "@/components/InstallApp";

type Portal = "provider" | "master";

const PORTAL_COPY: Record<Portal, {
  eyebrow: string;
  title: string;
  description: string;
  button: string;
  otherHref: string;
  otherLabel: string;
}> = {
  provider: {
    eyebrow: "Provider portal",
    title: "Provider / Staff Sign In",
    description: "For company administrators, qualified professionals, clinicians, and staff.",
    button: "Open provider dashboard",
    otherHref: "/master",
    otherLabel: "Master Administrator Sign In",
  },
  master: {
    eyebrow: "Master controls",
    title: "Master Administrator Sign In",
    description: "For managing provider companies, access, intake packets, and system settings.",
    button: "Open master dashboard",
    otherHref: "/provider",
    otherLabel: "Provider / Staff Sign In",
  },
};

export default function PortalLoginForm({ portal }: { portal: Portal }) {
  const router = useRouter();
  const copy = PORTAL_COPY[portal];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Login failed");
        return;
      }

      const destination = body.destination || "/dashboard";
      router.push(portal === "provider" && destination === "/master/dashboard" ? "/dashboard" : destination);
    } catch {
      setError("Sign in could not be completed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-md">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">{copy.eyebrow}</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{copy.title}</h1>
        <p className="mb-6 mt-2 text-sm text-slate-600">{copy.description}</p>

        <label className="label" htmlFor={`${portal}-email`}>Email</label>
        <input
          id={`${portal}-email`}
          className="input mb-4"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
        <label className="label" htmlFor={`${portal}-password`}>Password</label>
        <input
          id={`${portal}-password`}
          className="input mb-4"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && <p role="alert" className="mb-3 text-sm font-medium text-red-700">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Signing in..." : copy.button}
        </button>

        <div className="mt-5 border-t border-slate-200 pt-4 text-center">
          <p className="text-xs text-slate-500">Looking for the other dashboard?</p>
          <Link href={copy.otherHref} className="mt-2 inline-flex font-semibold text-brand hover:underline">
            {copy.otherLabel}
          </Link>
          <div className="relative mt-4 flex justify-center">
            <InstallApp />
          </div>
        </div>
      </form>
    </main>
  );
}
