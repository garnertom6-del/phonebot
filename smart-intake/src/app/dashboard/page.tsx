"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface Row {
  id: string; status: string; percentComplete: number; hasPdf: boolean;
  hasCca: boolean; ccaDetail?: string;
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

export default function Dashboard() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    fetch("/api/intakes").then(async (r) => {
      if (r.status === 401) return router.push("/login");
      setRows((await r.json()).intakes);
    });
  }, [router]);
  useEffect(load, [load]);

  async function copyLink(row: Row) {
    const link = `${window.location.origin}/intake/${row.token}`;
    await navigator.clipboard.writeText(link);
    setNote(`Link copied for ${row.client.fullName}`);
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
  async function archive(row: Row) {
    await fetch(`/api/intakes/${row.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archive: true }) });
    load();
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand">Moore Divine Care - Intake Dashboard</h1>
          <p className="text-sm text-slate-500">Client Intake Package automation</p>
        </div>
        <div className="flex gap-2">
          <a href="/api/admin/backup" className="btn-ghost" title="Download a full copy of all client data - keep it somewhere safe">Download backup</a>
          <Link href="/admin/pdf-mapping" className="btn-ghost">PDF mapping</Link>
          <Link href="/intakes/new" className="btn-primary">+ Create New Intake</Link>
          <button className="btn-secondary" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); }}>Sign out</button>
        </div>
      </div>
      {note && <p className="mb-3 rounded-lg bg-emerald-50 p-2 text-sm font-semibold text-emerald-700">{note}</p>}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {["Client", "DOB", "MID#", "Contact", "Guardian", "Status", "CCA / Packet", "Missing required", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={9} className="p-6 text-center text-slate-400">Loading...</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={9} className="p-6 text-center text-slate-400">No intakes yet - create one!</td></tr>}
            {rows?.map((r) => (
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
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => archive(r)}>Mark completed</button>
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
