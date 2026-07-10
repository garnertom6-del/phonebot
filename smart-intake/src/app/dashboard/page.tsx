"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface Row {
  id: string; status: string; percentComplete: number; hasPdf: boolean;
  hasCca: boolean; ccaDetail?: string;
  copiesSentAt?: string | null; autoSendCopies?: boolean;
  client: { fullName: string; dob: string; midNumber?: string; phone?: string; email?: string; guardianName?: string };
  missingRequired: { key: string; label: string }[];
  linkSentAt?: string; lastActivityAt?: string; submittedAt?: string; token: string;
}

const STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: "bg-slate-200 text-slate-700", IN_PROGRESS: "bg-amber-100 text-amber-800",
  SUBMITTED: "bg-blue-100 text-blue-800", NEEDS_REVIEW: "bg-purple-100 text-purple-800",
  SIGNED: "bg-emerald-100 text-emerald-800", COMPLETED: "bg-emerald-600 text-white",
};

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not started", IN_PROGRESS: "In progress", SUBMITTED: "Submitted",
  NEEDS_REVIEW: "Needs review", SIGNED: "Signed", COMPLETED: "Completed",
};

/** Show dates as MM/DD/YYYY even when stored as ISO (YYYY-MM-DD). */
function displayDate(v?: string): string {
  if (!v) return "-";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : v;
}

const TABS = [
  { key: "action", label: "Needs action", statuses: ["SUBMITTED", "NEEDS_REVIEW"] },
  { key: "waiting", label: "Waiting on client", statuses: ["NOT_STARTED", "IN_PROGRESS"] },
  { key: "signed", label: "Signed", statuses: ["SIGNED"] },
  { key: "done", label: "Done", statuses: ["COMPLETED"] },
  { key: "copies", label: "Completed copies", statuses: ["SUBMITTED", "NEEDS_REVIEW", "SIGNED", "COMPLETED"] },
  { key: "all", label: "All", statuses: [] as string[] },
  { key: "archived", label: "Archived", statuses: [] as string[] },
];

export default function Dashboard() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState("all");
  const [providerName, setProviderName] = useState("Moore Divine Care");
  const [isMaster, setIsMaster] = useState(false);

  const load = useCallback((activeTab: string = "all") => {
    fetch(`/api/intakes${activeTab === "archived" ? "?archived=1" : ""}`).then(async (r) => {
      if (r.status === 401) return router.push("/login");
      const text = await r.text();
      const body = text ? JSON.parse(text) : {};
      if (!r.ok) throw new Error(body.error || `Dashboard load failed (${r.status})`);
      setRows(body.intakes ?? []);
      setProviderName(body.provider?.name || "Provider");
      setIsMaster(!!body.isMaster);
    }).catch((err) => {
      setRows([]);
      setNote(err instanceof Error ? err.message : "Couldn't load the intake list right now.");
    });
  }, [router]);
  useEffect(() => { load(tab); }, [load, tab]);

  const tabDef = TABS.find((t) => t.key === tab);
  const visible = rows?.filter((r) =>
    tab === "archived" || tab === "all" || tabDef?.statuses.includes(r.status)) ?? null;

  async function copyLink(row: Row) {
    const link = `${window.location.origin}/intake/${row.token}`;
    await navigator.clipboard.writeText(link);
    setNote(`Link copied for ${row.client.fullName}`);
    setTimeout(() => setNote(""), 2500);
  }
  async function copyCompletedLink(row: Row) {
    const link = `${window.location.origin}/copies/${row.token}`;
    await navigator.clipboard.writeText(link);
    setNote(`Completed copy link copied for ${row.client.fullName}`);
    setTimeout(() => setNote(""), 2500);
  }
  async function remind(row: Row) {
    const r = await fetch(`/api/intakes/${row.id}/remind`, { method: "POST" });
    const b = await r.json().catch(() => ({}));
    if (r.ok) {
      const sent = b.sent?.length ? `Queued: ${b.sent.join(", ")}` : "No phone or email saved for this client.";
      const failed = b.failed?.length ? ` Not sent: ${b.failed.join("; ")}` : "";
      setNote(`${sent}${failed}`);
    } else {
      setNote(`Not sent: ${b.failed?.join("; ") || b.error || r.status}`);
    }
    setTimeout(() => setNote(""), 6000);
  }
  async function sendCopies(row: Row) {
    const r = await fetch(`/api/intakes/${row.id}/copies`, { method: "POST" });
    const b = await r.json().catch(() => ({}));
    if (r.ok) {
      const sent = b.sent?.length ? `Queued: ${b.sent.join(", ")}` : "No phone or email saved for this client.";
      const failed = b.failed?.length ? ` Not sent: ${b.failed.join("; ")}` : "";
      setNote(`${sent}${failed}`);
      load(tab);
    } else {
      setNote(`Completed copies not sent: ${b.failed?.join("; ") || b.error || r.status}`);
    }
    setTimeout(() => setNote(""), 6000);
  }
  async function setAutoCopies(row: Row, autoSend: boolean) {
    const r = await fetch(`/api/intakes/${row.id}/copies/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoSend }),
    });
    const b = await r.json().catch(() => ({}));
    if (r.ok) {
      setNote(`Auto-send completed copies ${autoSend ? "on" : "off"} for ${row.client.fullName}`);
      load(tab);
    } else {
      setNote(`Auto-send update failed: ${b.error || r.status}`);
    }
    setTimeout(() => setNote(""), 6000);
  }
  async function markCompleted(row: Row) {
    await fetch(`/api/intakes/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "COMPLETED" }) });
    load(tab);
  }
  async function setArchived(row: Row, archived: boolean) {
    await fetch(`/api/intakes/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archive: archived }) });
    load(tab);
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand">{providerName} - Intake Dashboard</h1>
          <p className="text-sm text-slate-500">Client Intake Package automation</p>
        </div>
        <div className="flex gap-2">
          {isMaster && <Link href="/master/dashboard" className="btn-ghost">Master dashboard</Link>}
          {isMaster && <a href="/api/admin/backup" className="btn-ghost" title="Download a full copy of all client data - keep it somewhere safe">Download backup</a>}
          {isMaster && <Link href="/admin/pdf-mapping" className="btn-ghost">PDF mapping</Link>}
          <Link href="/intakes/new-many" className="btn-secondary">+ Create Many</Link>
          <Link href="/intakes/new" className="btn-primary">+ Create New Intake</Link>
          <button className="btn-secondary" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); }}>Sign out</button>
        </div>
      </div>
      {note && <p className="mb-3 rounded-lg bg-emerald-50 p-2 text-sm font-semibold text-emerald-700">{note}</p>}
      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${tab === t.key ? "bg-brand text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {["Client", "DOB", "MID#", "Contact", "Guardian", "Status", "CCA / Packet", "Copies", "Missing required", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible === null && <tr><td colSpan={10} className="p-6 text-center text-slate-400">Loading...</td></tr>}
            {visible?.length === 0 && <tr><td colSpan={10} className="p-6 text-center text-slate-400">
              {tab === "all" ? "No intakes yet - create one!" : "Nothing here right now."}</td></tr>}
            {visible?.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 font-semibold">
                  <Link className="text-brand hover:underline" href={`/intakes/${r.id}`}>{r.client.fullName}</Link>
                </td>
                <td className="px-4 py-3">{displayDate(r.client.dob)}</td>
                <td className="px-4 py-3">{r.client.midNumber || "-"}</td>
                <td className="px-4 py-3 text-xs">{r.client.phone}<br />{r.client.email}</td>
                <td className="px-4 py-3">{r.client.guardianName || "-"}</td>
                <td className="px-4 py-3"><span className={`badge ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status] || r.status.replace("_", " ")}</span></td>
                <td className="px-4 py-3 text-xs">
                  <div className="flex flex-col gap-1">
                    <span className={`badge ${r.hasCca ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                      {r.hasCca ? "CCA uploaded" : "CCA needed"}
                    </span>
                    <span className={`badge ${r.hasPdf ? "bg-emerald-600 text-white" : "bg-amber-100 text-amber-800"}`}>
                      {r.hasPdf ? "Packet generated" : "Packet not generated yet"}
                    </span>
                    <span className="text-slate-400">{r.percentComplete}% answered</span>
                    {r.ccaDetail && <span className="text-emerald-700">{r.ccaDetail}</span>}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs">
                  <div className="flex flex-col gap-1">
                    <span className={`badge ${r.copiesSentAt ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
                      {r.copiesSentAt ? `Sent ${new Date(r.copiesSentAt).toLocaleDateString()}` : "Not sent"}
                    </span>
                    <span className={`badge ${r.autoSendCopies ? "bg-brand text-white" : "bg-slate-100 text-slate-600"}`}>
                      Auto-send {r.autoSendCopies ? "on" : "off"}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-red-600">
                  {r.missingRequired.length ? r.missingRequired.map((m) => m.label).join(", ") : <span className="text-emerald-600">None</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <Link href={`/intakes/${r.id}`} className="btn-ghost px-2 py-1 text-xs">Open</Link>
                    <Link href={`/intakes/${r.id}/review`} className="btn-ghost px-2 py-1 text-xs">Edit</Link>
                    <Link href={`/intakes/${r.id}/pdf-preview`} className="btn-ghost px-2 py-1 text-xs">PDF</Link>
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => copyLink(r)}>Copy link</button>
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => remind(r)}>Remind</button>
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => sendCopies(r)}>Send copies</button>
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => copyCompletedLink(r)}>Copy copies link</button>
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setAutoCopies(r, !r.autoSendCopies)}>
                      {r.autoSendCopies ? "Auto off" : "Auto on"}
                    </button>
                    {r.status !== "COMPLETED" && (
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => markCompleted(r)}>Mark completed</button>
                    )}
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setArchived(r, tab !== "archived")}>
                      {tab === "archived" ? "Bring back" : "Archive"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-slate-400">
        HIPAA note: before using with real clients, make sure hosting and vendors have signed
        privacy agreements (BAAs) and a compliance review is done. Ask your administrator.
      </p>
    </main>
  );
}
