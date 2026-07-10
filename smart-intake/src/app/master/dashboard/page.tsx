"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type ProviderRow = {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "INACTIVE" | string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  createdAt: string;
  _count: { clients: number; intakes: number; memberships: number };
  memberships: Array<{
    id: string;
    role: string;
    active: boolean;
    user: { id: string; email: string; name: string; role: string };
  }>;
};

const EMPTY_FORM = {
  name: "",
  slug: "",
  contactName: "",
  email: "",
  phone: "",
  adminName: "",
  adminEmail: "",
  adminPassword: "",
};

export default function MasterDashboard() {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/master/providers");
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Provider load failed (${res.status})`);
      setProviders(body.providers || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load providers.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  function updateField(key: keyof typeof EMPTY_FORM, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function createProvider(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/master/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Provider could not be created.");
      setForm(EMPTY_FORM);
      setNote(`Created ${body.provider?.name || "provider dashboard"}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provider could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function setProviderStatus(provider: ProviderRow, status: "ACTIVE" | "INACTIVE") {
    setError("");
    setNote("");
    const res = await fetch(`/api/master/providers/${provider.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || "Provider status could not be changed.");
      return;
    }
    setNote(`${provider.name} is now ${status.toLowerCase()}.`);
    await load();
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand">Master Dashboard</h1>
          <p className="text-sm text-slate-500">Provider access and security administration</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard" className="btn-ghost">Intake dashboard</Link>
          <a href="/api/admin/backup" className="btn-ghost">Download backup</a>
          <button className="btn-secondary" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); }}>Sign out</button>
        </div>
      </div>

      {note && <p className="mb-3 rounded-lg bg-emerald-50 p-2 text-sm font-semibold text-emerald-700">{note}</p>}
      {error && <p className="mb-3 rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-700">{error}</p>}

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-bold">Create Provider Dashboard</h2>
        <form onSubmit={createProvider} className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <label className="lg:col-span-2">
            <span className="label">Provider name *</span>
            <input className="input" value={form.name} onChange={(e) => updateField("name", e.target.value)} />
          </label>
          <label>
            <span className="label">Slug</span>
            <input className="input" value={form.slug} onChange={(e) => updateField("slug", e.target.value)} placeholder="provider-name" />
          </label>
          <label>
            <span className="label">Provider phone</span>
            <input className="input" value={form.phone} onChange={(e) => updateField("phone", e.target.value)} />
          </label>
          <label>
            <span className="label">Contact name</span>
            <input className="input" value={form.contactName} onChange={(e) => updateField("contactName", e.target.value)} />
          </label>
          <label>
            <span className="label">Provider email</span>
            <input className="input" type="email" value={form.email} onChange={(e) => updateField("email", e.target.value)} />
          </label>
          <label>
            <span className="label">Admin name</span>
            <input className="input" value={form.adminName} onChange={(e) => updateField("adminName", e.target.value)} />
          </label>
          <label>
            <span className="label">Admin email *</span>
            <input className="input" type="email" value={form.adminEmail} onChange={(e) => updateField("adminEmail", e.target.value)} />
          </label>
          <label>
            <span className="label">Admin password *</span>
            <input className="input" type="password" value={form.adminPassword} onChange={(e) => updateField("adminPassword", e.target.value)} />
          </label>
          <div className="flex items-end">
            <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating..." : "Create provider"}</button>
          </div>
        </form>
      </section>

      <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {["Provider", "Status", "Provider admin", "Clients", "Intakes", "Users", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="p-6 text-center text-slate-400">Loading...</td></tr>}
            {!loading && providers.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">No providers yet.</td></tr>}
            {providers.map((provider) => {
              const admins = provider.memberships
                .filter((membership) => membership.active && membership.role === "PROVIDER_ADMIN")
                .map((membership) => membership.user.email);
              const active = provider.status === "ACTIVE";
              return (
                <tr key={provider.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-slate-900">{provider.name}</div>
                    <div className="text-xs text-slate-500">{provider.slug}</div>
                    {(provider.email || provider.phone) && (
                      <div className="mt-1 text-xs text-slate-500">{[provider.email, provider.phone].filter(Boolean).join(" | ")}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                      {active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">{admins.length ? admins.join(", ") : "-"}</td>
                  <td className="px-4 py-3">{provider._count.clients}</td>
                  <td className="px-4 py-3">{provider._count.intakes}</td>
                  <td className="px-4 py-3">{provider._count.memberships}</td>
                  <td className="px-4 py-3">
                    <button
                      className={active ? "btn-ghost px-3 py-1.5 text-xs" : "btn-secondary px-3 py-1.5 text-xs"}
                      onClick={() => void setProviderStatus(provider, active ? "INACTIVE" : "ACTIVE")}
                    >
                      {active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </main>
  );
}
