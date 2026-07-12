"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface Row {
  id: string;
  status: string;
  archived?: boolean;
  percentComplete: number;
  hasPdf: boolean;
  hasCca: boolean;
  ccaDetail?: string;
  copiesSentAt?: string | null;
  autoSendCopies?: boolean;
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
  };
  missingRequired: { key: string; label: string }[];
  linkSentAt?: string;
  lastActivityAt?: string;
  submittedAt?: string;
  createdAt?: string;
  token: string;
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
  SIGNED: "Signed",
  COMPLETED: "Completed",
};

type DashboardTab = {
  key: string;
  label: string;
  statuses: string[];
  matches?: (row: Row) => boolean;
};

const TABS: DashboardTab[] = [
  { key: "action", label: "Needs action", statuses: ["SUBMITTED", "NEEDS_REVIEW"] },
  { key: "waiting", label: "Waiting on client", statuses: ["NOT_STARTED", "IN_PROGRESS"] },
  { key: "signed", label: "Signed", statuses: ["SIGNED"] },
  { key: "done", label: "Completed", statuses: ["COMPLETED"] },
  { key: "packet", label: "Packet ready", statuses: [], matches: (row) => row.hasPdf },
  { key: "cca", label: "CCA uploaded", statuses: [], matches: (row) => row.hasCca },
  { key: "copies", label: "Client records", statuses: ["SUBMITTED", "NEEDS_REVIEW", "SIGNED", "COMPLETED"] },
  { key: "all", label: "All intakes", statuses: [] as string[] },
  { key: "archived", label: "Archived", statuses: [] as string[] },
];

function displayDate(value?: string): string {
  if (!value) return "-";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
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

export default function Dashboard() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState("");
  const [noticeKind, setNoticeKind] = useState<"success" | "error">("success");
  const [tab, setTab] = useState("action");
  const [search, setSearch] = useState("");
  const [providerName, setProviderName] = useState("Provider");
  const [isMaster, setIsMaster] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (activeTab: string = "all") => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/intakes${activeTab === "archived" ? "?archived=1" : ""}`);
      if (response.status === 401) {
        router.push("/login");
        return;
      }
      const text = await response.text();
      const body = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(body.error || `Dashboard load failed (${response.status})`);
      setRows(body.intakes ?? []);
      setProviderName(body.provider?.name || "Provider");
      setIsMaster(!!body.isMaster);
      setNote("");
    } catch (err) {
      setNoticeKind("error");
      setNote(err instanceof Error ? err.message : "Couldn't load the intake list right now.");
      setRows((current) => current ?? []);
    } finally {
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => { load(tab); }, [load, tab]);

  function showNote(message: string, timeout = 4500, kind: "success" | "error" = "success") {
    setNoticeKind(kind);
    setNote(message);
    window.setTimeout(() => setNote(""), timeout);
  }

  async function copyLink(row: Row) {
    const link = `${window.location.origin}/intake/${row.token}`;
    await navigator.clipboard.writeText(link);
    showNote(`Intake link copied for ${row.client.fullName}`, 2500);
  }

  async function copyCompletedLink(row: Row) {
    const link = `${window.location.origin}/copies/${row.token}`;
    await navigator.clipboard.writeText(link);
    showNote(`Client records link copied for ${row.client.fullName}`, 2500);
  }

  async function remind(row: Row) {
    const response = await fetch(`/api/intakes/${row.id}/remind`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      const sent = body.sent?.length ? body.sent.join(", ") : "No phone or email saved for this client.";
      const failed = body.failed?.length ? ` Not sent: ${body.failed.join("; ")}` : "";
      showNote(`Reminder queued: ${sent}${failed}`, 6000);
    } else {
      showNote(`Reminder failed: ${body.error || response.status}`, 6000, "error");
    }
  }

  async function sendCopies(row: Row) {
    const response = await fetch(`/api/intakes/${row.id}/copies`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      const sent = body.sent?.length ? body.sent.join(", ") : "No phone or email saved for this client.";
      const failed = body.failed?.length ? ` Not sent: ${body.failed.join("; ")}` : "";
      showNote(`Completed intake + client records queued: ${sent}${failed}`, 6000);
      load(tab);
    } else {
      showNote(`Completed intake + client records failed: ${body.error || response.status}`, 6000, "error");
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
      showNote(`Auto-send completed intake + client records ${autoSend ? "on" : "off"} for ${row.client.fullName}`);
      load(tab);
    } else {
      showNote(`Auto-send update failed: ${body.error || response.status}`, 6000, "error");
    }
  }

  async function markCompleted(row: Row) {
    const response = await fetch(`/api/intakes/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "COMPLETED" }),
    });
    if (response.ok) {
      showNote(`${row.client.fullName} marked completed.`);
      load(tab);
    } else {
      const body = await response.json().catch(() => ({}));
      showNote(`Could not mark completed: ${body.error || response.status}`, 6000, "error");
    }
  }

  async function setArchived(row: Row, archived: boolean) {
    const response = await fetch(`/api/intakes/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive: archived }),
    });
    if (response.ok) {
      showNote(`${row.client.fullName} ${archived ? "archived" : "restored"}.`);
      load(tab);
    } else {
      const body = await response.json().catch(() => ({}));
      showNote(`Archive update failed: ${body.error || response.status}`, 6000, "error");
    }
  }

  async function sendDocuSign(row: Row) {
    if (!row.client.email) {
      showNote("Client needs an email address before DocuSign can be sent.", 5000);
      return;
    }
    const response = await fetch(`/api/intakes/${row.id}/docusign`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      showNote(`DocuSign sent for ${row.client.fullName}. Envelope ${body.envelopeId || "created"}.`, 6000);
      load(tab);
    } else {
      showNote(`DocuSign failed: ${body.error || response.status}`, 6000, "error");
    }
  }

  const trimmedSearch = search.trim().toLowerCase();
  const filteredRows = rows?.filter((row) => rowMatchesTab(row, tab) && (!trimmedSearch || rowSearchText(row).includes(trimmedSearch))) ?? null;

  const totalCount = rows?.length ?? 0;
  const needsActionCount = rows?.filter((row) => ["SUBMITTED", "NEEDS_REVIEW"].includes(row.status)).length ?? 0;
  const waitingCount = rows?.filter((row) => ["NOT_STARTED", "IN_PROGRESS"].includes(row.status)).length ?? 0;
  const completedCount = rows?.filter((row) => row.status === "COMPLETED").length ?? 0;
  const packetReadyCount = rows?.filter((row) => row.hasPdf).length ?? 0;
  const ccaCount = rows?.filter((row) => row.hasCca).length ?? 0;
  const tabCount = (key: string) => rows?.filter((row) => rowMatchesTab(row, key)).length ?? 0;

  return (
    <main className="mx-auto max-w-7xl p-6">
      <section className="overflow-hidden rounded-[28px] bg-gradient-to-br from-brand via-brand-dark to-slate-900 px-6 py-7 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-light/90">Staff Workspace</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight">{providerName} Intake Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-200">
              Review where each intake stands, spot missing information faster, and handle reminders, copies, packets, and signatures from one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isMaster && <Link href="/master/dashboard" className="btn-ghost border-white/30 bg-white/10 text-white hover:bg-white/20">Master dashboard</Link>}
            {isMaster && <a href="/api/admin/backup" className="btn-ghost border-white/30 bg-white/10 text-white hover:bg-white/20">Download backup</a>}
            {isMaster && <Link href="/admin/pdf-mapping" className="btn-ghost border-white/30 bg-white/10 text-white hover:bg-white/20">PDF mapping</Link>}
            <Link href="/admin/users" className="btn-ghost border-white/30 bg-white/10 text-white hover:bg-white/20">Staff logins</Link>
            <Link href="/intakes/new-many" className="btn-secondary bg-white/15 text-white hover:bg-white/25">+ Create Many</Link>
            <Link href="/intakes/new" className="btn-primary bg-white text-brand hover:bg-slate-100">+ Create New Intake</Link>
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

        <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label={tab === "archived" ? "Archived" : "All intakes"} value={totalCount} />
          <StatCard label="Needs action" value={needsActionCount} />
          <StatCard label="Waiting on client" value={waitingCount} />
          <StatCard label="Completed" value={completedCount} />
          <StatCard label="Packets ready" value={packetReadyCount} />
          <StatCard label="CCA uploaded" value={ccaCount} />
        </div>
      </section>

      {note && (
        <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${
          noticeKind === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
        }`} role="status">
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
            <span className="font-semibold text-slate-700">{rows?.length ?? 0}</span>
          </p>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
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
                className={item.key === tab ? "btn-primary px-3 py-2 text-sm" : "btn-ghost px-3 py-2 text-sm"}
                onClick={() => setTab(item.key)}
              >
                {item.label} ({tabCount(item.key)})
              </button>
            ))}
            <button className="btn-ghost px-3 py-2 text-sm" disabled={refreshing} onClick={() => void load(tab)}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
      </section>

      <section className="mt-5 space-y-4">
        {filteredRows === null && (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-slate-400 shadow-sm">
            Loading the intake dashboard...
          </div>
        )}

        {filteredRows?.length === 0 && (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
            <h3 className="text-xl font-bold text-slate-800">No intakes match this view</h3>
            <p className="mt-2 text-sm text-slate-500">Try a different tab or clear the search to see more clients.</p>
          </div>
        )}

        {filteredRows?.map((row) => {
          const latestTouch = row.lastActivityAt || row.submittedAt || row.createdAt;
          const missingPreview = row.missingRequired.length
            ? row.missingRequired.slice(0, 3).map((item) => item.label).join(", ")
            : "Everything required is in.";
          const statusLabel = STATUS_LABELS[row.status] || row.status.replaceAll("_", " ");

          return (
            <article key={row.id} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/intakes/${row.id}`} className="text-2xl font-bold tracking-tight text-brand hover:underline">
                      {row.client.fullName}
                    </Link>
                    <span className={`badge ${STATUS_COLORS[row.status] || "bg-slate-200 text-slate-700"}`}>{statusLabel}</span>
                    {row.docusignEnvelopeId && <span className="badge bg-emerald-50 text-emerald-700">DocuSign sent</span>}
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    Last activity {displayDateTime(latestTouch)}
                    {row.submittedAt ? ` • Submitted ${displayDateTime(row.submittedAt)}` : ""}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-right">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Completion</p>
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
                    state={row.hasPdf ? "Generated" : "Pending"}
                    tone={row.hasPdf ? "good" : "warn"}
                    detail={row.hasPdf ? "Completed packet is ready" : "Generate packet after review"}
                  />
                  <StatusTile
                    label="Client records"
                    state={row.copiesSentAt ? "Sent" : "Not sent"}
                    tone={row.copiesSentAt ? "good" : "neutral"}
                    detail={row.copiesSentAt ? displayDateTime(row.copiesSentAt) : "No completed intake delivery logged yet"}
                  />
                  <StatusTile
                    label="Auto-send"
                    state={row.autoSendCopies ? "On" : "Off"}
                    tone={row.autoSendCopies ? "brand" : "neutral"}
                    detail={row.autoSendCopies ? "Completed intake + client records send automatically" : "Staff sends client records manually"}
                  />
                </div>
              </div>

              <CcaAiPanel row={row} />

              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Missing required items</p>
                <p className={`mt-2 text-sm ${row.missingRequired.length ? "text-rose-700" : "font-semibold text-emerald-700"}`}>
                  {missingPreview}
                  {row.missingRequired.length > 3 ? ` + ${row.missingRequired.length - 3} more` : ""}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={`/intakes/${row.id}`} className="btn-primary px-3 py-2 text-sm">Open intake</Link>
                <Link href={`/intakes/${row.id}/review`} className="btn-ghost px-3 py-2 text-sm">Review / edit</Link>
                <Link href={`/intakes/${row.id}/pdf-preview`} className="btn-ghost px-3 py-2 text-sm">Preview PDF</Link>
                <button className="btn-ghost px-3 py-2 text-sm" onClick={() => copyLink(row)}>Copy intake link</button>
                <button className="btn-ghost px-3 py-2 text-sm" onClick={() => remind(row)}>Send reminder</button>
                {row.hasPdf && ["SUBMITTED", "NEEDS_REVIEW", "SIGNED", "COMPLETED"].includes(row.status) && (
                  <button className="btn-ghost px-3 py-2 text-sm" onClick={() => sendCopies(row)}>Send client records</button>
                )}
                {row.hasPdf && <button className="btn-ghost px-3 py-2 text-sm" onClick={() => copyCompletedLink(row)}>Copy records link</button>}
                <button className="btn-ghost px-3 py-2 text-sm" onClick={() => setAutoCopies(row, !row.autoSendCopies)}>
                  Auto-send records {row.autoSendCopies ? "off" : "on"}
                </button>
                {!row.docusignEnvelopeId && (
                  <button className="btn-ghost px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50" disabled={!row.client.email} title={row.client.email ? "Send the packet for signature" : "Add a client email before sending DocuSign"} onClick={() => sendDocuSign(row)}>
                    Send DocuSign
                  </button>
                )}
                {row.status !== "COMPLETED" && (
                  <button className="btn-ghost px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50" disabled={!row.hasPdf || row.missingRequired.length > 0} title={row.hasPdf && !row.missingRequired.length ? "Mark this intake completed" : "Generate the packet and finish required items first"} onClick={() => markCompleted(row)}>
                    Mark completed
                  </button>
                )}
                <button className="btn-ghost px-3 py-2 text-sm" onClick={() => setArchived(row, tab !== "archived")}>
                  {tab === "archived" ? "Restore" : "Archive"}
                </button>
              </div>
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

function CcaAiPanel({ row }: { row: Row }) {
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
        className={`rounded-full px-4 py-2 text-sm font-bold ${open ? "bg-brand text-white" : "bg-brand-light text-brand hover:bg-brand/10"}`}>
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
            <Link href={`/intakes/${row.id}`} className="btn-ghost px-3 py-2 text-sm">Open intake setup</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-800">{value}</p>
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
