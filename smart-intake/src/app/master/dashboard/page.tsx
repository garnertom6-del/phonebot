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
  pdfTemplates: Array<{
    id: string;
    name: string;
    originalFileName?: string | null;
    pageCount: number;
    pageWidth?: number | null;
    pageHeight?: number | null;
    isActive: boolean;
    mappingStatus: string;
    mappingScore?: number | null;
    mappingIssues?: string | null;
    approvedAt?: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
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

function providerSearchText(provider: ProviderRow) {
  const admins = provider.memberships
    .filter((membership) => membership.active && membership.role === "PROVIDER_ADMIN")
    .map((membership) => membership.user.email)
    .join(" ");

  return [
    provider.name,
    provider.slug,
    provider.contactName,
    provider.email,
    provider.phone,
    admins,
    provider.pdfTemplates.map((template) => template.originalFileName).join(" "),
  ].join(" ").toLowerCase();
}

export default function MasterDashboard() {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [isMaster, setIsMaster] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [packetFile, setPacketFile] = useState<File | null>(null);
  const [packetBusy, setPacketBusy] = useState(false);
  const [packetActionBusy, setPacketActionBusy] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [adminForm, setAdminForm] = useState({ name: "", email: "", password: "" });
  const [adminBusy, setAdminBusy] = useState(false);
  const [contextBusyProviderId, setContextBusyProviderId] = useState("");
  const [statusBusyProviderId, setStatusBusyProviderId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/master/providers");
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      if (response.status === 403) {
        router.push("/dashboard");
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Provider load failed (${response.status})`);
      const loadedProviders = body.providers || [];
      setProviders(loadedProviders);
      setIsMaster(!!body.isMaster);
      setAiConfigured(!!body.aiConfigured);
      setSelectedProviderId((current) => {
        if (current && loadedProviders.some((provider: ProviderRow) => provider.id === current)) return current;
        return loadedProviders.length === 1 ? loadedProviders[0].id : "";
      });
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

  async function createProvider(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNote("");
    try {
      const response = await fetch("/api/master/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Provider could not be created.");
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
    setStatusBusyProviderId(provider.id);
    setError("");
    setNote("");
    try {
      const response = await fetch(`/api/master/providers/${provider.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || "Provider status could not be changed.");
        return;
      }
      setNote(`${provider.name} is now ${status.toLowerCase()}.`);
      await load();
    } catch {
      setError("Provider status could not be changed. Check the connection and try again.");
    } finally {
      setStatusBusyProviderId("");
    }
  }

  async function uploadPacket(event: React.FormEvent) {
    event.preventDefault();
    const provider = providers.find((item) => item.id === selectedProviderId);
    if (!provider) {
      setError("Select a provider first.");
      return;
    }
    if (!packetFile) {
      setError("Choose a PDF packet to upload.");
      return;
    }

    setPacketBusy(true);
    setError("");
    setNote("");
    try {
      const formData = new FormData();
      formData.append("file", packetFile);
      const response = await fetch(`/api/master/providers/${provider.id}/packet-template`, {
        method: "POST",
        body: formData,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Packet could not be uploaded.");
      setPacketFile(null);
      setFileInputKey((current) => current + 1);
      setNote(`${provider.name} packet uploaded as a review draft: ${body.template?.originalFileName || "uploaded PDF"}. Map and quality-check it before approval.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Packet could not be uploaded.");
    } finally {
      setPacketBusy(false);
    }
  }

  async function approvePacket(templateId: string) {
    const provider = selectedProvider;
    if (!provider) return;
    setPacketActionBusy(templateId);
    setError("");
    setNote("Checking the packet map before approval...");
    try {
      const response = await fetch(`/api/master/providers/${provider.id}/packet-template/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const blocking = Array.isArray(body.health?.blockingIssues) ? body.health.blockingIssues.slice(0, 3).join(" ") : "";
        setError(`${body.error || "Packet approval failed."}${blocking ? ` ${blocking}` : ""}`);
        return;
      }
      setNote(`Packet approved with a ${body.health?.score ?? "completed"}/100 mapping score. It is now the provider's active packet.`);
      await load();
    } catch {
      setError("Packet approval could not connect. Check the mapping and try again.");
    } finally {
      setPacketActionBusy("");
    }
  }

  async function activatePacket(templateId: string) {
    const provider = selectedProvider;
    if (!provider) return;
    setPacketActionBusy(templateId);
    setError("");
    try {
      const response = await fetch(`/api/master/providers/${provider.id}/packet-template/activate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error || "Packet could not be activated.");
        return;
      }
      setNote("The selected approved packet is now active. The previous packet remains available in history.");
      await load();
    } catch {
      setError("Packet activation could not connect. Check the connection and try again.");
    } finally {
      setPacketActionBusy("");
    }
  }

  async function saveProviderAdmin(event: React.FormEvent) {
    event.preventDefault();
    const provider = providers.find((item) => item.id === selectedProviderId);
    if (!provider) {
      setError("Select a provider first.");
      return;
    }
    setAdminBusy(true);
    setError("");
    setNote("");
    try {
      const response = await fetch(`/api/master/providers/${provider.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminName: adminForm.name,
          adminEmail: adminForm.email,
          adminPassword: adminForm.password,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Provider administrator could not be saved.");
      setAdminForm({ name: "", email: "", password: "" });
      setNote(`${provider.name} administrator access is ready.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provider administrator could not be saved.");
    } finally {
      setAdminBusy(false);
    }
  }

  async function openProviderDashboard(providerId: string) {
    if (!providerId) {
      setError("Select a provider first.");
      return;
    }
    setContextBusyProviderId(providerId);
    setError("");
    try {
      const response = await fetch("/api/provider-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Provider dashboard could not be opened.");
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provider dashboard could not be opened.");
    } finally {
      setContextBusyProviderId("");
    }
  }

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) || null;
  const selectedTemplate = selectedProvider?.pdfTemplates?.[0] || null;
  const trimmedSearch = search.trim().toLowerCase();
  const filteredProviders = providers.filter((provider) => !trimmedSearch || providerSearchText(provider).includes(trimmedSearch));

  const activeCount = providers.filter((provider) => provider.status === "ACTIVE").length;
  const inactiveCount = providers.filter((provider) => provider.status !== "ACTIVE").length;
  const customPacketCount = providers.filter((provider) => provider.pdfTemplates.length > 0).length;
  const totalIntakes = providers.reduce((sum, provider) => sum + provider._count.intakes, 0);
  const totalMemberships = providers.reduce((sum, provider) => sum + provider._count.memberships, 0);

  return (
    <main className="mx-auto max-w-7xl p-6">
      <section className="overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-900 via-brand-dark to-brand px-6 py-7 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-light/90">{isMaster ? "Master Controls" : "Provider Settings"}</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">{isMaster ? "Provider Master Dashboard" : "Provider Packet Dashboard"}</h1>
            <p className="mt-2 text-sm text-slate-200">
              {isMaster
                ? "Create provider workspaces, control who is active, and manage the packet PDF each provider uses for previews, downloads, and DocuSign."
                : "Manage the intake packet PDF your provider uses for previews, downloads, and DocuSign."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isMaster ? (
              <button
                className="btn-ghost border-white/30 bg-white/10 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!selectedProviderId || !!contextBusyProviderId}
                onClick={() => void openProviderDashboard(selectedProviderId)}
              >
                {contextBusyProviderId ? "Opening intakes..." : selectedProvider ? `Open ${selectedProvider.name} intakes` : "Choose a provider"}
              </button>
            ) : (
              <Link href="/dashboard" className="btn-ghost border-white/30 bg-white/10 text-white hover:bg-white/20">Intake dashboard</Link>
            )}
            {isMaster && <a href="/api/admin/backup" className="btn-ghost border-white/30 bg-white/10 text-white hover:bg-white/20">Download backup</a>}
            <button
              className="btn-secondary bg-white/15 text-white hover:bg-white/25"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" });
                router.push("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-7">
          <StatCard label="Providers" value={providers.length} />
          <StatCard label="Active" value={activeCount} />
          <StatCard label="Inactive" value={inactiveCount} />
          <StatCard label="Custom packets" value={customPacketCount} />
          <StatCard label="Total intakes" value={totalIntakes} />
          <StatCard label="Staff users" value={totalMemberships} />
          <StatCard label="AI preflight" value={aiConfigured ? "ON" : "OFF"} />
        </div>
      </section>

      {isMaster && (
        <section className={`mt-4 rounded-2xl border p-4 shadow-sm ${
          aiConfigured ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">System AI for provider intake reviews</h2>
              <p className="mt-1 text-sm text-slate-600">
                {aiConfigured
                  ? "Connected. Providers use their normal portal login; they do not need separate AI accounts."
                  : "Not configured. Providers can still use automatic checks, but AI suggestions require the system AI key."}
              </p>
            </div>
            <span className={`badge ${aiConfigured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              {aiConfigured ? "Connected" : "Needs setup"}
            </span>
          </div>
        </section>
      )}

      {note && <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{note}</p>}
      {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</p>}

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Find and manage providers</h2>
            <p className="text-sm text-slate-500">Search by provider name, slug, contact details, admin email, or packet file name.</p>
          </div>
          <p className="text-sm text-slate-500">
            Showing <span className="font-semibold text-slate-700">{filteredProviders.length}</span> of{" "}
            <span className="font-semibold text-slate-700">{providers.length}</span>
          </p>
        </div>
        <input
          className="input mt-4"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search provider, slug, contact, admin email, or packet name"
        />
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="space-y-5">
          {isMaster && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-bold">Create Provider Dashboard</h2>
              <form onSubmit={createProvider} className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <label className="lg:col-span-2">
                  <span className="label">Provider name *</span>
                  <input className="input" value={form.name} onChange={(event) => updateField("name", event.target.value)} />
                </label>
                <label>
                  <span className="label">Slug</span>
                  <input className="input" value={form.slug} onChange={(event) => updateField("slug", event.target.value)} placeholder="provider-name" />
                </label>
                <label>
                  <span className="label">Provider phone</span>
                  <input className="input" value={form.phone} onChange={(event) => updateField("phone", event.target.value)} />
                </label>
                <label>
                  <span className="label">Contact name</span>
                  <input className="input" value={form.contactName} onChange={(event) => updateField("contactName", event.target.value)} />
                </label>
                <label>
                  <span className="label">Provider email</span>
                  <input className="input" type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} />
                </label>
                <label>
                  <span className="label">Admin name</span>
                  <input className="input" value={form.adminName} onChange={(event) => updateField("adminName", event.target.value)} />
                </label>
                <label>
                  <span className="label">Admin email *</span>
                  <input className="input" type="email" value={form.adminEmail} onChange={(event) => updateField("adminEmail", event.target.value)} />
                </label>
                <label>
                  <span className="label">Admin password *</span>
                  <input className="input" type="password" value={form.adminPassword} onChange={(event) => updateField("adminPassword", event.target.value)} />
                </label>
                <div className="flex items-end">
                  <button className="btn-primary w-full" disabled={busy}>{busy ? "Creating..." : "Create provider"}</button>
                </div>
              </form>
            </section>
          )}

          {isMaster && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold">Provider Administrator Access</h2>
              <p className="mt-1 text-sm text-slate-500">Create or reset the sign-in for an existing provider dashboard.</p>
              <form onSubmit={saveProviderAdmin} className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                <label>
                  <span className="label">Provider</span>
                  <select className="input" value={selectedProviderId} onChange={(event) => setSelectedProviderId(event.target.value)}>
                    <option value="">Select provider</option>
                    {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                  </select>
                </label>
                <label>
                  <span className="label">Administrator name</span>
                  <input className="input" value={adminForm.name}
                    onChange={(event) => setAdminForm((current) => ({ ...current, name: event.target.value }))} />
                </label>
                <label>
                  <span className="label">Administrator email *</span>
                  <input className="input" type="email" required value={adminForm.email}
                    onChange={(event) => setAdminForm((current) => ({ ...current, email: event.target.value }))} />
                </label>
                <label>
                  <span className="label">New password *</span>
                  <input className="input" type="password" required minLength={8} value={adminForm.password}
                    onChange={(event) => setAdminForm((current) => ({ ...current, password: event.target.value }))} />
                </label>
                <button className="btn-primary lg:col-span-2" disabled={adminBusy || !selectedProviderId}>
                  {adminBusy ? "Saving..." : "Create / reset provider administrator"}
                </button>
              </form>
            </section>
          )}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-bold">Provider list</h2>
              <p className="text-sm text-slate-500">Open a provider&apos;s intake workspace, activate or deactivate access, and manage its packet.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    {["Provider", "Status", "Provider admin", "Packet", "Clients", "Intakes", "Users", "Actions"].map((heading) => (
                      <th key={heading} className="px-4 py-3">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={8} className="p-6 text-center text-slate-400">Loading...</td></tr>}
                  {!loading && !error && filteredProviders.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-400">No providers match this search.</td></tr>}
                  {filteredProviders.map((provider) => {
                    const admins = provider.memberships
                      .filter((membership) => membership.active && membership.role === "PROVIDER_ADMIN")
                      .map((membership) => membership.user.email);
                    const active = provider.status === "ACTIVE";
                    const packet = provider.pdfTemplates?.[0] || null;

                    return (
                      <tr key={provider.id} className={`border-t border-slate-100 ${selectedProviderId === provider.id ? "bg-brand-light/20" : "hover:bg-slate-50"}`}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{provider.name}</div>
                          <div className="text-xs text-slate-500">{provider.slug}</div>
                          {(provider.email || provider.phone) && (
                            <div className="mt-1 text-xs text-slate-500">{[provider.email, provider.phone].filter(Boolean).join(" • ")}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`badge ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                            {active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">{admins.length ? admins.join(", ") : "-"}</td>
                        <td className="px-4 py-3 text-xs">
                          {packet ? (
                            <div>
                              <div className="font-semibold text-slate-700">{packet.originalFileName || "Provider packet"}</div>
                              <div className="text-slate-500">{packet.pageCount} pages</div>
                              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${packet.isActive ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                                {packet.isActive ? "Active" : packet.mappingStatus === "APPROVED" ? "Approved history" : "Draft - needs review"}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-500">Default packet</span>
                          )}
                        </td>
                        <td className="px-4 py-3">{provider._count.clients}</td>
                        <td className="px-4 py-3">{provider._count.intakes}</td>
                        <td className="px-4 py-3">{provider._count.memberships}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              {active ? (
                                <button
                                  className="btn-primary px-3 py-1.5 text-xs"
                                  disabled={contextBusyProviderId === provider.id}
                                  onClick={() => void openProviderDashboard(provider.id)}
                                >
                                  {contextBusyProviderId === provider.id ? "Opening..." : "Open intakes"}
                                </button>
                              ) : (
                                <span className="px-3 py-1.5 text-xs text-slate-400">Inactive</span>
                              )}
                              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setSelectedProviderId(provider.id)}>
                              Packet setup
                            </button>
                            {isMaster && packet && (
                              <Link className="btn-ghost px-3 py-1.5 text-xs" href={`/admin/pdf-mapping?providerId=${provider.id}&templateId=${packet.id}`}>
                                Map packet
                              </Link>
                            )}
                            {isMaster && (
                              <button
                                type="button"
                                role="switch"
                                aria-checked={active}
                                aria-label={`${active ? "Turn off" : "Turn on"} ${provider.name} portal`}
                                title={`${active ? "Turn off" : "Turn on"} provider portal access`}
                                className={`inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-semibold transition ${
                                  active
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                    : "border-slate-300 bg-slate-100 text-slate-600"
                                }`}
                                disabled={statusBusyProviderId === provider.id}
                                onClick={() => void setProviderStatus(provider, active ? "INACTIVE" : "ACTIVE")}
                              >
                                <span className={`relative h-5 w-9 rounded-full ${active ? "bg-emerald-500" : "bg-slate-400"}`}>
                                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${active ? "left-4" : "left-0.5"}`} />
                                </span>
                                {statusBusyProviderId === provider.id ? "Updating..." : active ? "Portal on" : "Portal off"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Provider Packet Setup</h2>
              <p className="text-sm text-slate-500">Upload the intake packet PDF each provider uses for preview, download, and DocuSign.</p>
            </div>
            {selectedProvider && <span className="badge bg-slate-100 text-slate-700">{selectedProvider.name}</span>}
          </div>

          <form onSubmit={uploadPacket} className="mt-4 grid grid-cols-1 gap-4">
            <label>
              <span className="label">Provider</span>
              <select className="input" value={selectedProviderId} onChange={(event) => setSelectedProviderId(event.target.value)}>
                <option value="">Select provider</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.name}</option>
                ))}
              </select>
            </label>

            <label>
              <span className="label">Intake packet PDF</span>
              <input
                key={fileInputKey}
                className="input"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => setPacketFile(event.target.files?.[0] || null)}
              />
            </label>

            <button className="btn-primary w-full" disabled={packetBusy || !selectedProviderId}>
              {packetBusy ? "Uploading..." : "Upload packet"}
            </button>
          </form>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            {selectedProvider ? (
              selectedTemplate ? (
                <div>
                  <p className="font-semibold text-slate-800">{selectedTemplate.originalFileName || selectedTemplate.name}</p>
                  <p className="mt-1">{selectedTemplate.pageCount} pages • updated {new Date(selectedTemplate.updatedAt).toLocaleDateString()}</p>
                </div>
              ) : (
                <p>Active packet: shared default intake packet.</p>
              )
            ) : (
              <p>Select a provider to view packet status.</p>
            )}
          </div>
          {selectedProvider && selectedTemplate && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Latest upload: {selectedTemplate.originalFileName || selectedTemplate.name}</p>
              <p className="mt-1 text-xs">{selectedTemplate.pageCount} pages. {selectedTemplate.isActive ? "This is active." : "This is a review draft and is not active yet."}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link className="btn-ghost px-3 py-1.5 text-xs" href={`/admin/pdf-mapping?providerId=${selectedProvider.id}&templateId=${selectedTemplate.id}`}>
                  Open mapper
                </Link>
                {selectedTemplate.mappingStatus === "DRAFT" && (
                  <button className="btn-primary px-3 py-1.5 text-xs" disabled={packetActionBusy === selectedTemplate.id} onClick={() => void approvePacket(selectedTemplate.id)}>
                    {packetActionBusy === selectedTemplate.id ? "Checking..." : "Approve after review"}
                  </button>
                )}
              </div>
            </div>
          )}
          {selectedProvider && selectedProvider.pdfTemplates.filter((template) => template.mappingStatus === "APPROVED" && !template.isActive).length > 0 && (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Approved packet history</p>
              <div className="mt-2 space-y-2">
                {selectedProvider.pdfTemplates.filter((template) => template.mappingStatus === "APPROVED" && !template.isActive).map((template) => (
                  <div key={template.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs">
                    <span>{template.originalFileName || template.name} ({template.pageCount} pages)</span>
                    <button className="btn-ghost px-2 py-1 text-xs" disabled={packetActionBusy === template.id} onClick={() => void activatePacket(template.id)}>
                      {packetActionBusy === template.id ? "Activating..." : "Restore this packet"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
}
