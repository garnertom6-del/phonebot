"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { needsStaffAction, type DashboardReadiness } from "@/lib/dashboardWorkflow";
import { clientLinkExpired, clientLinkMessagingFinished } from "@/lib/clientLinkState";
import { clientDeliveryContacts } from "@/lib/clientDeliveryContacts";
import { consumeDashboardFlash, dashboardTabFromQuery } from "@/lib/dashboardFlash";

interface Row {
  id: string;
  status: string;
  archived?: boolean;
  percentComplete: number;
  hasPdf: boolean;
  packetState: "missing" | "current" | "stale";
  packetGeneratedAt?: string | null;
  hasCca: boolean;
  ccaDetail?: string;
  copiesSentAt?: string | null;
  autoSendCopies?: boolean;
  autoEmailProviderPacket?: boolean;
  providerPacketEmailedAt?: string | null;
  readiness: DashboardReadiness;
  completionReady: boolean;
  completionBlockers: Array<{ code: string; message: string }>;
  docusignEnvelopeId?: string | null;
  insuranceSummary?: string;
  presentingProblem?: string;
  client: {
    fullName: string;
    dob: string;
    recordNumber?: string;
    midNumber?: string;
    phone?: string;
    email?: string;
    guardianName?: string;
    guardianEmail?: string;
    guardianPhone?: string;
  };
  missingRequired: { key: string; label: string }[];
  linkSentAt?: string;
  lastLinkOpenedAt?: string | null;
  reminderCount?: number;
  lastActivityAt?: string;
  submittedAt?: string;
  createdAt: string;
  token: string;
  tokenExpiresAt: string;
}

interface ClientDetailsDraft {
  fullName: string;
  dob: string;
  midNumber: string;
  recordNumber: string;
  phone: string;
  email: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
}

interface ProviderPacketReadinessView {
  ready: boolean;
  state: string;
  templateName?: string | null;
  message: string;
}

const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: "bg-slate-200 text-slate-700",
  IN_PROGRESS: "bg-amber-100 text-amber-800",
  SUBMITTED: "bg-blue-100 text-blue-800",
  NEEDS_REVIEW: "bg-purple-100 text-purple-800",
  SIGNED: "bg-emerald-100 text-emerald-800",
  COMPLETED: "bg-emerald-600 text-white",
};

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  NEEDS_REVIEW: "Needs review",
  SIGNED: "Client signed - staff review",
  COMPLETED: "Completed",
};

type DashboardTab = {
  key: string;
  label: string;
  statuses: string[];
  matches?: (row: Row) => boolean;
};

const TABS: DashboardTab[] = [
  { key: "action", label: "Needs staff action", statuses: [], matches: (row) => rowNeedsStaffAction(row) },
  { key: "waiting", label: "Waiting on client", statuses: ["NOT_STARTED", "IN_PROGRESS"] },
  { key: "signed", label: "Signed", statuses: ["SIGNED"] },
  { key: "done", label: "Completed", statuses: ["COMPLETED"] },
  {
    key: "packet",
    label: "Ready to complete",
    statuses: [],
    matches: (row) => row.status !== "COMPLETED" && row.completionReady,
  },
  { key: "cca", label: "CCA uploaded", statuses: [], matches: (row) => row.hasCca },
  { key: "copies", label: "Client copies", statuses: ["SIGNED", "COMPLETED"] },
  { key: "all", label: "All intakes", statuses: [] as string[] },
  { key: "archived", label: "Archived", statuses: [] as string[] },
];

function displayDate(value?: string): string {
  if (!value) return "-";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
}

function dateInputValue(value?: string): string {
  if (!value) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (!us) return "";
  return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function displayDateTime(value?: string | null): string {
  if (!value) return "No recent activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function rowMatchesTab(row: Row, tab: string) {
  const tabDef = TABS.find((item) => item.key === tab);
  if (tab === "archived") return !!row.archived;
  if (row.archived) return false;
  if (!tabDef || tab === "all") return true;
  if (tabDef.matches) return tabDef.matches(row);
  return tabDef.statuses.includes(row.status);
}

function rowSearchText(row: Row) {
  return [
    row.client.fullName,
    row.client.dob,
    row.client.recordNumber,
    row.client.midNumber,
    row.client.phone,
    row.client.email,
    row.client.guardianName,
    row.insuranceSummary,
    row.presentingProblem,
    row.ccaDetail,
    row.status,
  ].join(" ").toLowerCase();
}

function rowNeedsStaffAction(row: Row): boolean {
  return needsStaffAction(row.status);
}

function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function reportFileName(providerName: string): string {
  const safeName = providerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "provider";
  return `${safeName}-intake-workflow-${new Date().toISOString().slice(0, 10)}.csv`;
}

function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const providerIdFromUrl = searchParams.get("providerId");
  const providerSlugFromUrl = searchParams.get("providerSlug");
  const createdIntakeId = searchParams.get("created")?.trim() || "";
  const requestedTab = dashboardTabFromQuery(searchParams.get("tab"));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState("");
  const [noticeKind, setNoticeKind] = useState<"success" | "warning" | "error">("success");
  const [tab, setTab] = useState(() => requestedTab || "action");
  const [search, setSearch] = useState("");
  const [providerName, setProviderName] = useState("Provider");
  const [isMaster, setIsMaster] = useState(false);
  const [canManageProvider, setCanManageProvider] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [providerPacketReadiness, setProviderPacketReadiness] = useState<ProviderPacketReadinessView | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [clientDraft, setClientDraft] = useState<ClientDetailsDraft | null>(null);
  const [clientEditError, setClientEditError] = useState("");
  const busyRowIdsRef = useRef(new Set<string>());
  const announcedCreatedIntakeRef = useRef("");
  const [busyRowIds, setBusyRowIds] = useState<Set<string>>(() => new Set());

  const load = useCallback(async (_activeTab: string = "all", preserveNotice = false) => {
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (providerIdFromUrl) params.set("providerId", providerIdFromUrl);
      if (providerSlugFromUrl) params.set("providerSlug", providerSlugFromUrl);
      const query = params.toString() ? `?${params.toString()}` : "";
      const response = await fetch(`/api/intakes${query}`);
      if (response.status === 401) {
        router.push("/provider");
        return;
      }
      const text = await response.text();
      const body = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(body.error || `Dashboard load failed (${response.status})`);
      setRows(body.intakes ?? []);
      setProviderName(body.provider?.name || "Provider");
      setIsMaster(!!body.isMaster);
      setCanManageProvider(!!body.canManageProvider);
      setReadOnly(!!body.readOnly);
      setProviderPacketReadiness(body.providerPacketReadiness || null);
      if (!preserveNotice) setNote("");
    } catch (err) {
      setNoticeKind("error");
      setNote(err instanceof Error ? err.message : "Couldn't load the intake list right now.");
      setRows((current) => current ?? []);
    } finally {
      setRefreshing(false);
    }
  }, [router, providerIdFromUrl, providerSlugFromUrl]);

  useEffect(() => {
    let active = true;
    async function boot() {
      if (providerIdFromUrl || providerSlugFromUrl) {
        await fetch("/api/provider-context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(providerIdFromUrl ? { providerId: providerIdFromUrl } : {}),
            ...(providerSlugFromUrl ? { providerSlug: providerSlugFromUrl } : {}),
          }),
        });
      }
      if (!active) return;
      await load(tab);
      if (!active) return;
      const flash = consumeDashboardFlash();
      if (!flash) return;
      setNoticeKind(flash.kind);
      setNote(flash.message);
    }
    void boot();
    return () => { active = false; };
  }, [load, tab, providerIdFromUrl, providerSlugFromUrl]);

  useEffect(() => {
    if (!rows || !createdIntakeId || announcedCreatedIntakeRef.current === createdIntakeId) return;
    if (!rows.some((row) => row.id === createdIntakeId)) return;
    announcedCreatedIntakeRef.current = createdIntakeId;
    setNoticeKind("success");
    setNote("Intake saved. It is shown below in Waiting on client until the client submits it.");
    const timer = window.setTimeout(() => {
      document.getElementById(`intake-${createdIntakeId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [createdIntakeId, rows]);

  function showNote(message: string, timeout = 4500, kind: "success" | "warning" | "error" = "success") {
    setNoticeKind(kind);
    setNote(message);
    window.setTimeout(() => setNote(""), timeout);
  }

  function beginClientEdit(row: Row) {
    setEditingClientId(row.id);
    setClientEditError("");
    setClientDraft({
      fullName: row.client.fullName || "",
      dob: dateInputValue(row.client.dob),
      midNumber: row.client.midNumber || "",
      recordNumber: row.client.recordNumber || "",
      phone: row.client.phone || "",
      email: row.client.email || "",
      guardianName: row.client.guardianName || "",
      guardianPhone: row.client.guardianPhone || "",
      guardianEmail: row.client.guardianEmail || "",
    });
  }

  function closeClientEdit() {
    setEditingClientId(null);
    setClientDraft(null);
    setClientEditError("");
  }

  function updateClientDraft(field: keyof ClientDetailsDraft, value: string) {
    setClientDraft((current) => current ? { ...current, [field]: value } : current);
  }

  async function saveClientDetails(row: Row) {
    if (!clientDraft) return;
    setClientEditError("");
    const response = await fetch(`/api/intakes/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientDetails: clientDraft }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setClientEditError(body.error || "The client details could not be saved.");
      return;
    }
    const updatedName = clientDraft.fullName;
    closeClientEdit();
    showNote(`${updatedName}'s details were updated. Regenerate the packet if one was already created.`, 6500);
    await load(tab, true);
  }

  async function runRowAction(rowId: string, action: () => Promise<void>) {
    if (busyRowIdsRef.current.has(rowId)) return;
    busyRowIdsRef.current.add(rowId);
    setBusyRowIds(new Set(busyRowIdsRef.current));
    try {
      await action();
    } finally {
      busyRowIdsRef.current.delete(rowId);
      setBusyRowIds(new Set(busyRowIdsRef.current));
    }
  }

  function selectDashboardTab(nextTab: string) {
    setSearch("");
    setTab(nextTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    params.delete("created");
    router.replace(`/dashboard?${params.toString()}`, { scroll: false });
    window.setTimeout(() => document.getElementById("intake-results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function copyLink(row: Row) {
    if (clientLinkMessagingFinished(row.status)) {
      showNote("This intake is already signed. Use the client-copies link instead of the intake link.", 6500, "error");
      return;
    }
    if (clientLinkExpired(row.tokenExpiresAt)) {
      showNote("This secure link expired. Open the intake and renew it before copying or sending it.", 6500, "error");
      return;
    }
    const link = `${window.location.origin}/intake/${row.token}`;
    await navigator.clipboard.writeText(link);
    showNote(`Intake link copied for ${row.client.fullName}`, 2500);
  }

  async function copyCompletedLink(row: Row) {
    if (new Date(row.tokenExpiresAt).getTime() < Date.now()) {
      showNote("This secure link expired. Open the intake and extend it before sending client copies.", 6500, "error");
      return;
    }
    const link = `${window.location.origin}/copies/${row.token}`;
    await navigator.clipboard.writeText(link);
    showNote(`Client-copies link copied for ${row.client.fullName}`, 2500);
  }

  async function remind(row: Row) {
    const response = await fetch(`/api/intakes/${row.id}/remind`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.ok) {
      const sent = body.sent?.length ? body.sent.join("; ") : "No phone or email saved for this client.";
      const failed = body.failed?.length ? ` Not accepted: ${body.failed.join("; ")}` : "";
      const renewed = body.renewed ? "Expired link renewed. " : "";
      showNote(`${renewed}Delivery result: ${sent}${failed}`, 7500, body.failed?.length ? "warning" : "success");
      await load(tab, true);
    } else {
      showNote(`Reminder failed: ${body.error || body.failed?.join("; ") || "No message was sent. Add a client phone or email."}`, 6000, "error");
    }
  }

  async function sendCopies(row: Row) {
    const response = await fetch(`/api/intakes/${row.id}/copies`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.ok) {
      const sent = body.sent?.length ? body.sent.join(", ") : "No phone or email saved for this client.";
      const failed = body.failed?.length ? ` Not sent: ${body.failed.join("; ")}` : "";
      showNote(`Client copies queued: ${sent}${failed}`, 6000);
      await load(tab, true);
    } else {
      showNote(`Client-copy delivery failed: ${body.error || body.failed?.join("; ") || "No message was sent. Add a client phone or email."}`, 6000, "error");
    }
  }

  async function setAutoCopies(row: Row, autoSend: boolean) {
    const response = await fetch(`/api/intakes/${row.id}/copies/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoSend }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      showNote(`Automatic client-copy delivery ${autoSend ? "on" : "off"} for ${row.client.fullName}`);
      await load(tab, true);
    } else {
      showNote(`Auto-send update failed: ${body.error || response.status}`, 6000, "error");
    }
  }

  async function setProviderPacketEmail(row: Row, enabled: boolean) {
    const response = await fetch(`/api/intakes/${row.id}/copies/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoEmailProvider: enabled }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      showNote(`Automatic completed-packet email ${enabled ? "on" : "off"} for ${row.client.fullName}`);
      await load(tab, true);
    } else {
      showNote(`Provider packet email update failed: ${body.error || response.status}`, 6000, "error");
    }
  }

  async function sendProviderPacket(row: Row) {
    const response = await fetch(`/api/intakes/${row.id}/copies/provider`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      showNote(`Completed packet emailed to ${body.to || "the provider"}.`, 6000);
      await load(tab, true);
    } else {
      showNote(`Provider packet email failed: ${body.reason || body.detail || body.error || response.status}`, 6000, "error");
    }
  }

  async function markCompleted(row: Row) {
    const response = await fetch(`/api/intakes/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "COMPLETED" }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      const warnings: string[] = [];
      const delivery = body.completionDelivery || {};
      if (delivery.error) warnings.push(delivery.error);
      if (delivery.clientCopies?.body && delivery.clientCopies.body.ok === false) {
        warnings.push(delivery.clientCopies.body.error || delivery.clientCopies.body.failed?.join("; ") || "Client copies were not sent.");
      }
      if (
        delivery.providerPacket?.skipped
        && delivery.providerPacket.reason
        && !String(delivery.providerPacket.reason).toLowerCase().includes("off")
      ) {
        warnings.push(delivery.providerPacket.reason);
      }
      const message = warnings.length
        ? `${row.client.fullName} was marked completed, but delivery needs attention: ${warnings.join(" ")}`
        : `${row.client.fullName} marked completed. Automatic delivery settings were processed.`;
      showNote(message, 7000, warnings.length ? "error" : "success");
      await load(tab, true);
    } else {
      const blockers = body.blockers?.length
        ? ` ${body.blockers.map((item: { message?: string }) => item.message).filter(Boolean).join(" ")}`
        : "";
      showNote(`Could not mark completed: ${body.error || response.status}.${blockers}`, 7000, "error");
    }
  }

  async function setArchived(row: Row, archived: boolean) {
    if (archived) {
      const confirmed = window.confirm(
        `Archive ${row.client.fullName}? This removes the intake from the active dashboard but preserves the healthcare record. You can restore it from the Archived tab.`,
      );
      if (!confirmed) return;
    }
    const response = await fetch(`/api/intakes/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive: archived }),
    });
    if (response.ok) {
      showNote(`${row.client.fullName} ${archived ? "was removed from the active dashboard and archived" : "was restored"}.`);
      await load(tab, true);
    } else {
      const body = await response.json().catch(() => ({}));
      showNote(`Archive update failed: ${body.error || response.status}`, 6000, "error");
    }
  }

  async function sendDocuSign(row: Row) {
    const confirmed = window.confirm("Send the missing client or guardian signature fields through DocuSign? If staff fields are also missing, they will be routed to your signed-in staff account.");
    if (!confirmed) return;
    const response = await fetch(`/api/intakes/${row.id}/docusign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowStaffSigner: true }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      showNote(body.message || `DocuSign processed for ${row.client.fullName}. Envelope ${body.envelopeId || "created"}.`, 6000);
      await load(tab, true);
    } else {
      showNote(`DocuSign failed: ${body.error || response.status}`, 6000, "error");
    }
  }

  const trimmedSearch = search.trim().toLowerCase();
  const filteredRows = rows?.filter((row) => rowMatchesTab(row, tab) && (!trimmedSearch || rowSearchText(row).includes(trimmedSearch))) ?? null;

  const activeRows = rows?.filter((row) => !row.archived) ?? [];
  const totalCount = activeRows.length;
  const archivedCount = rows?.filter((row) => row.archived).length ?? 0;
  const needsActionCount = activeRows.filter(rowNeedsStaffAction).length;
  const waitingCount = activeRows.filter((row) => ["NOT_STARTED", "IN_PROGRESS"].includes(row.status)).length;
  const completedCount = activeRows.filter((row) => row.status === "COMPLETED").length;
  const readyToCompleteCount = activeRows.filter((row) => row.status !== "COMPLETED" && row.completionReady).length;
  const ccaCount = activeRows.filter((row) => row.hasCca).length;
  const tabCount = (key: string) => rows?.filter((row) => rowMatchesTab(row, key)).length ?? 0;
  const viewTotalCount = tab === "archived" ? archivedCount : totalCount;

  function downloadWorkflowReport() {
    if (!filteredRows?.length) {
      showNote("There are no intakes in this view to include in a report.", 4500, "error");
      return;
    }
    const reportRows = filteredRows.map((row) => {
      const latestTouch = row.lastActivityAt || row.submittedAt || row.createdAt;
      return [
        row.client.fullName,
        STATUS_LABELS[row.status] || row.status.replaceAll("_", " "),
        row.readiness.state,
        row.readiness.issues.join(" "),
        displayDateTime(latestTouch),
        Number.isNaN(new Date(latestTouch).getTime())
          ? ""
          : Math.max(0, Math.floor((Date.now() - new Date(latestTouch).getTime()) / 86400000)),
        `${row.percentComplete}%`,
        row.client.recordNumber || "",
        row.client.midNumber || "",
        displayDateTime(row.tokenExpiresAt),
        row.hasCca ? "Uploaded" : "Not uploaded",
        row.ccaDetail || "",
        row.packetState === "current" ? "Current" : row.packetState === "stale" ? "Outdated" : "Not generated",
        row.missingRequired.length,
        row.missingRequired.map((item) => item.label).join("; "),
        row.completionBlockers.map((item) => item.message).join("; "),
        row.copiesSentAt ? displayDateTime(row.copiesSentAt) : "Not sent",
        row.autoSendCopies ? "On" : "Off",
        row.autoEmailProviderPacket ? "On" : "Off",
        row.providerPacketEmailedAt ? displayDateTime(row.providerPacketEmailedAt) : "Not sent",
      ];
    });
    const headers = [
      "Client",
      "Status",
      "Next step",
      "Next step details",
      "Last activity",
      "Days since activity",
      "Client answer coverage",
      "Record #",
      "MID #",
      "Secure link expires",
      "CCA",
      "CCA result",
      "Packet status",
      "Missing required count",
      "Missing required items",
      "Completion blockers",
      "Client copies sent",
      "Auto-send records",
      "Provider packet email",
      "Provider packet last sent",
    ];
    const csv = [headers, ...reportRows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = reportFileName(providerName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showNote(`Downloaded a workflow report with ${filteredRows.length} intake${filteredRows.length === 1 ? "" : "s"}.`);
  }

  return (
    <main className="mx-auto max-w-7xl p-4 sm:p-6">
      {isMaster && (
        <div className="sticky top-2 z-30 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950 shadow-sm">
          <p className="font-semibold">Viewing as {providerName}</p>
          <Link href="/master/dashboard" className="btn-ghost border-sky-300 bg-white px-3 py-1.5 text-xs text-sky-950 hover:bg-sky-100">
            Return to master
          </Link>
        </div>
      )}
      <section className="rounded-2xl bg-gradient-to-br from-brand via-brand-dark to-slate-900 px-5 py-6 text-white shadow-xl sm:px-6 sm:py-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-light/90">Staff Workspace</p>
            <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{providerName} Intake Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-200">
              Review where each intake stands, spot missing information faster, and handle reminders, copies, packets, and signatures from one place.
              {readOnly ? " This reviewer login can view records but cannot change them." : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!readOnly && <Link href="/intakes/new" className="btn-primary bg-white text-brand hover:bg-slate-100">+ Create New Intake</Link>}
            {isMaster && <Link href="/master/dashboard" className="btn-ghost border-white/30 bg-white/10 text-white hover:bg-white/20">Master: providers &amp; packets</Link>}
            {!isMaster && canManageProvider && <Link href="/provider/settings" className="btn-ghost border-white/30 bg-white/10 text-white hover:bg-white/20">Provider: packet settings</Link>}
            <details className="relative [&>summary::-webkit-details-marker]:hidden">
              <summary className="btn-secondary cursor-pointer list-none bg-white/15 text-white hover:bg-white/25">More tools</summary>
              <div className="absolute right-0 z-30 mt-2 grid min-w-56 gap-1 rounded-lg border border-slate-200 bg-white p-2 text-slate-800 shadow-xl">
                {!readOnly && <Link href="/intakes/new-many" className="rounded-md px-3 py-2 text-sm font-semibold hover:bg-slate-100">Create many intakes</Link>}
                {(isMaster || canManageProvider) && <Link href="/admin/users" className="rounded-md px-3 py-2 text-sm font-semibold hover:bg-slate-100">Staff logins</Link>}
                {isMaster && <Link href="/admin/pdf-mapping" className="rounded-md px-3 py-2 text-sm font-semibold hover:bg-slate-100">PDF mapping</Link>}
                {isMaster && <a href="/api/admin/backup?confirmPhi=yes" className="rounded-md px-3 py-2 text-sm font-semibold hover:bg-slate-100" onClick={(event) => {
                  if (!window.confirm("This backup contains protected health information. Download it only to a private, encrypted location. Continue?")) {
                    event.preventDefault();
                  }
                }}>Download backup</a>}
                <button
                  className="rounded-md px-3 py-2 text-left text-sm font-semibold hover:bg-slate-100"
                  onClick={async () => {
                    await fetch("/api/auth/logout", { method: "POST" });
                    router.push(isMaster ? "/master" : "/provider");
                  }}
                >
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="All intakes" value={totalCount} active={tab === "all"} onClick={() => selectDashboardTab("all")} />
          <StatCard label="Needs staff action" value={needsActionCount} active={tab === "action"} onClick={() => selectDashboardTab("action")} />
          <StatCard label="Waiting on client" value={waitingCount} active={tab === "waiting"} onClick={() => selectDashboardTab("waiting")} />
          <StatCard label="Completed" value={completedCount} active={tab === "done"} onClick={() => selectDashboardTab("done")} />
          <StatCard label="Ready to complete" value={readyToCompleteCount} active={tab === "packet"} onClick={() => selectDashboardTab("packet")} />
          <StatCard label="CCA uploaded" value={ccaCount} active={tab === "cca"} onClick={() => selectDashboardTab("cca")} />
        </div>
      </section>

      {providerPacketReadiness && !providerPacketReadiness.ready && (
        <section role="alert" className="mt-4 flex flex-wrap items-start justify-between gap-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
          <div className="max-w-4xl">
            <h2 className="font-bold">Provider packet setup required before PDF or DocuSign</h2>
            <p className="mt-1 text-sm leading-6">{providerPacketReadiness.message}</p>
          </div>
          {(isMaster || canManageProvider) && (
            <Link href={isMaster ? "/master/dashboard#provider-packet-setup" : "/provider/settings"} className="btn-ghost border-amber-400 bg-white px-3 py-2 text-sm text-amber-950">
              Open packet setup
            </Link>
          )}
        </section>
      )}

      {note && (
        <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${
          noticeKind === "error"
            ? "bg-red-50 text-red-700"
            : noticeKind === "warning"
              ? "bg-amber-50 text-amber-800"
              : "bg-emerald-50 text-emerald-700"
        }`} role={noticeKind === "error" ? "alert" : "status"} aria-live="polite">
          <span>{note}</span>
          {noticeKind === "error" && <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => void load(tab)}>Try again</button>}
        </div>
      )}

      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Find the right intake fast</h2>
            <p className="text-sm text-slate-500">Search by client, MID, contact info, insurance, or the client&apos;s main concern.</p>
          </div>
          <p className="text-sm text-slate-500">
            Showing <span className="font-semibold text-slate-700">{filteredRows?.length ?? 0}</span> of{" "}
            <span className="font-semibold text-slate-700">{viewTotalCount}</span>
          </p>
        </div>

        <div className="mt-4 space-y-3">
          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search client, MID, email, phone, guardian, insurance, or intake reason"
          />
          <div className="flex flex-wrap items-center gap-2">
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={item.key === tab}
                className={item.key === tab ? "btn-primary min-h-11 px-3 py-2 text-sm" : "btn-ghost min-h-11 px-3 py-2 text-sm"}
                onClick={() => selectDashboardTab(item.key)}
              >
                {item.label} ({tabCount(item.key)})
              </button>
            ))}
            {trimmedSearch && (
              <button type="button" className="btn-ghost min-h-11 px-3 py-2 text-sm" onClick={() => setSearch("")}>
                Clear search
              </button>
            )}
            <button className="btn-ghost min-h-11 px-3 py-2 text-sm" disabled={refreshing} onClick={() => void load(tab)}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button
              className="btn-ghost min-h-11 px-3 py-2 text-sm"
              disabled={!filteredRows?.length}
              onClick={downloadWorkflowReport}
              title="Download the intakes in the current tab and search as a CSV file"
            >
              Download workflow report
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">The downloaded report contains client information. Store and share it securely.</p>
      </section>

      <section id="intake-results" className="mt-5 scroll-mt-4 space-y-4">
        {filteredRows === null && (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-slate-400 shadow-sm">
            Loading the intake dashboard...
          </div>
        )}

        {filteredRows?.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
            <h3 className="text-xl font-bold text-slate-800">No intakes match this view</h3>
            <p className="mt-2 text-sm text-slate-500">
              {tab === "action" && totalCount
                ? "Nothing needs staff action right now. You can still view every intake."
                : trimmedSearch
                  ? "No intake matched that search. Clear it or try a different name, MID, email, phone, or Record#."
                  : "Try a different tab to see more clients."}
            </p>
            {trimmedSearch && (
              <button className="btn-ghost mt-4 min-h-11 px-4 py-2 text-sm" onClick={() => setSearch("")}>
                Clear search
              </button>
            )}
            {tab !== "all" && totalCount > 0 && (
              <button className="btn-primary mt-4 min-h-11 px-4 py-2 text-sm" onClick={() => selectDashboardTab("all")}>
                View all intakes
              </button>
            )}
          </div>
        )}

        {filteredRows?.map((row) => {
          const latestTouch = row.lastActivityAt || row.submittedAt || row.createdAt;
          const missingPreview = row.missingRequired.length
            ? row.missingRequired.slice(0, 3).map((item) => item.label).join(", ")
            : "Everything required is in.";
          const statusLabel = STATUS_LABELS[row.status] || row.status.replaceAll("_", " ");
          const rowBusy = busyRowIds.has(row.id);
          const linkExpired = clientLinkExpired(row.tokenExpiresAt);
          const linkFinished = clientLinkMessagingFinished(row.status);
          const deliveryContacts = clientDeliveryContacts(row.client);
          const hasSavedContact = !!(deliveryContacts.phone || deliveryContacts.email);
          const openedCurrentDelivery = !!row.lastLinkOpenedAt && (
            !row.linkSentAt || Date.parse(row.lastLinkOpenedAt) >= Date.parse(row.linkSentAt)
          );
          const linkState = linkFinished
            ? "Finished"
            : linkExpired
              ? "Expired"
              : openedCurrentDelivery
                ? "Opened"
                : row.linkSentAt
                  ? "Sent"
                  : "Not sent";
          const linkDetail = linkFinished
            ? "Client intake messaging is closed"
            : linkExpired
              ? "Open the intake to renew the secure link"
              : openedCurrentDelivery
                ? `Last opened ${displayDateTime(row.lastLinkOpenedAt)}`
                : row.linkSentAt
                  ? `Last accepted ${displayDateTime(row.linkSentAt)}${row.reminderCount ? ` - ${row.reminderCount} accepted reminder${row.reminderCount === 1 ? "" : "s"}` : ""}`
                  : hasSavedContact
                    ? "Ready to send to the saved contact"
                    : "Add a phone or email before sending";

          return (
            <article
              key={row.id}
              id={`intake-${row.id}`}
              aria-busy={rowBusy}
              className={`rounded-[24px] border bg-white p-5 shadow-sm ${
                row.id === createdIntakeId ? "border-emerald-400 ring-4 ring-emerald-100" : "border-slate-200"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/intakes/${row.id}`} className="inline-flex min-h-11 items-center text-2xl font-bold tracking-tight text-brand hover:underline">
                      {row.client.fullName}
                    </Link>
                    <span className={`badge ${STATUS_COLORS[row.status] || "bg-slate-200 text-slate-700"}`}>{statusLabel}</span>
                    {row.docusignEnvelopeId && <span className="badge bg-emerald-50 text-emerald-700">DocuSign sent</span>}
                    {rowBusy && <span className="badge bg-slate-100 text-slate-700">Updating...</span>}
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    Last activity {displayDateTime(latestTouch)}
                    {row.submittedAt ? ` • Submitted ${displayDateTime(row.submittedAt)}` : ""}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-right">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Client answer coverage</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{row.percentComplete}%</p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetaCard label="DOB / Record" value={`${displayDate(row.client.dob)} • ${row.client.recordNumber || "No record #"}`} />
                <MetaCard label="MID / Insurance type" value={`${row.client.midNumber || "No MID"} • ${row.insuranceSummary || "Coverage not recorded"}`} />
                <MetaCard label="Contact" value={[row.client.phone, row.client.email].filter(Boolean).join(" • ") || "No phone or email saved"} />
                <MetaCard label="Guardian" value={row.client.guardianName || "No guardian on file"} />
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                <div className="rounded-2xl bg-amber-50/70 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">What brings the client in</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{row.presentingProblem || "No main concern recorded yet."}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatusTile
                    label="CCA"
                    state={row.hasCca ? "Ready" : "Needed"}
                    tone={row.hasCca ? "good" : "warn"}
                    detail={row.ccaDetail || (row.hasCca ? "CCA uploaded" : "Upload the clinician assessment")}
                  />
                  <StatusTile
                    label="Packet"
                    state={providerPacketReadiness?.ready === false ? "Setup required" : row.packetState === "current" ? "Current" : row.packetState === "stale" ? "Outdated" : "Pending"}
                    tone={providerPacketReadiness?.ready === false ? "warn" : row.packetState === "current" ? "good" : "warn"}
                    detail={providerPacketReadiness?.ready === false
                      ? "Master admin must approve and activate this provider's packet"
                      : row.packetState === "current"
                      ? "Completed packet matches the latest answers and signatures"
                      : row.packetState === "stale"
                        ? "Answers or signatures changed; generate the packet again"
                        : "Generate packet after review"}
                  />
                  <StatusTile
                    label="Client link"
                    state={linkState}
                    tone={linkFinished || openedCurrentDelivery ? "good" : linkExpired ? "warn" : "neutral"}
                    detail={linkDetail}
                  />
                  <StatusTile
                    label="Client copies"
                    state={row.copiesSentAt ? "Sent" : "Not sent"}
                    tone={row.copiesSentAt ? "good" : "neutral"}
                    detail={row.copiesSentAt ? displayDateTime(row.copiesSentAt) : "No completed client-copy delivery logged yet"}
                  />
                  <StatusTile
                    label="Auto-send"
                    state={row.autoSendCopies ? "On" : "Off"}
                    tone={row.autoSendCopies ? "brand" : "neutral"}
                    detail={row.autoSendCopies ? "Client copies send automatically after staff marks the intake completed" : "Staff sends client copies manually"}
                  />
                  <StatusTile
                    label="Provider email"
                    state={row.autoEmailProviderPacket ? "On" : "Off"}
                    tone={row.autoEmailProviderPacket ? "brand" : "neutral"}
                    detail={row.providerPacketEmailedAt ? `Sent ${displayDateTime(row.providerPacketEmailedAt)}` : row.autoEmailProviderPacket ? "Completed PDF emails to the provider address" : "Provider receives it only when staff sends it"}
                  />
                </div>
              </div>

              {!readOnly && <CcaAiPanel row={row} onImported={() => load(tab, true)} />}

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Missing required items</p>
                <p className={`mt-2 text-sm ${row.missingRequired.length ? "text-rose-700" : "font-semibold text-emerald-700"}`}>
                  {missingPreview}
                  {row.missingRequired.length > 3 ? ` + ${row.missingRequired.length - 3} more` : ""}
                </p>
                <div className={`mt-3 rounded-lg border px-3 py-2 ${
                  row.readiness.tone === "warn"
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : row.readiness.tone === "brand"
                      ? "border-brand/20 bg-brand-light/40 text-brand"
                      : "border-emerald-200 bg-emerald-50 text-emerald-800"
                }`}>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em]">Next step</p>
                  <p className="mt-1 text-sm font-bold">{row.readiness.state}</p>
                  {row.readiness.issues.length > 0 && <p className="mt-1 text-xs leading-5">{row.readiness.issues.join(" ")}</p>}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 [&>a]:min-h-11 [&>button]:min-h-11">
                <Link href={`/intakes/${row.id}`} className="btn-primary px-3 py-2 text-sm">Open intake</Link>
                {readOnly ? (
                  <p className="w-full text-sm text-slate-500">Reviewer accounts are read-only.</p>
                ) : (
                <button
                  type="button"
                  className="btn-ghost px-3 py-2 text-sm"
                  aria-expanded={editingClientId === row.id}
                  aria-controls={`client-details-${row.id}`}
                  disabled={rowBusy}
                  onClick={() => editingClientId === row.id ? closeClientEdit() : beginClientEdit(row)}
                >
                  {editingClientId === row.id ? "Close client details" : "Edit client details"}
                </button>
                )}
                <Link href={`/intakes/${row.id}/review`} className="btn-ghost px-3 py-2 text-sm">Review packet answers</Link>
                {!readOnly && !row.archived && row.status !== "COMPLETED" && row.completionReady && (
                  <button className="btn-ghost px-3 py-2 text-sm" disabled={rowBusy}
                    onClick={() => void runRowAction(row.id, () => markCompleted(row))}>
                    Mark completed
                  </button>
                )}
                <details className="w-full [&>summary::-webkit-details-marker]:hidden">
                  <summary className="btn-ghost inline-flex min-h-11 cursor-pointer list-none px-3 py-2 text-sm">
                    More actions
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 [&>a]:min-h-11 [&>button]:min-h-11">
                    {providerPacketReadiness?.ready === false ? (
                      <button className="btn-ghost px-3 py-2 text-sm" disabled title="Approve and activate this provider's packet before previewing a completed PDF">
                        Preview PDF unavailable
                      </button>
                    ) : (
                      <Link href={`/intakes/${row.id}/pdf-preview`} className="btn-ghost px-3 py-2 text-sm">Preview PDF</Link>
                    )}
                    {!readOnly && !row.archived && (
                      <>
                    {!linkFinished && !linkExpired && (
                      <button className="btn-ghost px-3 py-2 text-sm" onClick={() => copyLink(row)}>
                        Copy intake link
                      </button>
                    )}
                    {!linkFinished && linkExpired && (
                      <Link className="btn-ghost px-3 py-2 text-sm" href={`/intakes/${row.id}`}>
                        Open intake to renew link
                      </Link>
                    )}
                    {!linkFinished && (
                      <button
                        className="btn-ghost px-3 py-2 text-sm"
                        disabled={rowBusy || !hasSavedContact}
                        title={hasSavedContact ? "Send the secure link to the saved phone and email" : "Add a client phone or email first"}
                        onClick={() => void runRowAction(row.id, () => remind(row))}
                      >
                        {linkExpired ? "Renew & send link" : "Send intake reminder"}
                      </button>
                    )}
                    {["SIGNED", "COMPLETED"].includes(row.status) && (
                      <button className="btn-ghost px-3 py-2 text-sm" disabled={rowBusy}
                        onClick={() => void runRowAction(row.id, () => sendCopies(row))}>Send client copies</button>
                    )}
                    {["SIGNED", "COMPLETED"].includes(row.status) && (
                      <button className="btn-ghost px-3 py-2 text-sm" onClick={() => copyCompletedLink(row)}>Copy client-copies link</button>
                    )}
                    <button
                      className={row.autoSendCopies ? "btn-primary px-3 py-2 text-sm" : "btn-ghost px-3 py-2 text-sm"}
                      aria-pressed={!!row.autoSendCopies}
                      disabled={rowBusy}
                      title="Turn automatic delivery of completed client copies on or off"
                      onClick={() => void runRowAction(row.id, () => setAutoCopies(row, !row.autoSendCopies))}
                    >
                      Auto-send copies: {row.autoSendCopies ? "On" : "Off"}
                    </button>
                    <button
                      className={row.autoEmailProviderPacket ? "btn-primary px-3 py-2 text-sm" : "btn-ghost px-3 py-2 text-sm"}
                      aria-pressed={!!row.autoEmailProviderPacket}
                      disabled={rowBusy}
                      title="Turn automatic delivery of the completed PDF to the provider on or off"
                      onClick={() => void runRowAction(row.id, () => setProviderPacketEmail(row, !row.autoEmailProviderPacket))}
                    >
                      Provider packet email: {row.autoEmailProviderPacket ? "On" : "Off"}
                    </button>
                    {providerPacketReadiness?.ready !== false && row.packetState === "current" && row.status === "COMPLETED" && (
                      <button className="btn-ghost px-3 py-2 text-sm" disabled={rowBusy}
                        onClick={() => void runRowAction(row.id, () => sendProviderPacket(row))}>
                        Email provider now
                      </button>
                    )}
                    {providerPacketReadiness?.ready !== false && !row.docusignEnvelopeId && ["SUBMITTED", "NEEDS_REVIEW", "SIGNED", "COMPLETED"].includes(row.status) && (
                      <button className="btn-ghost px-3 py-2 text-sm" disabled={rowBusy}
                        title="Send only the missing signature fields through DocuSign"
                        onClick={() => void runRowAction(row.id, () => sendDocuSign(row))}>
                        Send missing signatures
                      </button>
                    )}
                      </>
                    )}
                    {!readOnly && (
                    <button className="btn-ghost px-3 py-2 text-sm" disabled={rowBusy}
                      onClick={() => void runRowAction(row.id, () => setArchived(row, tab !== "archived"))}>
                      {tab === "archived" ? "Restore to active dashboard" : "Archive / remove from dashboard"}
                    </button>
                    )}
                    {!readOnly && tab !== "archived" && (
                      <p className="w-full text-xs leading-5 text-slate-500">
                        Archiving hides this intake without permanently deleting the healthcare record.
                      </p>
                    )}
                  </div>
                </details>
              </div>

              {editingClientId === row.id && clientDraft && (
                <form
                  id={`client-details-${row.id}`}
                  className="mt-5 border-t border-slate-200 pt-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runRowAction(row.id, () => saveClientDetails(row));
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">Edit client details</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        These corrections update the dashboard and the matching answers used in the intake packet.
                      </p>
                    </div>
                    <button type="button" className="btn-ghost min-h-11 px-3 py-2 text-sm" onClick={closeClientEdit}>
                      Cancel
                    </button>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <label className="block text-sm font-semibold text-slate-700">
                      Client full name
                      <input
                        className="input mt-1"
                        autoFocus
                        required
                        value={clientDraft.fullName}
                        onChange={(event) => updateClientDraft("fullName", event.target.value)}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-700">
                      Date of birth
                      <input
                        className="input mt-1"
                        type="date"
                        required
                        value={clientDraft.dob}
                        onChange={(event) => updateClientDraft("dob", event.target.value)}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-700">
                      Record #
                      <input
                        className="input mt-1"
                        required
                        value={clientDraft.recordNumber}
                        onChange={(event) => updateClientDraft("recordNumber", event.target.value)}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-700">
                      MID #
                      <input
                        className="input mt-1"
                        value={clientDraft.midNumber}
                        onChange={(event) => updateClientDraft("midNumber", event.target.value)}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-700">
                      Client phone
                      <input
                        className="input mt-1"
                        type="tel"
                        inputMode="tel"
                        value={clientDraft.phone}
                        onChange={(event) => updateClientDraft("phone", event.target.value)}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-700">
                      Client email
                      <input
                        className="input mt-1"
                        type="email"
                        inputMode="email"
                        value={clientDraft.email}
                        onChange={(event) => updateClientDraft("email", event.target.value)}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-700">
                      Guardian name
                      <input
                        className="input mt-1"
                        value={clientDraft.guardianName}
                        onChange={(event) => updateClientDraft("guardianName", event.target.value)}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-700">
                      Guardian phone
                      <input
                        className="input mt-1"
                        type="tel"
                        inputMode="tel"
                        value={clientDraft.guardianPhone}
                        onChange={(event) => updateClientDraft("guardianPhone", event.target.value)}
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-700">
                      Guardian email
                      <input
                        className="input mt-1"
                        type="email"
                        inputMode="email"
                        value={clientDraft.guardianEmail}
                        onChange={(event) => updateClientDraft("guardianEmail", event.target.value)}
                      />
                    </label>
                  </div>

                  {clientEditError && (
                    <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700" role="alert">
                      {clientEditError}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button className="btn-primary min-h-11 px-4 py-2 text-sm" type="submit" disabled={rowBusy}>
                      {rowBusy ? "Saving..." : "Save client details"}
                    </button>
                    <button className="btn-ghost min-h-11 px-4 py-2 text-sm" type="button" onClick={closeClientEdit}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </article>
          );
        })}
      </section>

      <p className="mt-5 text-xs text-slate-400">
        HIPAA note: before using with real clients, make sure hosting and vendors have signed privacy agreements and a compliance review is complete.
      </p>
    </main>
  );
}

function CcaAiPanel({ row, onImported }: { row: Row; onImported: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [hasUploaded, setHasUploaded] = useState(row.hasCca);
  const [result, setResult] = useState("");
  const [resultKind, setResultKind] = useState<"success" | "error" | "info">("info");

  async function uploadCca(file: File, input: HTMLInputElement) {
    setBusy(true);
    setResult("Reading the CCA with AI. This can take a minute or two...");
    setResultKind("info");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("overwrite", String(overwrite));
      const response = await fetch(`/api/intakes/${row.id}/cca`, { method: "POST", body: form });
      const body = await response.json().catch(() => ({} as { error?: string }));
      if (!response.ok) {
        setResultKind("error");
        setResult(body.error || "CCA import failed. Please try again.");
        return;
      }
      const filled = Number(body.filled || 0);
      const extracted = Number(body.extracted || 0);
      const skipped = Number(body.skipped || 0);
      setHasUploaded(true);
      setResultKind("success");
      setResult(`CCA uploaded and AI filled ${filled} intake question${filled === 1 ? "" : "s"}` +
        (extracted && extracted !== filled ? ` (${extracted} found${skipped ? `, ${skipped} existing answers kept` : ""})` : "") +
        ". Review the answers before generating the packet.");
      await onImported();
    } catch {
      setResultKind("error");
      setResult("Connection problem. The CCA was not uploaded.");
    } finally {
      setBusy(false);
      input.value = "";
    }
  }

  return (
    <div className="mt-4">
      <button type="button" onClick={() => setOpen((current) => !current)}
        className={`min-h-11 rounded-full px-4 py-2 text-sm font-bold ${open ? "bg-brand text-white" : "bg-brand-light text-brand hover:bg-brand/10"}`}>
        {open ? "Hide CCA & AI" : "CCA & AI - Upload assessment"}
      </button>
      {open && (
        <div className="mt-3 rounded-2xl border border-brand/30 bg-brand-light/30 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-brand">Upload CCA &amp; fill answers with AI</h3>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                Add the clinician&apos;s Comprehensive Clinical Assessment as a PDF or photo. The AI will read it,
                fill matching intake answers, and leave consent and signature for the client.
              </p>
            </div>
            {hasUploaded && <span className="badge bg-emerald-100 text-emerald-800">CCA uploaded</span>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className={`btn-primary cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
              {busy ? "Reading CCA..." : "Choose CCA PDF / photo"}
              <input type="file" className="hidden" accept="application/pdf,image/*" disabled={busy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void uploadCca(file, event.currentTarget);
                }} />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
              Replace existing answers
            </label>
          </div>
          {result && (
            <p className={`mt-3 rounded-lg p-3 text-sm font-semibold ${
              resultKind === "success" ? "bg-emerald-50 text-emerald-700" :
              resultKind === "error" ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-700"
            }`} role="status">{result}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/intakes/${row.id}/review`} className="btn-secondary px-3 py-2 text-sm">Review AI-filled answers</Link>
            <Link href={`/intakes/${row.id}`} className="btn-ghost px-3 py-2 text-sm">Open intake &amp; preflight</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, active, onClick }: { label: string; value: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${label}: ${value}. ${active ? "Currently showing below" : "Click to view"}`}
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-white/80 ${
        active
          ? "border-white/60 bg-white/25 shadow-lg"
          : "border-white/10 bg-white/10 hover:border-white/30 hover:bg-white/15"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      <p className="mt-1 text-[11px] font-semibold text-slate-300">{active ? "Showing below" : "Click to view"}</p>
    </button>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 break-words text-sm font-semibold leading-6 text-slate-800">{value}</p>
    </div>
  );
}

function StatusTile({
  label,
  state,
  detail,
  tone,
}: {
  label: string;
  state: string;
  detail: string;
  tone: "good" | "warn" | "neutral" | "brand";
}) {
  const styles = {
    good: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
    neutral: "border-slate-200 bg-slate-50 text-slate-700",
    brand: "border-brand/20 bg-brand-light/40 text-brand",
  }[tone];

  return (
    <div className={`rounded-2xl border px-4 py-3 ${styles}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em]">{label}</p>
      <p className="mt-2 text-base font-bold">{state}</p>
      <p className="mt-1 text-xs leading-5">{detail}</p>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-slate-500">Opening the intake dashboard...</main>}>
      <Dashboard />
    </Suspense>
  );
}
