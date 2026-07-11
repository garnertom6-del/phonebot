"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import MissingFieldsPanel from "@/components/MissingFieldsPanel";
import { PROVIDER_CHOICE_PLAN_OPTIONS } from "@/lib/insurancePlans";
import { moodScores } from "@/lib/moodScores";
import {
  copiesMailtoHref,
  copiesShareMessage,
  copiesSmsHref,
  intakeMailtoHref,
  intakeShareMessage,
  intakeSmsHref,
} from "@/lib/shareLinks";

interface Detail {
  intake: {
    id: string; status: string; tokenExpiresAt: string; intakeDate?: string;
    docusignEnvelopeId?: string | null;
    provider?: { name: string; phone?: string | null } | null;
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

const HELPER_FORM_KEYS = [
  "record_number", "mid_number", "provider_choice_plan", "preferred_emergency_facility",
  "race", "ethnicity", "marital_status", "employment_status",
  "pcp_name", "pcp_phone", "pcp_address",
  "ec1_name", "ec1_cell_phone", "staff_receiving_intake",
  "height", "weight", "services_other", "transport_destination",
  "staff_helper_notes",
] as const;

export default function IntakeDetail({ params }: { params: { id: string } }) {
  const [d, setD] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [ccaBusy, setCcaBusy] = useState(false);
  const [ccaResult, setCcaResult] = useState("");
  const [ccaResultKind, setCcaResultKind] = useState<"success" | "error" | "info">("info");
  const [ccaOverwrite, setCcaOverwrite] = useState(false);
  const [copiesLink, setCopiesLink] = useState("");
  const [copiesBusy, setCopiesBusy] = useState(false);
  const [ncTracksBusy, setNcTracksBusy] = useState(false);
  const [ncTracksUploadBusy, setNcTracksUploadBusy] = useState(false);
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
  const providerName = i.provider?.name || "Moore Divine Care";
  const providerPhone = i.provider?.phone || "";
  const clientMessage = intakeShareMessage(d.clientLink, providerName);
  const copiesMessage = copiesLink ? copiesShareMessage(copiesLink, providerName) : "";
  const helperFormKey = HELPER_FORM_KEYS.map((key) => String(d.answers[key] ?? "")).join("\u001f");

  function deliveryStatus(body: Record<string, unknown>, fallback: string): string {
    const sent = Array.isArray(body.sent) ? body.sent : [];
    const failed = Array.isArray(body.failed) ? body.failed : [];
    if (sent.length) {
      return `Sent successfully: ${sent.join(", ")}${failed.length ? `. Not sent: ${failed.join("; ")}` : "."}`;
    }
    return failed.length ? `Not sent: ${failed.join("; ")}` : fallback;
  }

  function signatureRoleLabel(role: string): string {
    const labels: Record<string, string> = {
      client: "Client",
      guardian: "Parent / Guardian",
      staff: "QP / Qualified Professional",
      clinician: "Clinician",
      witness: "Witness",
      medicalDirector: "Medical Director",
    };
    return labels[role] || role;
  }

  function ncTracksSuccessText(body: { count?: number; details?: Array<{ label?: string }> }): string {
    const count = Number(body.count || 0);
    const labels = Array.isArray(body.details)
      ? body.details.map((item) => item?.label).filter((label): label is string => !!label)
      : [];
    if (!count) {
      return "NC Tracks screenshot uploaded, but no matching helper fields were found. Best results come from a clear screenshot that shows Recipient ID, PCP, and plan details.";
    }
    return `NC Tracks screenshot scanned. Filled ${count} field${count === 1 ? "" : "s"}${labels.length ? `: ${labels.join(", ")}.` : "."}`;
  }

  async function uploadCca(file: File) {
    setNote("");
    setCcaBusy(true); setCcaResult("Reading the CCA... this can take a minute or two.");
    setCcaResultKind("info");
    const fd = new FormData();
    fd.set("file", file);
    fd.set("overwrite", String(ccaOverwrite));
    const r = await fetch(`/api/intakes/${params.id}/cca`, { method: "POST", body: fd });
    const b = await r.json().catch(() => ({}));
    setCcaBusy(false);
    if (r.ok) {
      const filled = Number(b.filled || 0);
      const extracted = Number(b.extracted || 0);
      const skipped = Number(b.skipped || 0);
      setCcaResultKind("success");
      setCcaResult(`CCA successfully uploaded. It answered ${filled} intake question${filled === 1 ? "" : "s"} automatically` +
        (extracted && extracted !== filled ? ` (${extracted} found in the CCA` +
          (skipped ? `, ${skipped} kept from existing answers` : "") + ")" : "") +
        ". Review/edit, then Generate Completed Packet.");
      setNote(`CCA uploaded and ${filled} answer${filled === 1 ? "" : "s"} filled automatically.`);
      load();
    } else {
      setCcaResultKind("error");
      setCcaResult(b.error || "CCA import failed");
    }
  }

  async function act(label: string, fn: () => Promise<Response>) {
    setNote(`${label}...`);
    const r = await fn();
    const b = await r.json().catch(() => ({}));
    if (label === "Reminder") {
      setNote(r.ok ? deliveryStatus(b, "No phone or email saved for this client.") : deliveryStatus(b, `${label} failed: ${b.error || r.status}`));
    } else if (label === "Generate Completed Packet") {
      const parts = [
        r.ok ? `${label} complete${b.filled ? ` (${b.filled} fields filled)` : ""}` : `${label} failed: ${b.error || r.status}`,
        r.ok && b.docusign?.message ? String(b.docusign.message) : "",
      ].filter(Boolean);
      setNote(parts.join(" | "));
    } else {
      setNote(r.ok ? `${label} complete ${b.filled ? `(${b.filled} fields filled)` : ""}` : `${label} failed: ${b.error || r.status}`);
    }
    load();
  }

  async function sendCopiesLink() {
    setNote("Sending copies link...");
    setCopiesBusy(true);
    try {
      const r = await fetch(`/api/intakes/${i.id}/copies`, { method: "POST" });
      const b = await r.json().catch(() => ({}));
      if (r.ok) {
        setCopiesLink(b.link || "");
        setNote(deliveryStatus(b, "No email or phone is saved, so the completed intake and client records were not sent. A records link was created below."));
      } else {
        setCopiesLink(b.link || "");
        setNote(deliveryStatus(b, `Client records send failed: ${b.error || r.status}`));
      }
    } finally {
      setCopiesBusy(false);
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
    const b = await r.json().catch(() => ({}));
    setNote(r.ok
      ? `Helper info saved${b.applied ? ` (${b.applied} packet fields updated)` : ""}; smart defaults applied`
      : `Helper info failed to save: ${b.error || r.status}`);
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

  async function uploadNcTracks(file: File) {
    setNcTracksUploadBusy(true);
    setNcTracksResult("Reading the NC Tracks screenshot...");
    const fd = new FormData();
    fd.set("file", file);
    const r = await fetch(`/api/intakes/${i.id}/nctracks-upload`, { method: "POST", body: fd });
    const b = await r.json().catch(() => ({})) as { count?: number; details?: Array<{ label?: string }>; error?: string };
    setNcTracksUploadBusy(false);
    if (r.ok) {
      setNcTracksResult(ncTracksSuccessText(b));
      load();
    } else {
      setNcTracksResult(b.error || "NC Tracks upload failed.");
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <Link href="/dashboard" className="text-sm text-brand hover:underline">Dashboard</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{i.client.fullName}</h1>
          <p className="text-sm text-slate-500">
            DOB {i.client.dob} - MID# {i.client.midNumber || "-"} - Status{" "}
            <b>{({ NOT_STARTED: "Not started", IN_PROGRESS: "In progress", SUBMITTED: "Submitted",
              NEEDS_REVIEW: "Needs review", SIGNED: "Signed", COMPLETED: "Completed" } as Record<string, string>)[i.status] || i.status}</b>{" "}
            - {d.missingRequired.length === 0 ? "Required packet complete" : `${d.percentComplete}% of answers filled`}
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
          <button className="btn-ghost" disabled={copiesBusy} onClick={() => { void sendCopiesLink(); }}>
            {copiesBusy ? "Sending Client Records..." : "Send completed intake + client records"}
          </button>
          <button className="btn-ghost" onClick={() => act("DocuSign", () => fetch(`/api/intakes/${i.id}/docusign`, { method: "POST" }))}>
            Send to DocuSign
          </button>
          {i.docusignEnvelopeId && (
            <button className="btn-ghost" onClick={async () => {
              setNote("Checking DocuSign...");
              const r = await fetch(`/api/intakes/${i.id}/docusign/status`, { method: "POST" });
              const b = await r.json().catch(() => ({}));
              setNote(r.ok ? `DocuSign: ${b.message || b.status}` : b.error || "DocuSign check failed.");
              load();
            }}>
              Check DocuSign status
            </button>
          )}
        </div>
      </div>
      <WorkflowSteps d={d} />
      <MoodPanel answers={d.answers} />
      {note && <p className="mt-3 rounded-lg bg-brand-light p-2 text-sm font-semibold text-brand">{note}</p>}
      {copiesLink && (
        <div className="mt-3 rounded-lg border border-brand/30 bg-white p-3 text-sm">
          <p className="font-semibold text-brand">Completed intake + client records</p>
          <p className="mt-1 break-all font-mono text-xs">{copiesLink}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-ghost px-3 py-1.5 text-xs" onClick={async () => { await navigator.clipboard.writeText(copiesLink); setNote("Client records link copied"); }}>
              Copy records link
            </button>
            <button className="btn-ghost px-3 py-1.5 text-xs" onClick={async () => { await navigator.clipboard.writeText(copiesMessage); setNote("Client records text message copied"); }}>
              Copy text message
            </button>
            <a className="btn-primary px-3 py-1.5 text-xs" href={copiesSmsHref(i.client.phone, copiesLink, providerName)}>
              Open SMS on this computer
            </a>
            <a className="btn-ghost px-3 py-1.5 text-xs" href={copiesMailtoHref(i.client.email, copiesLink, providerName, providerPhone)}>
              Open email
            </a>
            <a className="btn-ghost px-3 py-1.5 text-xs" href={copiesLink} target="_blank">
              Open records page
            </a>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="card">
          <h3 className="mb-2 font-bold">Secure client link</h3>
          <div className="break-all rounded bg-slate-100 p-2 font-mono text-xs">{d.clientLink}</div>
          <p className="mt-1 text-xs text-slate-400">Expires {new Date(i.tokenExpiresAt).toLocaleString()}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-ghost px-3 py-1.5 text-sm" onClick={async () => { await navigator.clipboard.writeText(d.clientLink); setNote("Link copied"); }}>Copy</button>
            <a className="btn-primary px-3 py-1.5 text-sm" href={intakeSmsHref(i.client.phone, d.clientLink, providerName)}>
              Open SMS on this computer
            </a>
            <a className="btn-ghost px-3 py-1.5 text-sm" href={intakeMailtoHref(i.client.email, d.clientLink, providerName, providerPhone)}>
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
          {ccaResult && (
            <p className={`mt-3 rounded-lg p-3 text-sm font-semibold ${
              ccaResultKind === "success" ? "bg-emerald-50 text-emerald-700" :
              ccaResultKind === "error" ? "bg-red-50 text-red-700" : "bg-brand-light text-brand"
            }`}>
              {ccaResult}
            </p>
          )}
        </div>
        <div className="card md:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">NC Tracks / staff helper info</h3>
              <p className="mt-1 text-sm text-slate-500">
                Look up automatically when the NC Tracks connection is set up, or enter
                details manually. The app applies MID, PCP, emergency, staff names, dates,
                Medicaid defaults, insurance type, and repeated packet fields.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary px-3 py-1.5 text-sm" type="button" disabled={ncTracksBusy}
                onClick={() => { void lookupNcTracks(); }}>
                {ncTracksBusy ? "Looking up..." : "Auto lookup from MID/client info"}
              </button>
              <label className={`btn-secondary cursor-pointer px-3 py-1.5 text-sm ${ncTracksUploadBusy ? "pointer-events-none opacity-60" : ""}`}>
                {ncTracksUploadBusy ? "Reading upload..." : "Upload NC Tracks screenshot / card / PDF"}
                <input
                  type="file"
                  className="hidden"
                  accept="application/pdf,image/*"
                  disabled={ncTracksUploadBusy}
                  onChange={(e) => e.target.files?.[0] && uploadNcTracks(e.target.files[0])}
                />
              </label>
              <a className="btn-ghost px-3 py-1.5 text-sm" href="https://www.nctracks.nc.gov/" target="_blank">
                Open NC Tracks
              </a>
            </div>
          </div>
          {ncTracksResult && <p className="mt-3 rounded-lg bg-slate-50 p-2 text-sm font-semibold text-slate-700">{ncTracksResult}</p>}
          <form
            key={helperFormKey}
            className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3"
            onSubmit={(e) => { e.preventDefault(); void saveAssist(e.currentTarget); }}
          >
            <HelperInput name="record_number" label="Record #" value={d.answers.record_number ?? ""} />
            <HelperInput name="mid_number" label="MID# (Medicaid ID)" value={d.answers.mid_number ?? ""} />
            <HelperSelect
              name="provider_choice_plan"
              label="Type of insurance"
              value={d.answers.provider_choice_plan ?? d.answers.mco ?? ""}
              options={PROVIDER_CHOICE_PLAN_OPTIONS}
            />
            <HelperInput name="preferred_emergency_facility" label="Local hospital / ER" value={d.answers.preferred_emergency_facility ?? ""} />
            <HelperInput name="race" label="Race" value={d.answers.race ?? ""} />
            <HelperInput name="ethnicity" label="Ethnicity" value={d.answers.ethnicity ?? ""} />
            <HelperInput name="marital_status" label="Marital status" value={d.answers.marital_status ?? ""} />
            <HelperInput name="employment_status" label="Employment status" value={d.answers.employment_status ?? ""} />
            <HelperInput name="pcp_name" label="Primary care doctor" value={d.answers.pcp_name ?? ""} />
            <HelperInput name="pcp_phone" label="PCP phone" value={d.answers.pcp_phone ?? ""} />
            <HelperInput name="pcp_address" label="PCP address / practice" value={d.answers.pcp_address ?? ""} />
            <HelperInput name="ec1_name" label="Emergency contact" value={d.answers.ec1_name ?? ""} />
            <HelperInput name="ec1_cell_phone" label="Emergency phone" value={d.answers.ec1_cell_phone ?? ""} />
            <HelperInput name="staff_receiving_intake" label="Staff / QP / clinician name" value={d.answers.staff_receiving_intake ?? d.answers.clinician_name ?? ""} />
            <HelperInput name="height" label="Height" value={d.answers.height ?? ""} />
            <HelperInput name="weight" label="Weight" value={d.answers.weight ?? ""} />
            <HelperInput name="services_other" label="Other service note" value={d.answers.services_other ?? ""} />
            <HelperInput name="transport_destination" label="Transport line" value={d.answers.transport_destination ?? ""} />
            <label className="md:col-span-3">
              <span className="label">Paste quick notes</span>
              <textarea name="helperNotes" className="input min-h-[110px]"
                defaultValue={String(d.answers.staff_helper_notes ?? "")}
                placeholder={"Examples:\nInsurance type: Alliance\nRace: Black or African American\nEthnicity: Non-Hispanic/Black\nMarital status: Single\nEmployment status: Unemployed\nPCP: Guilford County Pediatrics\nPCP phone: 336-555-0100\nHeight: 5'8\"\nWeight: 160\nEmergency contact: Jane Smith\nEmergency phone: 336-555-0101\nTransport: Services / treatment plan activities"} />
            </label>
            <div className="md:col-span-3 flex flex-wrap gap-2">
              <button className="btn-primary" type="submit">Save helper info</button>
              <span className="self-center text-xs text-slate-500">
                Auto lookup works once the NC Tracks connection is set up. Typing the details in by hand always works.
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
              <li key={s.role}><b>{signatureRoleLabel(s.role)}</b> - {s.printedName} ({s.signedDate})</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400">Staff/clinician signatures are added on the review screen.</p>
        </div>
        <div className="card">
          <h3 className="mb-2 font-bold">Uploaded documents</h3>
          {i.uploadedDocuments.length === 0 && <p className="text-sm text-slate-400">None uploaded.</p>}
          <ul className="space-y-1 text-sm">{i.uploadedDocuments.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2">
              <span>{u.docType.replace(/_/g, " ")}: {u.fileName}</span>
              <a className="btn-ghost px-2 py-0.5 text-xs" href={`/api/intakes/${i.id}/documents/${u.id}`}>Open</a>
            </li>
          ))}</ul>
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

function HelperSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value: unknown;
  options: string[];
}) {
  return (
    <label>
      <span className="label">{label}</span>
      <select className="input" name={name} defaultValue={String(value ?? "")}>
        <option value="">Select insurance type</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

/** Numbered guide showing where this intake is in the workflow and what to do next. */
function WorkflowSteps({ d }: { d: Detail }) {
  const i = d.intake;
  const hasCca = i.uploadedDocuments.some((u) => u.docType === "CCA");
  const reviewed = i.auditLogs.some((a) => a.event === "staff_reviewed");
  const signed = i.signatures.some((s) => s.role === "client" || s.role === "guardian");
  const docusignSent = !!i.docusignEnvelopeId || i.auditLogs.some((a) => a.event === "docusign_sent" || a.event === "docusign_completed");
  const copiesSent = i.auditLogs.some((a) => a.event === "copies_link_sent");
  const steps = [
    { label: "Send link", done: i.status !== "NOT_STARTED" },
    { label: "Client answers", done: ["SUBMITTED", "NEEDS_REVIEW", "SIGNED", "COMPLETED"].includes(i.status) },
    { label: "Add CCA", done: hasCca },
    { label: "Review answers", done: reviewed },
    { label: "Generate packet", done: i.generatedPdfs.length > 0 },
    { label: "Signatures", done: signed },
    { label: "DocuSign", done: docusignSent || i.status === "COMPLETED" },
    { label: "Send records", done: copiesSent },
  ];
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-2 text-xs">
      {steps.map((s, idx) => (
        <span key={s.label}
          className={`flex items-center gap-1 rounded-full px-2 py-1 font-semibold ${
            s.done ? "bg-emerald-100 text-emerald-700"
            : idx === current ? "bg-brand text-white"
            : "bg-slate-100 text-slate-400"}`}>
          <span>{s.done ? "✓" : idx + 1}</span> {s.label}
          {idx === current && <span className="font-normal">← next</span>}
        </span>
      ))}
    </div>
  );
}

/** PHQ-9 / GAD-7 auto-scores (full-intake clients). Informational, not a diagnosis. */
function MoodPanel({ answers }: { answers: Record<string, unknown> }) {
  const s = moodScores(answers);
  if (!s.phq9 && !s.gad7) return null;
  const chip = (label: string, m: { score: number; total: number; answered: number; severity: string; flag: boolean }, max: number) => (
    <span className={`badge ${m.flag ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
      {label}: {m.score}/{max} - {m.severity}{m.answered < m.total ? ` (${m.answered}/${m.total} answered)` : ""}
    </span>
  );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs">
      <span className="font-bold text-slate-500">Mood check:</span>
      {s.phq9 && chip("PHQ-9 depression screen", s.phq9, 27)}
      {s.gad7 && chip("GAD-7 anxiety screen", s.gad7, 21)}
      {s.selfHarmEndorsed && (
        <span className="badge bg-red-100 text-red-800">
          ⚠ Self-harm question answered above &quot;Not at all&quot; - clinician should follow up promptly
        </span>
      )}
      <span className="text-slate-400">Screening scores only - not a diagnosis.</span>
    </div>
  );
}
