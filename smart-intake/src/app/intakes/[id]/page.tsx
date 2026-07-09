"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import MissingFieldsPanel from "@/components/MissingFieldsPanel";
import { intakeMailtoHref, intakeShareMessage, intakeSmsHref } from "@/lib/shareLinks";

interface Detail {
  intake: {
    id: string; status: string; tokenExpiresAt: string; intakeDate?: string;
    client: { fullName: string; dob: string; midNumber?: string; email?: string; phone?: string; guardianName?: string };
    signatures: { role: string; printedName: string; signedDate: string }[];
    uploadedDocuments: { id: string; docType: string; fileName: string }[];
    generatedPdfs: { id: string; createdAt: string }[];
    auditLogs: { id: string; event: string; detail?: string; createdAt: string }[];
  };
  answers: Record<string, unknown>;
  clientLink: string; percentComplete: number;
  missingRequired: { key: string; label: string }[];
  missingOptional: { key: string; label: string; section?: string }[];
}

export default function IntakeDetail({ params }: { params: { id: string } }) {
  const [d, setD] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [ccaBusy, setCcaBusy] = useState(false);
  const [ccaResult, setCcaResult] = useState("");
  const [ccaOverwrite, setCcaOverwrite] = useState(false);
  const [copiesLink, setCopiesLink] = useState("");
  const [ncTracksBusy, setNcTracksBusy] = useState(false);
  const [ncTracksResult, setNcTracksResult] = useState("");

  const load = useCallback(() => {
    fetch(`/api/intakes/${params.id}`).then(async (r) => {
      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (r.ok) setD(await r.json());
      else setNote("Could not load this intake. Please refresh or sign in again.");
    });
  }, [params.id]);
  useEffect(load, [load]);

  if (!d) return <main className="p-10 text-center text-slate-400">Loading...</main>;
  const i = d.intake;
  const clientMessage = intakeShareMessage(d.clientLink);

  async function uploadCca(file: File) {
    setCcaBusy(true); setCcaResult("Reading the CCA... this can take a minute or two.");
    const fd = new FormData();
    fd.set("file", file);
    fd.set("overwrite", String(ccaOverwrite));
    const r = await fetch(`/api/intakes/${params.id}/cca`, { method: "POST", body: fd });
    const b = await r.json().catch(() => ({}));
    setCcaBusy(false);
    if (r.ok) {
      setCcaResult(`Filled ${b.filled} answers from the CCA` +
        (b.skipped ? ` (kept ${b.skipped} existing answers - check "replace" to overwrite)` : "") +
        ". Review them, then Generate Completed Packet.");
      load();
    } else {
      setCcaResult(b.error || "CCA import failed");
    }
  }

  async function act(label: string, fn: () => Promise<Response>) {
    setNote(`${label}...`);
    const r = await fn();
    const b = await r.json().catch(() => ({}));
    setNote(r.ok ? `${label} complete ${b.filled ? `(${b.filled} fields filled)` : ""}` : `${label} failed: ${b.error || r.status}`);
    load();
  }

  async function sendCopiesLink() {
    setNote("Sending copies link...");
    const r = await fetch(`/api/intakes/${i.id}/copies`, { method: "POST" });
    const b = await r.json().catch(() => ({}));
    if (r.ok) {
      setCopiesLink(b.link || "");
      setNote(b.sent?.length ? `Copies link sent: ${b.sent.join(", ")}` : "Copies link created. Copy it below.");
    } else {
      setNote(`Copies link failed: ${b.error || r.status}`);
    }
    load();
  }

  async function saveAssist(form: HTMLFormElement) {
    setNote("Saving NC Tracks / helper info...");
    const fd = new FormData(form);
    const fields = Object.fromEntries(
      Array.from(fd.entries())
        .filter(([key]) => key !== "helperNotes")
        .map(([key, value]) => [key, String(value)]),
    );
    const r = await fetch(`/api/intakes/${i.id}/assist`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields, helperNotes: String(fd.get("helperNotes") || "") }),
    });
    setNote(r.ok ? "NC Tracks / helper info saved and smart defaults applied" : "Helper info failed to save");
    load();
  }

  async function lookupNcTracks() {
    setNcTracksBusy(true);
    setNcTracksResult("Looking up NC Tracks...");
    const r = await fetch(`/api/intakes/${i.id}/nctracks`, { method: "POST" });
    const b = await r.json().catch(() => ({}));
    setNcTracksBusy(false);
    if (r.ok) {
      setNcTracksResult(b.count ? `NC Tracks lookup filled ${b.count} field(s).` : "NC Tracks lookup finished, but no matching fields were returned.");
      load();
    } else {
      setNcTracksResult(b.error || "NC Tracks lookup failed.");
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Link href="/dashboard" className="text-sm text-brand hover:underline">Dashboard</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{i.client.fullName}</h1>
          <p className="text-sm text-slate-500">
            DOB {i.client.dob} - MID# {i.client.midNumber || "-"} - Status <b>{i.status}</b> - {d.percentComplete}% complete
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/intakes/${i.id}/review`} className="btn-primary">Review / edit answers</Link>
          <Link href={`/intakes/${i.id}/plans`} className="btn-secondary">PCP / Crisis Plan</Link>
          <Link href={`/intakes/${i.id}/pdf-preview`} className="btn-secondary">Preview PDF</Link>
          <button className="btn-secondary" onClick={() => act("Generate Completed Packet", () => fetch(`/api/intakes/${i.id}/generate`, { method: "POST" }))}>
            Generate Completed Packet
          </button>
          <a className="btn-ghost" href={`/api/intakes/${i.id}/pdf`} target="_blank">Download PDF</a>
          <button className="btn-ghost" onClick={() => { void sendCopiesLink(); }}>
            Send Copies Link
          </button>
          <button className="btn-ghost" onClick={() => act("DocuSign", () => fetch(`/api/intakes/${i.id}/docusign`, { method: "POST" }))}>
            Send to DocuSign
          </button>
        </div>
      </div>
      {note && <p className="mt-3 rounded-lg bg-brand-light p-2 text-sm font-semibold text-brand">{note}</p>}
      {copiesLink && (
        <div className="mt-3 rounded-lg border border-brand/30 bg-white p-3 text-sm">
          <p className="font-semibold text-brand">Copies link</p>
          <p className="mt-1 break-all font-mono text-xs">{copiesLink}</p>
          <button className="btn-ghost mt-2 px-3 py-1.5 text-xs" onClick={async () => { await navigator.clipboard.writeText(copiesLink); setNote("Copies link copied"); }}>
            Copy copies link
          </button>
        </div>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="card">
          <h3 className="mb-2 font-bold">Secure client link</h3>
          <div className="break-all rounded bg-slate-100 p-2 font-mono text-xs">{d.clientLink}</div>
          <p className="mt-1 text-xs text-slate-400">Expires {new Date(i.tokenExpiresAt).toLocaleString()}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={async () => { await navigator.clipboard.writeText(d.clientLink); setNote("Link copied"); }}>Copy</button>
            <a className="btn-primary px-3 py-1.5 text-sm" href={intakeSmsHref(i.client.phone, d.clientLink)}>
              Open SMS on this computer
            </a>
            <a className="btn-ghost px-3 py-1.5 text-sm" href={intakeMailtoHref(i.client.email, d.clientLink)}>
              Open email
            </a>
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={async () => { await navigator.clipboard.writeText(clientMessage); setNote("Text message copied"); }}>Copy text message</button>
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => act("Reminder", () => fetch(`/api/intakes/${i.id}/remind`, { method: "POST" }))}>Send reminder</button>
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => act("Extend link", () => fetch(`/api/intakes/${i.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ extendToken: true }) }))}>Extend</button>
          </div>
        </div>
        <div className="card border-brand/40 bg-brand-light/40">
          <h3 className="mb-1 font-bold">Add CCA - auto-fill from the clinician&apos;s assessment</h3>
          <p className="mb-3 text-sm text-slate-600">
            Upload the completed Comprehensive Clinical Assessment (PDF or photo, e.g. from your
            Downloads folder) and the system reads it and fills the matching intake answers -
            same day or days later, and you can re-upload an updated CCA any time.
          </p>
          <label className={`btn-primary cursor-pointer ${ccaBusy ? "pointer-events-none opacity-60" : ""}`}>
            {ccaBusy ? "Reading CCA..." : "Choose CCA file & fill packet"}
            <input type="file" className="hidden" accept="application/pdf,image/*" disabled={ccaBusy}
              onChange={(e) => e.target.files?.[0] && uploadCca(e.target.files[0])} />
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={ccaOverwrite} onChange={(e) => setCcaOverwrite(e.target.checked)} />
            Replace answers that already exist (otherwise existing answers are kept)
          </label>
          {ccaResult && <p className="mt-2 text-sm font-semibold text-brand">{ccaResult}</p>}
        </div>
        <div className="card md:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">NC Tracks / staff helper info</h3>
              <p className="mt-1 text-sm text-slate-500">
                Look up automatically when your approved lookup adapter is connected, or enter
                details manually. The app applies MID, PCP, emergency, staff names, dates,
                Medicaid defaults, and repeated packet fields.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary px-3 py-1.5 text-sm" type="button" disabled={ncTracksBusy}
                onClick={() => { void lookupNcTracks(); }}>
                {ncTracksBusy ? "Looking up..." : "Auto lookup NC Tracks"}
              </button>
              <a className="btn-ghost px-3 py-1.5 text-sm" href="https://www.nctracks.nc.gov/" target="_blank">
                Open NC Tracks
              </a>
            </div>
          </div>
          {ncTracksResult && <p className="mt-3 rounded-lg bg-slate-50 p-2 text-sm font-semibold text-slate-700">{ncTracksResult}</p>}
          <form className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3" onSubmit={(e) => { e.preventDefault(); void saveAssist(e.currentTarget); }}>
            <HelperInput name="record_number" label="Record #" value={d.answers.record_number ?? ""} />
            <HelperInput name="mid_number" label="MID #" value={d.answers.mid_number ?? ""} />
            <HelperInput name="preferred_emergency_facility" label="Local hospital / ER" value={d.answers.preferred_emergency_facility ?? ""} />
            <HelperInput name="pcp_name" label="Primary care doctor" value={d.answers.pcp_name ?? ""} />
            <HelperInput name="pcp_phone" label="PCP phone" value={d.answers.pcp_phone ?? ""} />
            <HelperInput name="pcp_address" label="PCP address / practice" value={d.answers.pcp_address ?? ""} />
            <HelperInput name="ec1_name" label="Emergency contact" value={d.answers.ec1_name ?? ""} />
            <HelperInput name="ec1_cell_phone" label="Emergency phone" value={d.answers.ec1_cell_phone ?? ""} />
            <HelperInput name="staff_receiving_intake" label="Staff / QP / clinician name" value={d.answers.staff_receiving_intake ?? d.answers.clinician_name ?? ""} />
            <HelperInput name="height" label="Height" value={d.answers.height ?? ""} />
            <HelperInput name="weight" label="Weight" value={d.answers.weight ?? ""} />
            <HelperInput name="services_other" label="Other service note" value={d.answers.services_other ?? ""} />
            <label className="md:col-span-3">
              <span className="label">Paste quick notes</span>
              <textarea name="helperNotes" className="input min-h-[110px]"
                defaultValue={String(d.answers.staff_helper_notes ?? "")}
                placeholder={"Examples:\nPCP: Guilford County Pediatrics\nPCP phone: 336-555-0100\nHeight: 5'8\"\nWeight: 160\nEmergency contact: Jane Smith\nEmergency phone: 336-555-0101"} />
            </label>
            <div className="md:col-span-3 flex flex-wrap gap-2">
              <button className="btn-primary" type="submit">Save helper info</button>
              <span className="self-center text-xs text-slate-500">
                Auto lookup uses your approved NC Tracks adapter settings. Manual entry always remains available.
              </span>
            </div>
          </form>
        </div>
        <MissingFieldsPanel required={d.missingRequired} optional={d.missingOptional} />
        <div className="card">
          <h3 className="mb-2 font-bold">Signatures</h3>
          {i.signatures.length === 0 && <p className="text-sm text-slate-400">None captured yet.</p>}
          <ul className="text-sm">
            {i.signatures.map((s) => (
              <li key={s.role}><b>{s.role}</b> - {s.printedName} ({s.signedDate})</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">Staff/clinician signatures are added on the review screen.</p>
        </div>
        <div className="card">
          <h3 className="mb-2 font-bold">Uploaded documents</h3>
          {i.uploadedDocuments.length === 0 && <p className="text-sm text-slate-400">None uploaded.</p>}
          <ul className="text-sm">{i.uploadedDocuments.map((u) => <li key={u.id}>{u.docType}: {u.fileName}</li>)}</ul>
        </div>
        <div className="card md:col-span-2">
          <h3 className="mb-2 font-bold">Audit log</h3>
          <ul className="max-h-56 space-y-1 overflow-y-auto text-xs text-slate-600">
            {i.auditLogs.map((a) => (
              <li key={a.id}><span className="text-slate-400">{new Date(a.createdAt).toLocaleString()}</span> - <b>{a.event}</b> {a.detail}</li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}

function HelperInput({ name, label, value }: { name: string; label: string; value: unknown }) {
  return (
    <label>
      <span className="label">{label}</span>
      <input className="input" name={name} defaultValue={String(value ?? "")} />
    </label>
  );
}
