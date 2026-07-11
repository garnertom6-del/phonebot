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
};

const TABS: DashboardTab[] = [
  { key: "action", label: "Needs action", statuses: ["SUBMITTED", "NEEDS_REVIEW"] },
  { key: "waiting", label: "Waiting on client", statuses: ["NOT_STARTED", "IN_PROGRESS"] },
  { key: "signed", label: "Signed", statuses: ["SIGNED"] },
  { key: "done", label: "Done", statuses: ["COMPLETED"] },
  { key: "copies", label: "Completed copies", statuses: ["SUBMITTED", "NEEDS_REVIEW", "SIGNED", "COMPLETED"] },
  { key: "all", label: "All", statuses: [] as string[] },
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
  return tabDef.statuses.includes(row.status);
}

function rowSearchText(row: Row) {
  return [
    row.client.fullName,
    row.client.dob,
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
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [providerName, setProviderName] = useState("Moore Divine Care");
  const [isMaster, setIsMaster] = useState(false);

  const load = useCallback((activeTab: string = "all") => {
    fetch(`/api/intakes${activeTab === "archived" ? "?archived=1" : ""}`).then(async (response) => {
      if (response.status === 401) return router.push("/login");
      const text = await response.text();
      const body = text ? JSON.parse(text) : {};
      if (!response.ok) throw new Error(body.error || `Dashboard load failed (${response.status})`);
      setRows(body.intakes ?? []);
      setProviderName(body.provider?.name || "Provider");
      setIsMaster(!!body.isMaster);
    }).catch((err) => {
      setRows([]);
      setNote(err instanceof Error ? err.message : "Couldn't load the intake list right now.");
    });
  }, [router]);

  useEffect(() => { load(tab); }, [load, tab]);

  function showNote(message: string, timeout = 4500) {
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
    showNote(`Completed copies link copied for ${row.client.fullName}`, 2500);
  }

  async function remind(row: Row) {
    const response = await fetch(`/api/intakes/${row.id}/remind`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      const sent = body.sent?.length ? body.sent.join(", ") : "No phone or email saved for this client.";
      const failed = body.failed?.length ? ` Not sent: ${body.failed.join("; ")}` : "";
      showNote(`Reminder queued: ${sent}${failed}`, 6000);
    } else {
      showNote(`Reminder failed: ${body.error || response.status}`, 6000);
    }
  }

  async function sendCopies(row: Row) {
    const response = await fetch(`/api/intakes/${row.id}/copies`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      const sent = body.sent?.length ? body.sent.join(", ") : "No phone or email saved for this client.";
      const failed = body.failed?.length ? ` Not sent: ${body.failed.join("; ")}` : "";
      showNote(`Completed copies queued: ${sent}${failed}`, 6000);
      load(tab);
    } else {
      showNote(`Completed copies failed: ${body.error || response.status}`, 6000);
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
      showNote(`Auto-send completed copies ${autoSend ? "on" : "off"} for ${row.client.fullName}`);
      load(tab);
    } else {
      showNote(`Auto-send update failed: ${body.error || response.status}`, 6000);
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
      showNote(`Could not mark completed: ${body.error || response.status}`, 6000);
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
      showNote(`Archive update failed: ${body.error || response.status}`, 6000);
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
      showNote(`DocuSign failed: ${body.error || response.status}`, 6000);
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

      {note && <p className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{note}</p>}

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
          <div className="flex flex-wrap gap-2">
            {TABS.map((item) => (
              <button
                key={item.key}
                className={item.key === tab ? "btn-primary px-3 py-2 text-sm" : "btn-ghost px-3 py-2 text-sm"}
                onClick={() => setTab(item.key)}
              >
                {item.label}
              </button>
            ))}
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
                <MetaCard label="DOB / MID" value={`${displayDate(row.client.dob)} • ${row.client.midNumber || "No MID"}`} />
                <MetaCard label="Contact" value={[row.client.phone, row.client.email].filter(Boolean).join(" • ") || "No phone or email saved"} />
                <MetaCard label="Guardian" value={row.client.guardianName || "No guardian on file"} />
                <MetaCard label="Coverage" value={row.insuranceSummary || "Coverage not recorded"} />
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
                    label="Copies"
                    state={row.copiesSentAt ? "Sent" : "Not sent"}
                    tone={row.copiesSentAt ? "good" : "neutral"}
                    detail={row.copiesSentAt ? displayDateTime(row.copiesSentAt) : "No copies delivery logged yet"}
                  />
                  <StatusTile
                    label="Auto-send"
                    state={row.autoSendCopies ? "On" : "Off"}
                    tone={row.autoSendCopies ? "brand" : "neutral"}
                    detail={row.autoSendCopies ? "Completed copies send automatically" : "Staff sends copies manually"}
                  />
                </div>
              </div>

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
                <button className="btn-ghost px-3 py-2 text-sm" onClick={() => sendCopies(row)}>Send copies</button>
                <button className="btn-ghost px-3 py-2 text-sm" onClick={() => copyCompletedLink(row)}>Copy copies link</button>
                <button className="btn-ghost px-3 py-2 text-sm" onClick={() => setAutoCopies(row, !row.autoSendCopies)}>
                  Auto-send {row.autoSendCopies ? "off" : "on"}
                </button>
                {!row.docusignEnvelopeId && (
                  <button className="btn-ghost px-3 py-2 text-sm" onClick={() => sendDocuSign(row)}>
                    Send DocuSign
                  </button>
                )}
                {row.status !== "COMPLETED" && (
                  <button className="btn-ghost px-3 py-2 text-sm" onClick={() => markCompleted(row)}>
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
