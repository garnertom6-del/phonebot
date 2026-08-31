"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type ProviderSettings = {
  settingsPath: string;
  isMaster: boolean;
  membershipRole: string | null;
  provider: {
    id: string;
    name: string;
    slug: string;
    status: string;
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  packetReadiness: {
    ready: boolean;
    state: string;
    templateId: string | null;
    templateName: string | null;
    pageCount: number | null;
    message: string;
  };
  packetDisplay: {
    label: string;
    badge: string;
    detail: string;
    className: string;
    filenameWarning: string | null;
  };
  pdfTemplates: Array<{
    id: string;
    name: string;
    originalFileName?: string | null;
    pageCount: number;
    isActive: boolean;
    mappingStatus: string;
    mappingScore?: number | null;
  }>;
  memberships: Array<{
    id: string;
    role: string;
    active: boolean;
    user: { id: string; email: string; name: string; role: string };
  }>;
};

export default function ProviderSettingsPage() {
  const [data, setData] = useState<ProviderSettings | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const requested = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("providerId")
      : null;
    const url = requested
      ? `/api/provider/settings?providerId=${encodeURIComponent(requested)}`
      : "/api/provider/settings";
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    setStatus(response.status);
    if (response.status === 401) {
      window.location.assign("/login");
      return;
    }
    if (!response.ok) {
      setError(body.error || "Provider settings are not available.");
      setData(null);
      setLoading(false);
      return;
    }
    setData(body);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading && !data && !error) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-slate-500">Loading provider settings...</p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section className="card" role="alert">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Provider settings</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Access denied</h1>
          <p className="mt-3 text-sm text-slate-600">{error || "You cannot open this provider's settings."}</p>
          {status ? <p className="mt-2 text-xs text-slate-500">HTTP {status}</p> : null}
          <Link href="/dashboard" className="btn-primary mt-4 inline-flex">Back to intake dashboard</Link>
        </section>
      </main>
    );
  }

  const { provider, packetReadiness, packetDisplay, memberships } = data;
  const activeStaff = memberships.filter((membership) => membership.active);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">Provider settings</p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{provider.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Settings for your provider workspace only. Creating providers and mapping every packet stays on the master dashboard.
          </p>
        </div>
        <Link href="/dashboard" className="btn-ghost">Intake dashboard</Link>
      </div>

      <section className="card mt-5">
        <h2 className="text-lg font-bold text-brand">Workspace</h2>
        <dl className="mt-3 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
          <div><dt className="text-xs font-semibold uppercase text-slate-500">Status</dt><dd>{provider.status}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-slate-500">Slug</dt><dd>{provider.slug}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-slate-500">Contact</dt><dd>{provider.contactName || "—"}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-slate-500">Email</dt><dd>{provider.email || "—"}</dd></div>
          <div><dt className="text-xs font-semibold uppercase text-slate-500">Phone</dt><dd>{provider.phone || "—"}</dd></div>
        </dl>
      </section>

      <section className="card mt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-brand">Intake packet</h2>
            <p className="mt-1 text-sm text-slate-600">{packetReadiness.message}</p>
          </div>
          <span className={`badge ${packetDisplay.className}`}>{packetDisplay.badge}</span>
        </div>
        {packetDisplay.filenameWarning && (
          <p className="mt-2 text-sm font-semibold text-amber-800">{packetDisplay.filenameWarning}</p>
        )}
        <p className="mt-2 text-sm text-slate-700">
          {packetReadiness.templateName || "No packet uploaded"}
          {packetReadiness.pageCount ? ` · ${packetReadiness.pageCount} pages` : ""}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/admin/pdf-mapping?providerId=${encodeURIComponent(provider.id)}${packetReadiness.templateId ? `&templateId=${encodeURIComponent(packetReadiness.templateId)}` : ""}`}
            className="btn-secondary"
          >
            Open packet mapping
          </Link>
          <Link href="/admin/users" className="btn-ghost">Manage staff</Link>
        </div>
      </section>

      <section className="card mt-4">
        <h2 className="text-lg font-bold text-brand">Staff</h2>
        <ul className="mt-3 space-y-2">
          {activeStaff.map((membership) => (
            <li key={membership.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <p className="font-semibold text-slate-900">{membership.user.name || membership.user.email}</p>
              <p className="text-slate-600">{membership.user.email} · {membership.role.replaceAll("_", " ")}</p>
            </li>
          ))}
          {activeStaff.length === 0 && <li className="text-sm text-slate-500">No active staff on this provider.</li>}
        </ul>
      </section>
    </main>
  );
}
