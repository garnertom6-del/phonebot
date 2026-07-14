"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import InstallApp from "@/components/InstallApp";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) router.push(body.destination || "/dashboard");
    else setError(body.error || "Login failed");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-md">
        <h1 className="text-xl font-bold text-brand">Smart Intake</h1>
        <p className="mb-6 text-sm text-slate-500">Secure provider, staff, and master sign in</p>
        <label className="label">Email</label>
        <input className="input mb-4" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
        <label className="label">Password</label>
        <input className="input mb-4" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
        <div className="relative mt-4 flex justify-center">
          <InstallApp />
        </div>
      </form>
    </main>
  );
}
