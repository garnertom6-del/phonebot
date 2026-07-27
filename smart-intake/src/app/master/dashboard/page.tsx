"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

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
  intakeSummary: Record<string, number>;
  currentIntakeCount: number;
  archivedIntakeCount: number;
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

type SummaryKey = "providers" | "active" | "inactive" | "packets" | "intakes" | "staff" | "ai";

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

function activeMembershipCount(provider: ProviderRow) {
  return provider.memberships.filter((membership) => membership.active).length;
}

function providerReviewQueueCount(provider: ProviderRow) {
  return (provider.intakeSummary?.NEEDS_REVIEW || 0) + (provider.intakeSummary?.SIGNED || 0);
}

function providerOpenWorkCount(provider: ProviderRow) {
  return ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED", "NEEDS_REVIEW", "SIGNED"]
    .reduce((total, key) => total + (provider.intakeSummary?.[key] || 0), 0);
}

function activePacketFor(provider: ProviderRow) {
  return provider.pdfTemplates.find((template) => template.isActive) || null;
}

function latestPacketFor(provider: ProviderRow) {
  return provider.pdfTemplates.reduce<ProviderRow["pdfTemplates"][number] | null>((latest, template) => {
    if (!latest) return template;
    return new Date(template.updatedAt).getTime() > new Date(latest.updatedAt).getTime() ? template : latest;
  }, null);
}

function packetStatus(template: ProviderRow["pdfTemplates"][number]) {
  if (template.isActive && (template.mappingStatus !== "APPROVED" || template.mappingScore == null)) {
    return {
      label: "Active - mapping unverified",
      className: "bg-amber-100 text-amber-900",
    };
  }
  if (template.isActive) {
    return { label: "Active", className: "bg-emerald-100 text-emerald-800" };
  }
  if (template.mappingStatus === "MAPPING") {
    return { label: "AI mapping...", className: "bg-sky-100 text-sky-800" };
  }
  if (template.mappingStatus === "APPROVED") {
    return { label: "Approved history", className: "bg-slate-200 text-slate-700" };
  }
  return { label: "Draft - needs review", className: "bg-amber-100 text-amber-900" };
}

export default function MasterDashboard() {
  const router = useRouter();
  const pathname = usePathname();
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [isMaster, setIsMaster] = useState<boolean | null>(null);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [packetFile, setPacketFile] = useState<File | null>(null);
  const [packetBusy, setPacketBusy] = useState(false);
  const [aiMapBusy, setAiMapBusy] = useState(false);
  const [packetActionBusy, setPacketActionBusy] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [showProviderAdminPassword, setShowProviderAdminPassword] = useState(false);
  const [adminForm, setAdminForm] = useState({ name: "", email: "", password: "" });
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [contextBusyProviderId, setContextBusyProviderId] = useState("");
  const [statusBusyProviderId, setStatusBusyProviderId] = useState("");
  const [deleteBusyProviderId, setDeleteBusyProviderId] = useState("");
  const [providerNotifyBusy, setProviderNotifyBusy] = useState("");
  const [openSummary, setOpenSummary] = useState<SummaryKey | null>(null);
  const aiStopRequested = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    setError("");
    try {
      const response = await fetch("/api/master/providers");
      if (response.status === 401) {
        router.push("/master");
        return;
      }
      if (response.status === 403) {
        router.push("/dashboard");
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Provider load failed (${response.status})`);
      if (!body.isMaster && pathname.startsWith("/master")) {
        router.replace("/master");
        return;
      }
      const loadedProviders = body.providers || [];
      setProviders(loadedProviders);
      setIsMaster(!!body.isMaster);
      setAiConfigured(!!body.aiConfigured);
      setSelectedProviderId((current) => {
        const requestedProviderId = typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("providerId")
          : null;
        if (requestedProviderId && loadedProviders.some((provider: ProviderRow) => provider.id === requestedProviderId)) return requestedProviderId;
        if (current && loadedProviders.some((provider: ProviderRow) => provider.id === current)) return current;
        return loadedProviders.length === 1 ? loadedProviders[0].id : "";
      });
    } catch (err) {
      setLoadFailed(true);
      setError(err instanceof Error ? err.message : "Could not load providers.");
    } finally {
      setLoading(false);
    }
  }, [pathname, router]);

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
      if (body.provider?.id) {
        setSelectedProviderId(body.provider.id);
        setShowProviderAdminPassword(false);
        window.setTimeout(() => document.getElementById("provider-packet-setup")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provider could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function setProviderStatus(provider: ProviderRow, status: "ACTIVE" | "INACTIVE") {
    if (status === "INACTIVE") {
      const confirmed = window.confirm(
        `${provider.name} will be deactivated. Staff sign-in, new intake links, and client access will be paused, but existing records will remain saved. Reactivate the provider to restore access. Continue?`,
      );
      if (!confirmed) return;
    }
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
      const templateId = body.template?.id;
      if (templateId && isMaster && aiConfigured) {
        setNote(`${provider.name} packet uploaded. AI is mapping fields and signature locations now...`);
        await runAiPacketMapping(provider.id, templateId);
      } else if (!isMaster) {
        setNote(`${provider.name} packet uploaded for master review. The current approved packet stays active until the master maps, checks, and approves this upload.`);
        await load();
      } else {
        setNote(`${provider.name} packet uploaded as a review draft: ${body.template?.originalFileName || "uploaded PDF"}. AI mapping is unavailable until system AI is configured.`);
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Packet could not be uploaded.");
    } finally {
      setPacketBusy(false);
    }
  }

  async function deleteProviderProfile(provider: ProviderRow) {
    const confirmation = window.prompt(
      `This permanently deletes ${provider.name}, its provider login memberships, clients, intakes, uploaded files, generated packets, and packet templates. Type the provider name exactly to continue:`,
    );
    if (confirmation !== provider.name) {
      if (confirmation !== null) setError("Provider deletion cancelled. The name did not match exactly.");
      return;
    }
    setDeleteBusyProviderId(provider.id);
    setError("");
    setNote("");
    try {
      const response = await fetch(`/api/master/providers/${provider.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmName: confirmation }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Provider profile could not be deleted.");
      if (selectedProviderId === provider.id) setSelectedProviderId("");
      setNote(`${provider.name} and its provider records were permanently deleted.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provider profile could not be deleted.");
    } finally {
      setDeleteBusyProviderId("");
    }
  }

  async function runAiPacketMapping(providerId: string, templateId: string) {
    aiStopRequested.current = false;
    setAiMapBusy(true);
    setError("");
    setNote("AI mapping started in the background. You can keep working while the packet is checked...");
    try {
      const statusUrl = `/api/mapping/ai-suggest?providerId=${encodeURIComponent(providerId)}&templateId=${encodeURIComponent(templateId)}`;
      const response = await fetch(statusUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apply: true, background: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 202) throw new Error(body.error || "AI mapping could not be completed.");
      let result = body;
      if (body.queued) {
        for (let attempt = 0; attempt < 90; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (aiStopRequested.current) return;
          const statusResponse = await fetch(statusUrl, { cache: "no-store" });
          const statusBody = await statusResponse.json().catch(() => ({}));
          if (!statusResponse.ok) throw new Error(statusBody.error || "AI mapping status could not be checked.");
          if (statusBody.status === "ERROR") throw new Error(statusBody.mappingIssues?.error || "AI mapping failed.");
          result = statusBody;
          if (statusBody.mappingStatus !== "MAPPING") break;
        }
        if (result.mappingStatus === "MAPPING") throw new Error("AI mapping is still running. You can leave this page and check the packet status again shortly.");
      }
      if (aiStopRequested.current) return;
      const health = result.health;
      if (health?.ready) {
        setNote(`AI mapped ${result.appliedCount || 0} fields. Quality check passed at ${health.score}/100. Review it, then approve for signatures.`);
      } else {
        const blockers = Array.isArray(health?.blockingIssues) ? health.blockingIssues.slice(0, 2).join(" ") : "Review the mapping before approval.";
        setNote(`AI mapped ${result.appliedCount || 0} fields, but the packet still needs attention. ${blockers}`);
      }
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI mapping could not be completed.";
      await load();
      setNote("");
      setError(message);
    } finally {
      setAiMapBusy(false);
    }
  }

  async function stopAiPacketMapping(providerId: string, templateId: string) {
    aiStopRequested.current = true;
    setError("");
    setNote("Stopping AI mapping and keeping this packet as a review draft...");
    try {
      const response = await fetch(`/api/mapping/ai-suggest?providerId=${encodeURIComponent(providerId)}&templateId=${encodeURIComponent(templateId)}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "AI mapping could not be stopped.");
      setNote("AI mapping stopped. The packet remains a review draft and can be mapped again when you are ready.");
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "AI mapping could not be stopped.";
      await load();
      setError(message);
    } finally {
      setAiMapBusy(false);
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
      setShowResetPassword(false);
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

  async function notifyProvider(provider: ProviderRow, channel: "email" | "sms") {
    const recipient = channel === "email" ? provider.email : provider.phone;
    if (!recipient) {
      setError(`${provider.name} has no ${channel} contact saved.`);
      return;
    }
    const busyKey = `${provider.id}:${channel}`;
    setProviderNotifyBusy(busyKey);
    setError("");
    setNote("");
    try {
      const response = await fetch(`/api/master/providers/${provider.id}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || body.error || `${channel} notification could not be sent.`);
      setNote(`${channel === "email" ? "Email" : "Text message"} sent to ${provider.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${channel} notification could not be sent.`);
    } finally {
      setProviderNotifyBusy("");
    }
  }

  function openPacketSetup(providerId: string) {
    setSelectedProviderId(providerId);
    window.setTimeout(() => {
      document.getElementById("provider-packet-setup")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function providerActions(provider: ProviderRow, mobile = false) {
    const active = provider.status === "ACTIVE";
    const packet = latestPacketFor(provider);
    const buttonClass = mobile ? "w-full justify-center px-3 py-2 text-xs" : "px-3 py-1.5 text-xs";

    return (
      <div className={mobile ? "grid grid-cols-2 gap-2" : "flex flex-wrap gap-2"}>
        {active ? (
          <button
            type="button"
            className={`btn-primary ${buttonClass}`}
            disabled={contextBusyProviderId === provider.id}
            onClick={() => void openProviderDashboard(provider.id)}
          >
            {contextBusyProviderId === provider.id ? "Opening..." : "Open intakes"}
          </button>
        ) : (
          <span className={`rounded-lg bg-slate-100 text-center text-slate-500 ${buttonClass}`}>Inactive</span>
        )}
        <button type="button" className={`btn-ghost ${buttonClass}`} onClick={() => openPacketSetup(provider.id)}>
          Packet setup
        </button>
        {isMaster && active && provider.email && (
          <button
            type="button"
            className={`btn-ghost ${buttonClass}`}
            disabled={providerNotifyBusy === `${provider.id}:email`}
            onClick={() => void notifyProvider(provider, "email")}
          >
            {providerNotifyBusy === `${provider.id}:email` ? "Emailing..." : mobile ? "Email portal" : "Email provider portal"}
          </button>
        )}
        {isMaster && active && provider.phone && (
          <button
            type="button"
            className={`btn-ghost ${buttonClass}`}
            disabled={providerNotifyBusy === `${provider.id}:sms`}
            onClick={() => void notifyProvider(provider, "sms")}
          >
            {providerNotifyBusy === `${provider.id}:sms` ? "Texting..." : mobile ? "Text portal" : "Text provider portal"}
          </button>
        )}
        {isMaster && packet && (
          <Link className={`btn-ghost ${buttonClass}`} href={`/admin/pdf-mapping?providerId=${provider.id}&templateId=${packet.id}`}>
            Map packet
          </Link>
        )}
        {isMaster && (active ? (
          <button
            type="button"
            className={`btn-ghost border-red-200 text-red-700 hover:bg-red-50 ${buttonClass}`}
            disabled={statusBusyProviderId === provider.id}
            onClick={() => void setProviderStatus(provider, "INACTIVE")}
          >
            {statusBusyProviderId === provider.id ? "Deactivating..." : "Deactivate"}
          </button>
        ) : (
          <button
            type="button"
            className={`btn-primary ${buttonClass}`}
            disabled={statusBusyProviderId === provider.id}
            onClick={() => void setProviderStatus(provider, "ACTIVE")}
          >
            {statusBusyProviderId === provider.id ? "Activating..." : "Activate"}
          </button>
        ))}
        {isMaster && (
          <button
            type="button"
            className={`btn-ghost border-red-300 text-red-800 hover:bg-red-50 ${mobile ? "col-span-2" : ""} ${buttonClass}`}
            disabled={deleteBusyProviderId === provider.id}
            onClick={() => void deleteProviderProfile(provider)}
          >
            {deleteBusyProviderId === provider.id ? "Deleting..." : "Delete profile"}
          </button>
        )}
      </div>
    );
  }

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) || null;
  const selectedLatestTemplate = selectedProvider ? latestPacketFor(selectedProvider) : null;
  const selectedActiveTemplate = selectedProvider ? activePacketFor(selectedProvider) : null;
  const selectedLatestPacketState = selectedLatestTemplate ? packetStatus(selectedLatestTemplate) : null;
  const trimmedSearch = search.trim().toLowerCase();
  const filteredProviders = providers.filter((provider) => {
    const matchesSearch = !trimmedSearch || providerSearchText(provider).includes(trimmedSearch);
    const matchesStatus = statusFilter === "ALL" || provider.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const activeCount = providers.filter((provider) => provider.status === "ACTIVE").length;
  const inactiveCount = providers.filter((provider) => provider.status !== "ACTIVE").length;
  const customPacketCount = providers.filter((provider) => provider.pdfTemplates.length > 0).length;
  const currentIntakes = providers.reduce((sum, provider) => sum + provider.currentIntakeCount, 0);
  const archivedIntakes = providers.reduce((sum, provider) => sum + provider.archivedIntakeCount, 0);
  const totalMemberships = providers.reduce((sum, provider) => sum + activeMembershipCount(provider), 0);
  const emptyProviderMessage = trimmedSearch
    ? "No providers match this search."
    : statusFilter === "ACTIVE"
      ? "No active providers found."
      : statusFilter === "INACTIVE"
        ? "No inactive providers found."
        : "No providers found.";

  function toggleSummary(summary: SummaryKey) {
    setOpenSummary((current) => current === summary ? null : summary);
  }

  const summaryProviders = openSummary === "active"
    ? providers.filter((provider) => provider.status === "ACTIVE")
    : openSummary === "inactive"
      ? providers.filter((provider) => provider.status !== "ACTIVE")
      : openSummary === "packets"
        ? providers.filter((provider) => provider.pdfTemplates.length > 0)
        : providers;

  const summaryHeading = openSummary === "providers"
    ? "All provider dashboards"
    : openSummary === "active"
      ? "Active provider dashboards"
      : openSummary === "inactive"
        ? "Inactive provider dashboards"
        : openSummary === "packets"
          ? "Custom packet details"
          : openSummary === "intakes"
            ? "Intakes by provider"
            : openSummary === "staff"
              ? "Staff users by provider"
              : "AI preflight status";

  if (isMaster === null) {
    return (
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase text-slate-500">Secure provider access</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Opening your dashboard</h1>
          {loadFailed ? (
            <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p className="font-semibold">{error || "The dashboard could not be loaded."}</p>
              <button type="button" className="btn-primary mt-3 px-4 py-2 text-sm" onClick={() => void load()}>
                Try again
              </button>
            </div>
          ) : (
            <p role="status" aria-live="polite" className="mt-3 text-sm text-slate-600">
              {loading ? "Checking your access and loading current provider information..." : "Taking you to the correct dashboard..."}
            </p>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto min-w-0 max-w-7xl p-4 sm:p-6">
      <section className="overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-900 via-brand-dark to-brand px-6 py-7 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-light/90">{isMaster ? "Master Intake Setup" : "Provider Settings"}</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">{isMaster ? "Create Providers & Map Intake Packets" : "Provider Packet Dashboard"}</h1>
            <p className="mt-2 text-sm text-slate-200">
              {isMaster
                ? "Create provider workspaces, set up administrator access, and upload, map, and approve the intake packet each provider uses."
                : "Manage the intake packet PDF your provider uses for previews, downloads, and DocuSign."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isMaster ? (
              <button
                className="btn-ghost border-white/30 bg-white/10 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!!contextBusyProviderId}
                onClick={() => {
                  if (selectedProviderId) {
                    void openProviderDashboard(selectedProviderId);
                    return;
                  }
                  const providerSelector = document.getElementById("provider-selector");
                  providerSelector?.scrollIntoView({ behavior: "smooth", block: "center" });
                  if (providerSelector instanceof HTMLSelectElement) providerSelector.focus();
                }}
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
                router.push("/master");
              }}
            >
              Sign out
            </button>
          </div>
        </div>

        <div className={`mt-6 grid grid-cols-2 gap-3 ${isMaster ? "md:grid-cols-3 xl:grid-cols-7" : "md:grid-cols-4"}`}>
          {isMaster && <StatCard label="Providers" value={loading ? "-" : providers.length} active={openSummary === "providers"} onClick={() => toggleSummary("providers")} />}
          {isMaster && <StatCard label="Active" value={loading ? "-" : activeCount} active={openSummary === "active"} onClick={() => toggleSummary("active")} />}
          {isMaster && <StatCard label="Inactive" value={loading ? "-" : inactiveCount} active={openSummary === "inactive"} onClick={() => toggleSummary("inactive")} />}
          <StatCard
            label={isMaster ? "Custom packets" : "Packet"}
            value={loading ? "-" : isMaster ? customPacketCount : customPacketCount > 0 ? "CUSTOM" : "DEFAULT"}
            active={openSummary === "packets"}
            onClick={() => toggleSummary("packets")}
          />
          <StatCard
            label="Current intakes"
            value={loading ? "-" : currentIntakes}
            detail={loading ? undefined : `${archivedIntakes} archived`}
            active={openSummary === "intakes"}
            onClick={() => toggleSummary("intakes")}
          />
          <StatCard label="Staff users" value={loading ? "-" : totalMemberships} active={openSummary === "staff"} onClick={() => toggleSummary("staff")} />
          <StatCard label="AI preflight" value={loading ? "-" : aiConfigured ? "ON" : "OFF"} active={openSummary === "ai"} onClick={() => toggleSummary("ai")} />
        </div>

        {openSummary && (
          <section className="mt-4 rounded-2xl border border-white/15 bg-slate-950/25 p-4" aria-live="polite">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">Selected summary</p>
                <h2 className="mt-1 text-lg font-bold text-white">{summaryHeading}</h2>
              </div>
              <button type="button" className="btn-ghost border-white/25 bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20" onClick={() => setOpenSummary(null)}>
                Close details
              </button>
            </div>

            {openSummary === "ai" ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/10 p-4 text-sm text-slate-200">
                <p className="font-semibold text-white">{aiConfigured ? "System AI is connected" : "System AI needs setup"}</p>
                <p className="mt-1">{aiConfigured
                  ? "Providers use their normal portal login for intake review suggestions. No separate AI account is needed."
                  : "Automatic checks remain available, but AI suggestions need the system AI key configured in the app."}</p>
              </div>
            ) : openSummary === "staff" ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {providers.flatMap((provider) => provider.memberships.filter((membership) => membership.active).map((membership) => (
                  <div key={membership.id} className="rounded-xl border border-white/10 bg-white/10 p-3 text-sm">
                    <p className="font-semibold text-white">{membership.user.name || membership.user.email}</p>
                    <p className="text-slate-300">{membership.user.email}</p>
                    <p className="mt-1 text-xs text-slate-400">{provider.name} · {membership.role.replaceAll("_", " ")}</p>
                  </div>
                )))}
                {totalMemberships === 0 && <p className="mt-3 text-sm text-slate-300">No active staff users found.</p>}
              </div>
            ) : openSummary === "intakes" ? (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {providers.map((provider) => (
                  <div key={provider.id} className="rounded-xl border border-white/10 bg-white/10 p-3 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-white">{provider.name}</p>
                      <span className="font-bold text-white">{provider.currentIntakeCount}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-300">
                      {provider.currentIntakeCount} current · {provider.archivedIntakeCount} archived · {provider._count.intakes} total
                    </p>
                    <p className="mt-1 text-xs text-slate-300">{provider._count.clients} clients · {activeMembershipCount(provider)} active staff users</p>
                    <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-slate-300">
                      {Object.entries(provider.intakeSummary).map(([status, count]) => <span key={status} className="rounded-full bg-white/10 px-2 py-0.5">{status.replaceAll("_", " ")}: {count}</span>)}
                    </div>
                    {provider.status === "ACTIVE" && <button type="button" className="mt-3 btn-ghost border-white/25 bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20" onClick={() => void openProviderDashboard(provider.id)}>Open intakes</button>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {summaryProviders.map((provider) => {
                  const packet = activePacketFor(provider) || latestPacketFor(provider);
                  const packetState = packet ? packetStatus(packet) : null;
                  return (
                    <div key={provider.id} className="rounded-xl border border-white/10 bg-white/10 p-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-white">{provider.name}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${provider.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{provider.status === "ACTIVE" ? "Active" : "Inactive"}</span>
                      </div>
                      {openSummary === "packets" ? (
                        packet ? <p className="mt-1 text-slate-300">{packet.originalFileName || packet.name} · {packet.pageCount} pages · {packetState?.label}</p> : <p className="mt-1 text-slate-300">Using the shared default packet.</p>
                      ) : (
                        <p className="mt-1 text-slate-300">
                          {provider._count.clients} clients · {provider.currentIntakeCount} current intakes · {provider.archivedIntakeCount} archived · {activeMembershipCount(provider)} staff users
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" className="btn-ghost border-white/25 bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20" onClick={() => { setSelectedProviderId(provider.id); document.getElementById("provider-list")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                          Manage provider
                        </button>
                        {provider.status === "ACTIVE" && <button type="button" className="btn-ghost border-white/25 bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20" onClick={() => void openProviderDashboard(provider.id)}>Open intakes</button>}
                      </div>
                    </div>
                  );
                })}
                {summaryProviders.length === 0 && <p className="text-sm text-slate-300">No providers match this summary.</p>}
              </div>
            )}
          </section>
        )}
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

      {note && <p role="status" aria-live="polite" className="sticky top-2 z-20 mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 shadow-sm">{note}</p>}
      {error && (
        <div role="alert" className="sticky top-2 z-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 shadow-sm">
          <span>{error}</span>
          {loadFailed && (
            <button type="button" className="btn-ghost border-red-300 px-3 py-1.5 text-xs text-red-800 hover:bg-red-100" onClick={() => void load()}>
              Try again
            </button>
          )}
        </div>
      )}

      {isMaster && (
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
          <label className="sr-only" htmlFor="provider-search">Search providers</label>
          <input
            id="provider-search"
            className="input mt-4"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search provider, slug, contact, admin email, or packet name"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-sm font-semibold text-slate-600" htmlFor="provider-status-filter">Show</label>
            <select
              id="provider-status-filter"
              className="input max-w-[190px]"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "ALL" | "ACTIVE" | "INACTIVE")}
            >
              <option value="ALL">All providers</option>
              <option value="ACTIVE">Active only</option>
              <option value="INACTIVE">Inactive only</option>
            </select>
            <span className="text-xs text-slate-500">Deactivate pauses access without deleting provider records.</span>
          </div>
        </section>
      )}

      <section className="mt-5 grid min-w-0 gap-5">
        <div className="min-w-0 space-y-5">
          {isMaster && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-lg font-bold">Step 1: Create Provider Dashboard</h2>
              <p className="mb-4 text-sm text-slate-500">Create the provider first. This creates the provider workspace, login, and place where its client intakes will belong.</p>
              <form onSubmit={createProvider} className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                <label className="lg:col-span-2">
                  <span className="label">Provider name *</span>
                  <input className="input" required minLength={2} value={form.name} onChange={(event) => updateField("name", event.target.value)} />
                </label>
                <label>
                  <span className="label">Slug</span>
                  <input className="input" value={form.slug} onChange={(event) => updateField("slug", event.target.value)} placeholder="provider-name" />
                </label>
                <label htmlFor="provider-phone">
                  <span className="label">Provider phone</span>
                  <input
                    id="provider-phone"
                    className="input"
                    name="providerPhone"
                    type="text"
                    inputMode="tel"
                    autoComplete="off"
                    placeholder="(555) 555-5555"
                    value={form.phone}
                    onFocus={(event) => {
                      window.requestAnimationFrame(() => {
                        event.currentTarget.scrollIntoView({ behavior: "auto", block: "center" });
                      });
                    }}
                    onChange={(event) => updateField("phone", event.target.value)}
                  />
                </label>
                <label>
                  <span className="label">Contact name</span>
                  <input className="input" value={form.contactName} onChange={(event) => updateField("contactName", event.target.value)} />
                </label>
                <label>
                  <span className="label">Provider contact email</span>
                  <input className="input" name="providerContactEmail" autoComplete="off" inputMode="email" type="email" placeholder="provider@example.com" value={form.email} onChange={(event) => updateField("email", event.target.value)} />
                  <span className="mt-1 block text-xs text-slate-500">Use the provider&apos;s contact email, not your master login.</span>
                </label>
                <label>
                  <span className="label">Admin name</span>
                  <input className="input" value={form.adminName} onChange={(event) => updateField("adminName", event.target.value)} />
                </label>
                <label>
                  <span className="label">Admin email *</span>
                  <input className="input" name="newProviderAdminEmail" autoComplete="new-username" inputMode="email" type="email" required placeholder="provider-admin@example.com" value={form.adminEmail} onChange={(event) => updateField("adminEmail", event.target.value)} />
                </label>
                <label>
                  <span className="label">Admin password *</span>
                  <div className="relative">
                    <input className="input pr-16" name="newProviderAdminPassword" autoComplete="new-password" type={showProviderAdminPassword ? "text" : "password"} required minLength={8} value={form.adminPassword} onChange={(event) => updateField("adminPassword", event.target.value)} />
                    <button
                      type="button"
                      className="absolute inset-y-1 right-1 px-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                      onClick={() => setShowProviderAdminPassword((current) => !current)}
                      aria-label={showProviderAdminPassword ? "Hide admin password" : "Show admin password"}
                    >
                      {showProviderAdminPassword ? "Hide" : "Show"}
                    </button>
                  </div>
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
                  <select id="provider-selector" className="input" value={selectedProviderId} onChange={(event) => setSelectedProviderId(event.target.value)}>
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
                  <input className="input" name="resetProviderAdminEmail" autoComplete="new-username" type="email" required value={adminForm.email}
                    onChange={(event) => setAdminForm((current) => ({ ...current, email: event.target.value }))} />
                </label>
                <label>
                  <span className="label">New password *</span>
                  <div className="relative">
                    <input className="input pr-16" name="resetProviderAdminPassword" autoComplete="new-password" type={showResetPassword ? "text" : "password"} required minLength={8} value={adminForm.password}
                      onChange={(event) => setAdminForm((current) => ({ ...current, password: event.target.value }))} />
                    <button
                      type="button"
                      className="absolute inset-y-1 right-1 px-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                      onClick={() => setShowResetPassword((current) => !current)}
                      aria-label={showResetPassword ? "Hide new password" : "Show new password"}
                    >
                      {showResetPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>
                <button className="btn-primary lg:col-span-2" disabled={adminBusy || !selectedProviderId}>
                  {adminBusy ? "Saving..." : "Create / reset provider administrator"}
                </button>
              </form>
            </section>
          )}

          <section id="provider-list" className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-bold">{isMaster ? "Provider list" : "Your provider workspace"}</h2>
              <p className="text-sm text-slate-500">
                {isMaster
                  ? "Open a provider's intake workspace, control access, and manage its packet. Delete permanently removes the provider profile and its records."
                  : "Open your intake workspace or update the packet used for previews, downloads, and signatures."}
              </p>
            </div>
            <div className="divide-y divide-slate-100 md:hidden">
              {loading && <p className="p-6 text-center text-sm text-slate-400">Loading providers...</p>}
              {!loading && !error && filteredProviders.length === 0 && <p className="p-6 text-center text-sm text-slate-400">{emptyProviderMessage}</p>}
              {filteredProviders.map((provider) => {
                const active = provider.status === "ACTIVE";
                const packet = activePacketFor(provider) || latestPacketFor(provider);
                const packetState = packet ? packetStatus(packet) : null;
                const reviewQueue = providerReviewQueueCount(provider);
                const openWork = providerOpenWorkCount(provider);

                return (
                  <article key={provider.id} className={selectedProviderId === provider.id ? "bg-brand-light/20 p-4" : "p-4"}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-bold text-slate-900">{provider.name}</h3>
                        <p className="text-xs text-slate-500">{provider.slug}</p>
                        {(provider.email || provider.phone) && (
                          <p className="mt-1 break-words text-xs text-slate-500">{[provider.email, provider.phone].filter(Boolean).join(" · ")}</p>
                        )}
                      </div>
                      <span className={`badge shrink-0 ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>
                        {active ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-slate-50 px-2 py-2">
                        <p className="text-lg font-bold text-slate-900">{provider.currentIntakeCount}</p>
                        <p className="text-[11px] text-slate-500">Current</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2 py-2">
                        <p className="text-lg font-bold text-slate-900">{provider.archivedIntakeCount}</p>
                        <p className="text-[11px] text-slate-500">Archived</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2 py-2">
                        <p className="text-lg font-bold text-slate-900">{activeMembershipCount(provider)}</p>
                        <p className="text-[11px] text-slate-500">Staff</p>
                      </div>
                    </div>

                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                      <p className="font-semibold text-slate-800">{packet?.originalFileName || "Shared default packet"}</p>
                      <p className="mt-1 text-slate-500">
                        {packet ? `${packet.pageCount} pages · ${packetState?.label}` : "No custom packet uploaded"}
                      </p>
                      <p className="mt-1 text-slate-500">Staff review: {reviewQueue} · Open work: {openWork}</p>
                    </div>

                    <div className="mt-3">{providerActions(provider, true)}</div>
                  </article>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto md:block">
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
                  {!loading && !error && filteredProviders.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-400">{emptyProviderMessage}</td></tr>}
                  {filteredProviders.map((provider) => {
                    const admins = provider.memberships
                      .filter((membership) => membership.active && membership.role === "PROVIDER_ADMIN")
                      .map((membership) => membership.user.email);
                    const active = provider.status === "ACTIVE";
                    const packet = activePacketFor(provider) || latestPacketFor(provider);
                    const packetState = packet ? packetStatus(packet) : null;
                    const activeStaff = activeMembershipCount(provider);

                    return (
                      <tr key={provider.id} className={`border-t border-slate-100 ${selectedProviderId === provider.id ? "bg-brand-light/20" : "hover:bg-slate-50"}`}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">{provider.name}</div>
                          <div className="text-xs text-slate-500">{provider.slug}</div>
                          {(provider.email || provider.phone) && (
                            <div className="mt-1 text-xs text-slate-500">{[provider.email, provider.phone].filter(Boolean).join(" • ")}</div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1 text-[11px] font-semibold">
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">Staff review {providerReviewQueueCount(provider)}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Open work {providerOpenWorkCount(provider)}</span>
                          </div>
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
                              <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${packetState?.className}`}>
                                {packetState?.label}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-500">Default packet</span>
                          )}
                        </td>
                        <td className="px-4 py-3">{provider._count.clients}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold">{provider.currentIntakeCount} current</div>
                          <div className="text-xs text-slate-500">{provider.archivedIntakeCount} archived</div>
                        </td>
                        <td className="px-4 py-3">{activeStaff}</td>
                        <td className="px-4 py-3">{providerActions(provider)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section id="provider-packet-setup" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">{isMaster ? "Step 2: Upload the Provider Packet" : "Provider Packet Upload"}</h2>
              <p className="text-sm text-slate-500">
                {isMaster
                  ? "Select the provider, then upload its blank intake packet PDF for mapping, review, signatures, previews, and DocuSign."
                  : "Upload a replacement packet for master mapping and approval. The current packet remains active while the new upload is reviewed."}
              </p>
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
              <span className="mt-1 block text-xs text-slate-500">
                {selectedProvider
                  ? `Packet will be assigned to ${selectedProvider.name}.`
                  : isMaster
                    ? "Select a provider before uploading. AI mapping starts after upload."
                    : "Your provider workspace is loading."}
              </span>
            </label>

            <label>
              <span className="label">Intake packet PDF</span>
              <input
                key={fileInputKey}
                className="input"
                type="file"
                accept="application/pdf,.pdf"
                required
                onChange={(event) => setPacketFile(event.target.files?.[0] || null)}
              />
            </label>

            <button className="btn-primary w-full" disabled={packetBusy || aiMapBusy || !selectedProviderId || !packetFile}>
              {packetBusy
                ? "Uploading..."
                : aiMapBusy
                  ? "AI mapping..."
                  : !selectedProviderId
                    ? "Select provider first"
                    : !packetFile
                      ? "Choose a PDF first"
                      : isMaster
                        ? "Upload packet and start AI mapping"
                        : "Upload packet for master review"}
            </button>
          </form>

          <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
            <p className="font-semibold">What comes next</p>
            <p className="mt-1">
              {isMaster
                ? "After upload, AI maps the packet and signature locations. Review and approve the packet, then open the provider's intake workspace to create client intakes."
                : "After upload, the master administrator maps and verifies the fields and signature locations. You can keep using the current approved packet during that review."}
            </p>
            <p className="mt-1">A CCA is uploaded later inside the specific client intake. It is not attached to the provider packet.</p>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            {selectedProvider ? (
              selectedActiveTemplate ? (
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Active packet used for new intakes</p>
                  <p className="mt-1 font-semibold text-slate-800">{selectedActiveTemplate.originalFileName || selectedActiveTemplate.name}</p>
                  <p className="mt-1">{selectedActiveTemplate.pageCount} pages • updated {new Date(selectedActiveTemplate.updatedAt).toLocaleDateString()}</p>
                </div>
              ) : (
                <p>Active packet: shared default intake packet.</p>
              )
            ) : (
              <p>Select a provider to view packet status.</p>
            )}
          </div>
          {selectedProvider && selectedLatestTemplate && (
            <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Latest upload: {selectedLatestTemplate.originalFileName || selectedLatestTemplate.name}</p>
              <p className="mt-1 text-xs">{selectedLatestTemplate.pageCount} pages. {selectedLatestPacketState?.label}.</p>
              <p className="mt-2 text-xs font-semibold">
                {selectedLatestTemplate.mappingStatus === "MAPPING"
                  ? "AI is mapping this packet in the background. This draft is not active yet."
                  : selectedLatestTemplate.mappingScore == null
                    ? selectedLatestTemplate.isActive
                      ? "This packet is in use, but its fields and signature locations have not been verified. A master administrator should map it before DocuSign is used."
                      : "AI mapping has not been run yet."
                  : selectedLatestTemplate.mappingStatus === "APPROVED"
                    ? `Signature-ready packet approved (${selectedLatestTemplate.mappingScore}/100).`
                    : `Mapping quality score: ${selectedLatestTemplate.mappingScore}/100. Review before approval.`}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {isMaster ? (
                  <Link className="btn-ghost px-3 py-1.5 text-xs" href={`/admin/pdf-mapping?providerId=${selectedProvider.id}&templateId=${selectedLatestTemplate.id}`}>
                    Open mapper
                  </Link>
                ) : (
                  <span className="rounded-lg bg-white/70 px-3 py-2 text-xs font-semibold text-amber-900">
                    Packet mapping and approval are managed by the master administrator.
                  </span>
                )}
                {isMaster && selectedLatestTemplate.mappingStatus !== "APPROVED" && (
                  <button
                    type="button"
                    className="btn-ghost px-3 py-1.5 text-xs"
                    disabled={aiMapBusy || selectedLatestTemplate.mappingStatus === "MAPPING"}
                    title={aiConfigured ? "Run AI mapping again" : "System AI is not connected yet."}
                    onClick={() => {
                      if (!aiConfigured) {
                        setError("System AI is not connected yet. Add the ANTHROPIC_API_KEY in the app environment, then refresh this page.");
                        return;
                      }
                      void runAiPacketMapping(selectedProvider.id, selectedLatestTemplate.id);
                    }}
                  >
                    {aiMapBusy || selectedLatestTemplate.mappingStatus === "MAPPING" ? "AI mapping..." : aiConfigured ? "Run AI mapping again" : "AI setup needed"}
                  </button>
                )}
                {isMaster && (aiMapBusy || selectedLatestTemplate.mappingStatus === "MAPPING") && (
                  <button className="btn-ghost border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50" onClick={() => void stopAiPacketMapping(selectedProvider.id, selectedLatestTemplate.id)}>
                    Stop AI mapping
                  </button>
                )}
                {isMaster && selectedLatestTemplate.mappingStatus === "DRAFT" && (
                  <button className="btn-primary px-3 py-1.5 text-xs" disabled={packetActionBusy === selectedLatestTemplate.id} onClick={() => void approvePacket(selectedLatestTemplate.id)}>
                    {packetActionBusy === selectedLatestTemplate.id ? "Checking..." : "Approve after review"}
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
                    {isMaster ? (
                      <button className="btn-ghost px-2 py-1 text-xs" disabled={packetActionBusy === template.id} onClick={() => void activatePacket(template.id)}>
                        {packetActionBusy === template.id ? "Activating..." : "Restore this packet"}
                      </button>
                    ) : (
                      <span className="text-slate-500">Available to the master administrator</span>
                    )}
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

function StatCard({
  label,
  value,
  detail,
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  detail?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-expanded={active}
      onClick={onClick}
      className={`min-h-[92px] rounded-2xl border px-4 py-3 text-left transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${active ? "border-white/50 bg-white/25" : "border-white/10 bg-white/10"}`}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-300">{detail}</p>}
    </button>
  );
}
