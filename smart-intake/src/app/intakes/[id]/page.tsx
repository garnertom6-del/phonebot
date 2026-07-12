"use client";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import MissingFieldsPanel from "@/components/MissingFieldsPanel";
import { canGenerateRecordNumber, makeRecordNumber, PROVIDER_CHOICE_PLAN_OPTIONS, RECORD_NUMBER_LOOKUP_LINKS, recordNumberPrefix } from "@/lib/insurancePlans";
import { moodScores } from "@/lib/moodScores";
import { REFERRAL_SOURCE_OPTIONS } from "@/config/mooreDivineQuestions";
import {
  copiesMailtoHref,
  copiesShareMessage,
  copiesSmsHref,
  intakeMailtoHref,
  intakeShareMessage,
  intakeSmsHref,
} from "@/lib/shareLinks";

type PreflightFinding = {
  key: string;
  severity: "error" | "warning" | "info";
  title: string;
  detail: string;
  fieldKeys?: string[];
  fieldLabels?: string[];
  source: "rules" | "ai";
  overridden?: boolean;
  pendingRecheck?: boolean;
};

type PreflightResult = {
  aiUsed: boolean;
  aiConfigured: boolean;
  message: string;
  findings: PreflightFinding[];
  generatedAt: string;
};

type IdentityMismatch = {
  recordName: string;
  answerName: string;
};

type SignatureAudit = {
  captured: number;
  missing: number;
  requiredMissing: number;
  missingLabels: string[];
  mappedSignatureSlots: number;
  skippedSignatureSlots: number;
  skippedSignatureFields: string[];
};

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
  signatureStatuses: {
    key: string; label: string; state: "captured" | "missing"; required: boolean;
    signedDate?: string; reason: string;
  }[];
}

const HELPER_FORM_KEYS = [
  "record_number", "mid_number", "gender", "race", "ethnicity", "marital_status", "veteran",
  "education", "language", "language_other", "communication_level", "employment_status",
  "client_phone_cell", "client_phone_home", "client_phone_work", "client_email",
  "address_street", "address_city", "address_state", "living_arrangement", "lives_with_whom", "lives_where",
  "provider_choice_plan", "has_medicaid", "medicaid_effective_date", "has_medicare", "medicare_effective_date",
  "has_nchc", "nchc_policy", "nchc_effective_date", "funding_other", "income_sources", "income_other",
  "referral_source", "referral_source_other", "social_agency_name", "referred_for", "services_requested", "services_other", "presenting_problem",
  "pcp_name", "pcp_phone", "pcp_address", "preferred_emergency_facility", "no_pcp_nearest_er",
  "has_current_diagnosis", "diagnosis_list", "current_diagnosis_known", "has_current_therapist", "therapist_name", "therapist_agency_phone", "receiving_mh_services", "mh_services_desc", "mh_service_provider", "mh_history",
  "medical_diagnoses", "treatments", "hospitalizations", "last_physical_date", "height", "weight", "hair_color", "eye_color", "identifying_marks", "special_diets", "medical_alerts", "fax",
  "medications", "otc_medications", "drug_allergies", "environmental_allergies", "allergies",
  "strengths", "needs", "abilities", "preferences",
  "pending_court_cases", "court_case_desc", "is_minor_or_incompetent", "date_adjudicated", "guardian_name", "guardian_address", "guardian_phone", "guardian_email",
  "ec1_name", "ec1_cell_phone", "ec1_home_phone", "ec1_work_phone", "ec1_street", "ec1_city", "ec1_state",
  "staff_receiving_intake", "transport_destination", "transport_purposes",
  "staff_helper_notes",
] as const;

const RACE_OPTIONS = [
  "American Indian or Alaska Native", "Asian", "Black or African American",
  "Caucasian or White", "Multiracial", "Native American", "Native Hawaiian or Pacific Islander",
];
const ETHNICITY_OPTIONS = ["Hispanic/White", "Non-Hispanic/White", "Latino", "Hispanic/Black", "Non-Hispanic/Black"];
const MARITAL_STATUS_OPTIONS = ["Single", "Married", "Separated", "Widowed"];
const VETERAN_OPTIONS = ["Yes", "No"];
const EMPLOYMENT_OPTIONS = ["Not in Labor Force", "Unemployed", "Disabled", "Employed"];
const GENDER_OPTIONS = ["Female", "Male", "Transgender", "Other"];
const EDUCATION_OPTIONS = ["Grade/Elementary", "High School/GED", "College", "Graduate", "Post Graduate"];
const LANGUAGE_OPTIONS = ["English", "Spanish", "French", "German", "Other"];
const COMMUNICATION_OPTIONS = ["Excellent", "Good", "Fair", "Poor"];
const LIVING_ARRANGEMENT_OPTIONS = [
  "Adult with Spouse", "Adult with Relative", "Adult Alone", "Homeless", "Residential",
  "Living in hospital/institution", "Child with Parent", "Child with other relative", "Child with Non-relative",
];
const YES_NO_OPTIONS = ["Yes", "No"];
const REFERRAL_OPTIONS = REFERRAL_SOURCE_OPTIONS;

export default function IntakeDetail({ params }: { params: { id: string } }) {
  const [d, setD] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [saveAssistBusy, setSaveAssistBusy] = useState(false);
  const [saveAssistMessage, setSaveAssistMessage] = useState("");
  const [saveAssistKind, setSaveAssistKind] = useState<"success" | "error" | "info">("info");
  const [ccaBusy, setCcaBusy] = useState(false);
  const [ccaRescrubBusy, setCcaRescrubBusy] = useState(false);
  const [ccaResult, setCcaResult] = useState("");
  const [ccaResultKind, setCcaResultKind] = useState<"success" | "error" | "info">("info");
  const [ccaOverwrite, setCcaOverwrite] = useState(false);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [overrideBusyKey, setOverrideBusyKey] = useState("");
  const [quickFixChoice, setQuickFixChoice] = useState<Record<string, string>>({});
  const [quickFixBusyKey, setQuickFixBusyKey] = useState("");
  const [identityMismatch, setIdentityMismatch] = useState<IdentityMismatch | null>(null);
  const [lastSignatureAudit, setLastSignatureAudit] = useState<SignatureAudit | null>(null);
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

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(`smart-intake:preflight:${params.id}`);
      if (!stored) return;
      const restored = JSON.parse(stored) as PreflightResult;
      if (Array.isArray(restored.findings)) setPreflight(restored);
    } catch {
      sessionStorage.removeItem(`smart-intake:preflight:${params.id}`);
    }
  }, [params.id]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const saved = query.get("saved");
    if (saved !== "staff") return;
    const returningToPreflight = query.get("return") === "preflight";
    setNote(returningToPreflight
      ? "Saved. Your preflight checklist is still open; correct the next item and rerun the review when you are ready."
      : "Staff signature and changes saved successfully. Next step: review the intake/preflight findings, then generate the packet.");
    window.history.replaceState({}, "", window.location.pathname);
    if (returningToPreflight) {
      window.setTimeout(() => document.getElementById("preflight-review")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  }, [params.id]);

  if (!d) return <main className="p-10 text-center text-slate-400">Loading...</main>;
  const i = d.intake;
  const providerName = i.provider?.name || "Moore Divine Care";
  const providerPhone = i.provider?.phone || "";
  const clientMessage = intakeShareMessage(d.clientLink, providerName);
  const copiesMessage = copiesLink ? copiesShareMessage(copiesLink, providerName) : "";
  const helperFormKey = HELPER_FORM_KEYS.map((key) => String(d.answers[key] ?? "")).join("\u001f");
  const hasCca = i.uploadedDocuments.some((document) => document.docType === "CCA");
  const preflightBlockingCount = preflight?.findings.filter((finding) => finding.severity !== "info" && !finding.overridden).length ?? 0;
  const preflightOverrideCount = preflight?.findings.filter((finding) => finding.overridden).length ?? 0;
  const preflightPendingCount = preflight?.findings.filter((finding) => finding.pendingRecheck && !finding.overridden).length ?? 0;

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
    if (label === "Generate Completed Packet") setIdentityMismatch(null);
    if (label === "Generate Completed Packet") setLastSignatureAudit(null);
    const r = await fn();
    const b = await r.json().catch(() => ({}));
    if (label === "Reminder") {
      setNote(r.ok ? deliveryStatus(b, "No phone or email saved for this client.") : deliveryStatus(b, `${label} failed: ${b.error || r.status}`));
    } else if (label === "Generate Completed Packet") {
      if (!r.ok && b.code === "IDENTITY_MISMATCH") {
        setIdentityMismatch({ recordName: String(b.recordName || "client record"), answerName: String(b.answerName || "intake answer") });
        setNote("Packet generation paused. Confirm the client name or review and correct it before generating.");
        return;
      }
      const parts = [
        r.ok ? `${label} complete${b.filled ? ` (${b.filled} fields filled)` : ""}` : `${label} failed: ${b.error || r.status}`,
        r.ok && b.docusign?.message ? String(b.docusign.message) : "",
      ].filter(Boolean);
      if (r.ok && b.signatureAudit) {
        const audit = b.signatureAudit as SignatureAudit;
        setLastSignatureAudit(audit);
        parts.push(`Signatures: ${audit.captured} captured, ${audit.missing} role${audit.missing === 1 ? "" : "s"} missing, ${audit.skippedSignatureSlots} PDF slot${audit.skippedSignatureSlots === 1 ? "" : "s"} blank`);
      }
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
    setSaveAssistBusy(true);
    setSaveAssistKind("info");
    setSaveAssistMessage("Saving answers and notes to the intake form...");
    setNote("Saving NC Tracks / helper info...");
    const fd = new FormData(form);
    const fields = Object.fromEntries(
      Array.from(fd.entries())
        .filter(([key]) => key !== "helperNotes")
        .map(([key, value]) => [key, String(value)]),
    );
    try {
      const r = await fetch(`/api/intakes/${i.id}/assist`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, helperNotes: String(fd.get("helperNotes") || "") }),
      });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) {
        const message = `Helper info failed to save: ${b.error || r.status}`;
        setSaveAssistKind("error");
        setSaveAssistMessage(message);
        setNote(message);
      } else {
        const clientPrefilled = Array.isArray(b.clientPrefilled) ? b.clientPrefilled.length : 0;
        const clientPrefilledLabels = Array.isArray(b.clientPrefilledLabels)
          ? b.clientPrefilledLabels.filter((label: unknown): label is string => typeof label === "string")
          : [];
        const labelSummary = clientPrefilledLabels.length
          ? ` (${clientPrefilledLabels.slice(0, 5).join(", ")}${clientPrefilledLabels.length > 5 ? ", ..." : ""})`
          : "";
        const packetFields = Number(b.applied || 0);
        const message = clientPrefilled
          ? `Saved successfully: ${packetFields || clientPrefilled} intake field${(packetFields || clientPrefilled) === 1 ? "" : "s"} updated. The client can skip ${clientPrefilled} SMS question${clientPrefilled === 1 ? "" : "s"}${labelSummary}.`
          : packetFields
            ? `Saved successfully: ${packetFields} intake packet field${packetFields === 1 ? "" : "s"} updated. No client SMS questions were prefilled.`
            : "Saved successfully: your note was recorded in the intake form.";
        setSaveAssistKind("success");
        setSaveAssistMessage(message);
        setNote(message);
      }
      load();
    } catch {
      const message = "Helper info failed to save. Check your connection and try again.";
      setSaveAssistKind("error");
      setSaveAssistMessage(message);
      setNote(message);
    } finally {
      setSaveAssistBusy(false);
    }
  }

  async function rescrubCca() {
    setCcaRescrubBusy(true);
    setCcaResultKind("info");
    setCcaResult("Re-reading the saved CCA with AI...");
    try {
      const form = new FormData();
      form.set("overwrite", String(ccaOverwrite));
      const r = await fetch(`/api/intakes/${params.id}/cca/rescrub`, { method: "POST", body: form });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setCcaResultKind("error");
        setCcaResult(body.error || "CCA re-scan failed.");
        return;
      }
      setCcaResultKind("success");
      setCcaResult(`CCA re-scan complete. AI found ${Number(body.extracted || 0)} field${Number(body.extracted || 0) === 1 ? "" : "s"} and updated ${Number(body.filled || 0)} answer${Number(body.filled || 0) === 1 ? "" : "s"}. Review the changes before generating the packet.`);
      load();
    } catch {
      setCcaResultKind("error");
      setCcaResult("CCA re-scan could not connect. Please try again.");
    } finally {
      setCcaRescrubBusy(false);
    }
  }

  async function runPreflight() {
    setPreflightBusy(true);
    setPreflight(null);
    setNote("Running intake preflight review...");
    try {
      const r = await fetch(`/api/intakes/${params.id}/preflight`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNote(body.error || "Preflight review failed.");
        return;
      }
      const result = body as PreflightResult;
      setPreflight(result);
      sessionStorage.setItem(`smart-intake:preflight:${params.id}`, JSON.stringify(result));
      setNote(body.aiUsed ? "AI and automatic preflight review complete." : "Automatic preflight review complete.");
      load();
    } catch {
      setNote("Connection problem. Preflight review could not be completed.");
    } finally {
      setPreflightBusy(false);
    }
  }

  async function overridePreflight(finding: PreflightFinding) {
    const reason = window.prompt(`Why are you overriding "${finding.title}"? This reason will be recorded in the audit log.`);
    if (!reason?.trim()) return;
    setOverrideBusyKey(finding.key);
    try {
      const r = await fetch(`/api/intakes/${params.id}/preflight/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingKey: finding.key, title: finding.title, reason: reason.trim() }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNote(body.error || "The override could not be recorded.");
        return;
      }
      const next = preflight ? {
        ...preflight,
        findings: preflight.findings.map((item) => item.key === finding.key ? { ...item, overridden: true } : item),
      } : null;
      setPreflight(next);
      if (next) sessionStorage.setItem(`smart-intake:preflight:${params.id}`, JSON.stringify(next));
      setNote("Override recorded in the audit log. You may continue the workflow.");
    } catch {
      setNote("The override could not be recorded. Check the connection and try again.");
    } finally {
      setOverrideBusyKey("");
    }
  }

  async function applyQuickFix(finding: PreflightFinding) {
    if (quickFixChoice[finding.key] !== "record") {
      setNote("Choose “Use the intake record value” before applying this quick fix.");
      return;
    }
    const answerKey = finding.key === "identity_name" ? "client_full_name" : "dob";
    const answerValue = finding.key === "identity_name" ? i.client.fullName : i.client.dob;
    setQuickFixBusyKey(finding.key);
    try {
      const r = await fetch(`/api/intakes/${i.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: { ...(d?.answers || {}), [answerKey]: answerValue }, status: "NEEDS_REVIEW" }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNote(body.error || "The correction could not be saved.");
        return;
      }
      const next = preflight ? {
        ...preflight,
        findings: preflight.findings.map((item) => item.key === finding.key ? { ...item, pendingRecheck: true } : item),
      } : null;
      setPreflight(next);
      if (next) sessionStorage.setItem(`smart-intake:preflight:${params.id}`, JSON.stringify(next));
      setNote("Correction saved. The preflight checklist is still open; fix the next issue, then rerun the review when you are ready.");
      load();
    } catch {
      setNote("The correction could not be saved. Check the connection and try again.");
    } finally {
      setQuickFixBusyKey("");
    }
  }

  function generateRecordNumberFromPanel(form: HTMLFormElement) {
    const panel = String(new FormData(form).get("provider_choice_plan") || "").trim();
    if (!panel) {
      setNote("Choose the insurance type first, then generate the Record#.");
      return;
    }
    if (!canGenerateRecordNumber(panel)) {
      setNote("Enter this panel's Record# manually. The generator is only for BCBS, United Health Care, AmeriHealth, and Carolina Complete.");
      return;
    }
    const input = form.elements.namedItem("record_number");
    if (!(input instanceof HTMLInputElement)) {
      setNote("The Record# field is not available. Please refresh this intake.");
      return;
    }
    const generated = makeRecordNumber(panel);
    input.value = generated;
    setNote(`Generated ${generated} for ${panel} (${recordNumberPrefix(panel)}). Click Save answers & notes to store it.`);
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
      {identityMismatch && (
        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-4 text-red-900" role="alert">
          <h2 className="font-bold">Packet generation paused for a client-name mismatch</h2>
          <p className="mt-2 text-sm">The client record says <b>{identityMismatch.recordName}</b>, but the intake answer says <b>{identityMismatch.answerName}</b>.</p>
          <p className="mt-2 text-sm">Review the name first. If the answer is correct and the DOB has been verified, a staff member may confirm the mismatch and generate the packet. This confirmation is recorded in the audit log.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/intakes/${i.id}/review?focus=client_full_name`} className="btn-secondary px-3 py-2 text-sm">Review / correct name</Link>
            <button className="btn-primary px-3 py-2 text-sm" onClick={() => act("Generate Completed Packet", () => fetch(`/api/intakes/${i.id}/generate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ allowIdentityMismatch: true }),
            }))}>
              Confirm names and generate packet
            </button>
          </div>
        </div>
      )}
      {lastSignatureAudit && (
        <div className={`mt-3 rounded-xl border p-4 ${
          lastSignatureAudit.missing || lastSignatureAudit.skippedSignatureSlots
            ? "border-amber-300 bg-amber-50 text-amber-900"
            : "border-emerald-300 bg-emerald-50 text-emerald-900"
        }`} role="status">
          <h2 className="font-bold">Signature audit from the generated packet</h2>
          <p className="mt-1 text-sm">
            {lastSignatureAudit.captured} signature role{lastSignatureAudit.captured === 1 ? "" : "s"} captured, {lastSignatureAudit.missing} missing, and {lastSignatureAudit.skippedSignatureSlots} PDF signature slot{lastSignatureAudit.skippedSignatureSlots === 1 ? "" : "s"} left blank.
          </p>
          {lastSignatureAudit.missingLabels.length > 0 && (
            <p className="mt-1 text-sm">Missing roles: {lastSignatureAudit.missingLabels.join(", ")}.</p>
          )}
          {lastSignatureAudit.missingLabels.includes("Client / guardian") && (
            <p className="mt-1 text-sm font-semibold">Client / guardian signatures are completed through the secure SMS intake, not the staff signature screen.</p>
          )}
          {(lastSignatureAudit.missing || lastSignatureAudit.skippedSignatureSlots) > 0 && (
            <Link href={`/intakes/${i.id}/review#staff-signatures`} className="btn-primary mt-3 inline-block px-3 py-2 text-sm">
              Add / rerun missing signatures
            </Link>
          )}
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
          {hasCca && (
            <button className="btn-secondary ml-2 px-3 py-1.5 text-sm disabled:cursor-wait disabled:opacity-60" type="button"
              disabled={ccaRescrubBusy || ccaBusy} onClick={() => { void rescrubCca(); }}>
              {ccaRescrubBusy ? "Re-reading CCA..." : "Re-scan latest CCA"}
            </button>
          )}
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
        <div id="preflight-review" className="card md:col-span-2 border-emerald-200 bg-emerald-50/40">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-emerald-900">AI preflight review</h3>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Staff-only final check before generating the packet. It looks for missing required items,
                identity or date conflicts, and service information that needs confirmation. It suggests only;
                it never signs, consents, diagnoses, or changes answers automatically.
              </p>
            </div>
            <button className="btn-primary px-3 py-1.5 text-sm disabled:cursor-wait disabled:opacity-60" type="button"
              disabled={preflightBusy} onClick={() => { void runPreflight(); }}>
              {preflightBusy ? "Reviewing..." : "Run preflight review"}
            </button>
          </div>
          {preflight && (
            <div className="mt-3 space-y-2" aria-live="polite">
              {preflightBlockingCount === 0 ? (
                <div className="rounded-xl border border-emerald-300 bg-emerald-100 p-3 text-emerald-900">
                  <p className="text-lg font-bold">→ 100% of blocking preflight checks are clear</p>
                  <p className="mt-1 text-sm">{preflight.message} {preflightOverrideCount ? `${preflightOverrideCount} item${preflightOverrideCount === 1 ? " was" : "s were"} intentionally overridden. ` : ""}Staff approval is still required before the packet is final.</p>
                  <button className="btn-primary mt-3 px-3 py-1.5 text-sm" type="button"
                    onClick={() => act("Generate Completed Packet", () => fetch(`/api/intakes/${i.id}/generate`, { method: "POST" }))}>
                    Continue to generate packet
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-300 bg-amber-100 p-3 text-amber-900">
                  <p className="font-bold">{preflightBlockingCount} item{preflightBlockingCount === 1 ? " needs" : "s need"} attention before the packet is ready.</p>
                  {preflightPendingCount > 0 && <p className="mt-1 text-sm">{preflightPendingCount} corrected item{preflightPendingCount === 1 ? " is" : "s are"} waiting for a final recheck.</p>}
                  <p className="mt-1 text-sm">{preflight.message}</p>
                </div>
              )}
              {preflight.findings.map((finding, index) => (
                <div key={`${finding.key}-${index}`} className={`rounded-lg border p-3 text-sm ${
                  finding.overridden ? "border-slate-200 bg-slate-100 text-slate-600" :
                  finding.pendingRecheck ? "border-sky-200 bg-sky-50 text-sky-900" :
                  finding.severity === "error" ? "border-red-200 bg-red-50 text-red-800" :
                  finding.severity === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" :
                  "border-slate-200 bg-white text-slate-700"
                }`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{finding.title}</b>
                    <span className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
                      {finding.overridden ? "Override recorded" : finding.pendingRecheck ? "Saved - rerun to verify" : finding.source === "ai" ? "AI suggestion" : "Automatic check"}
                    </span>
                  </div>
                  <p className="mt-1">{finding.detail}</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {finding.fieldKeys?.slice(0, 8).map((key, fieldIndex) => (
                      <Link key={key} className="font-semibold underline"
                        href={`/intakes/${i.id}/review?focus=${encodeURIComponent(key)}&return=preflight`}>
                        {finding.fieldLabels?.[fieldIndex] || (fieldIndex === 0 ? "Review in form" : key)}
                      </Link>
                    ))}
                    {!finding.overridden && finding.severity !== "info" && (
                      <button className="font-semibold underline disabled:opacity-50" type="button"
                        disabled={overrideBusyKey === finding.key} onClick={() => { void overridePreflight(finding); }}>
                        {overrideBusyKey === finding.key ? "Recording..." : "Override and continue"}
                      </button>
                    )}
                  </div>
                  {(finding.key === "identity_name" || finding.key === "identity_dob") && !finding.overridden && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <select className="input max-w-sm py-1.5 text-sm" value={quickFixChoice[finding.key] || ""}
                        onChange={(event) => setQuickFixChoice((current) => ({ ...current, [finding.key]: event.target.value }))}>
                        <option value="">Choose a correction option</option>
                        <option value="record">Use the intake record value</option>
                        <option value="manual">Open the form and review manually</option>
                      </select>
                      {quickFixChoice[finding.key] === "record" && (
                        <button className="btn-secondary px-3 py-1.5 text-sm disabled:opacity-50" type="button"
                          disabled={quickFixBusyKey === finding.key} onClick={() => { void applyQuickFix(finding); }}>
                          {quickFixBusyKey === finding.key ? "Applying..." : "Apply correction"}
                        </button>
                      )}
                      <span className="text-xs text-slate-500">Identity changes should be confirmed by staff.</span>
                    </div>
                  )}
                </div>
              ))}
              <p className="text-xs text-slate-500">The checklist stays open while you correct several items. Run preflight again when you are ready to verify the saved changes.</p>
            </div>
          )}
        </div>
        <div className="card md:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">NC Tracks / staff helper info</h3>
              <p className="mt-1 text-sm text-slate-500">
                Use the dropdowns for common answers or paste one answer per line below.
                Saving a client answer here fills the packet and removes that question
                from the client&apos;s SMS intake. Consent and signature questions stay with the client.
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
            className="mt-4 space-y-3"
            onSubmit={(e) => { e.preventDefault(); void saveAssist(e.currentTarget); }}
          >
            <details open className="rounded-xl border border-brand/30 bg-brand-light/30 p-3">
              <summary className="cursor-pointer list-none">
                <span className="font-semibold text-brand">Quick Notes: paste confirmed answers</span>
                <span className="ml-2 text-xs text-slate-600">Race, veteran status, insurance, PCP, emergency contact, and more</span>
              </summary>
              <p className="mt-2 text-xs text-slate-600">Use one confirmed answer per line. Saving applies the answers to the intake packet and lets the client skip those questions in SMS. Consent and signature questions stay with the client.</p>
              <textarea name="helperNotes" className="input mt-3 min-h-[130px] w-full"
                defaultValue={String(d.answers.staff_helper_notes ?? "")}
                placeholder={"Race: Black or African American\nVeteran: No\nEthnicity: Non-Hispanic/Black\nEmployment status: Unemployed\nInsurance type: Alliance\nPCP: Guilford County Pediatrics\nPCP phone: 336-555-0100\nEmergency contact: Jane Smith\nEmergency phone: 336-555-0101\nTransport: Services / treatment plan activities"} />
            </details>

            <HelperGroup title="Common client answers" description="Start here to shorten the SMS questions." defaultOpen>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <HelperSelect name="gender" label="Gender" value={d.answers.gender ?? ""} options={GENDER_OPTIONS} placeholder="Select gender" />
                <HelperSelect name="race" label="Race" value={d.answers.race ?? ""} options={RACE_OPTIONS} placeholder="Select race" />
                <HelperSelect name="ethnicity" label="Ethnicity" value={d.answers.ethnicity ?? ""} options={ETHNICITY_OPTIONS} placeholder="Select ethnicity" />
                <HelperSelect name="marital_status" label="Marital status" value={d.answers.marital_status ?? ""} options={MARITAL_STATUS_OPTIONS} placeholder="Select marital status" />
                <HelperSelect name="veteran" label="Veteran" value={d.answers.veteran ?? ""} options={VETERAN_OPTIONS} placeholder="Select yes or no" />
                <HelperSelect name="employment_status" label="Employment status" value={d.answers.employment_status ?? ""} options={EMPLOYMENT_OPTIONS} placeholder="Select employment status" />
                <HelperSelect name="education" label="Highest education" value={d.answers.education ?? ""} options={EDUCATION_OPTIONS} placeholder="Select education" />
                <HelperSelect name="language" label="Preferred language" value={d.answers.language ?? ""} options={LANGUAGE_OPTIONS} placeholder="Select language" />
                <HelperInput name="language_other" label="Other language" value={d.answers.language_other ?? ""} />
                <HelperSelect name="communication_level" label="Communication level" value={d.answers.communication_level ?? ""} options={COMMUNICATION_OPTIONS} placeholder="Select level" />
              </div>
            </HelperGroup>

            <HelperGroup title="Contact & household" description="Confirmed contact details can remove several client questions.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <HelperInput name="client_phone_cell" label="Cell phone" value={d.answers.client_phone_cell ?? i.client.phone ?? ""} />
                <HelperInput name="client_phone_home" label="Home phone" value={d.answers.client_phone_home ?? ""} />
                <HelperInput name="client_phone_work" label="Work phone" value={d.answers.client_phone_work ?? ""} />
                <HelperInput name="client_email" label="Email" value={d.answers.client_email ?? i.client.email ?? ""} />
                <HelperInput name="address_street" label="Street address" value={d.answers.address_street ?? ""} />
                <HelperInput name="address_city" label="City" value={d.answers.address_city ?? ""} />
                <HelperInput name="address_state" label="State" value={d.answers.address_state ?? ""} />
                <HelperSelect name="living_arrangement" label="Living arrangement" value={d.answers.living_arrangement ?? ""} options={LIVING_ARRANGEMENT_OPTIONS} placeholder="Select arrangement" />
                <HelperInput name="lives_with_whom" label="Who does the client live with?" value={d.answers.lives_with_whom ?? ""} />
                <HelperInput name="lives_where" label="Living area" value={d.answers.lives_where ?? ""} />
              </div>
            </HelperGroup>

            <HelperGroup title="Insurance, referral & services" description="Use confirmed plan, referral, and requested-service information.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <HelperInput name="mid_number" label="MID# (Medicaid ID)" value={d.answers.mid_number ?? ""} />
                <HelperSelect name="has_medicaid" label="Medicaid" value={d.answers.has_medicaid ?? ""} options={YES_NO_OPTIONS} placeholder="Select yes or no" />
                <HelperInput name="medicaid_effective_date" label="Medicaid effective date" value={d.answers.medicaid_effective_date ?? ""} />
                <HelperSelect name="provider_choice_plan" label="Type of insurance" value={d.answers.provider_choice_plan ?? d.answers.mco ?? ""} options={PROVIDER_CHOICE_PLAN_OPTIONS} placeholder="Select insurance type" />
                <HelperSelect name="has_medicare" label="Medicare" value={d.answers.has_medicare ?? ""} options={YES_NO_OPTIONS} placeholder="Select yes or no" />
                <HelperInput name="medicare_effective_date" label="Medicare effective date" value={d.answers.medicare_effective_date ?? ""} />
                <HelperSelect name="has_nchc" label="NC Health Choice" value={d.answers.has_nchc ?? ""} options={YES_NO_OPTIONS} placeholder="Select yes or no" />
                <HelperInput name="nchc_policy" label="NCHC policy number" value={d.answers.nchc_policy ?? ""} />
                <HelperInput name="nchc_effective_date" label="NCHC effective date" value={d.answers.nchc_effective_date ?? ""} />
                <HelperInput name="funding_other" label="Other funding source" value={d.answers.funding_other ?? ""} />
                <HelperInput name="income_sources" label="Income sources (separate with commas)" value={d.answers.income_sources ?? ""} />
                <HelperInput name="income_other" label="Other income" value={d.answers.income_other ?? ""} />
                <HelperSelect name="referral_source" label="Referral source" value={d.answers.referral_source ?? ""} options={REFERRAL_OPTIONS} placeholder="Select referral source" />
                <HelperInput name="social_agency_name" label="Social agency" value={d.answers.social_agency_name ?? ""} />
                <HelperInput name="referral_source_other" label="Other agency/provider name" value={d.answers.referral_source_other ?? ""} />
                <HelperInput name="referred_for" label="Referred for (separate with commas)" value={d.answers.referred_for ?? ""} />
                <HelperInput name="services_requested" label="Services requested (separate with commas)" value={d.answers.services_requested ?? ""} />
                <HelperInput name="services_other" label="Other service" value={d.answers.services_other ?? ""} />
              </div>
            </HelperGroup>

            <HelperGroup title="Health & care team" description="Add information already confirmed by the client, PCP, or clinical records.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <HelperInput name="pcp_name" label="Primary care doctor" value={d.answers.pcp_name ?? ""} />
                <HelperInput name="pcp_phone" label="PCP phone" value={d.answers.pcp_phone ?? ""} />
                <HelperInput name="pcp_address" label="PCP address / practice" value={d.answers.pcp_address ?? ""} />
                <HelperInput name="preferred_emergency_facility" label="Local hospital / ER" value={d.answers.preferred_emergency_facility ?? ""} />
                <HelperSelect name="no_pcp_nearest_er" label="No PCP; use nearest ER" value={d.answers.no_pcp_nearest_er ?? ""} options={YES_NO_OPTIONS} placeholder="Select yes or no" />
                <HelperSelect name="has_current_diagnosis" label="Current diagnosis known" value={d.answers.has_current_diagnosis ?? ""} options={YES_NO_OPTIONS} placeholder="Select yes or no" />
                <HelperInput name="diagnosis_list" label="Diagnosis list" value={d.answers.diagnosis_list ?? ""} />
                <HelperInput name="current_diagnosis_known" label="Current diagnosis, if known" value={d.answers.current_diagnosis_known ?? ""} />
                <HelperInput name="mh_history" label="Mental health history" value={d.answers.mh_history ?? ""} />
                <HelperSelect name="has_current_therapist" label="Current therapist" value={d.answers.has_current_therapist ?? ""} options={YES_NO_OPTIONS} placeholder="Select yes or no" />
                <HelperInput name="therapist_name" label="Therapist name" value={d.answers.therapist_name ?? ""} />
                <HelperInput name="therapist_agency_phone" label="Therapist agency / phone" value={d.answers.therapist_agency_phone ?? ""} />
                <HelperSelect name="receiving_mh_services" label="Receiving mental health services" value={d.answers.receiving_mh_services ?? ""} options={YES_NO_OPTIONS} placeholder="Select yes or no" />
                <HelperInput name="mh_services_desc" label="Mental health services" value={d.answers.mh_services_desc ?? ""} />
                <HelperInput name="mh_service_provider" label="Mental health provider" value={d.answers.mh_service_provider ?? ""} />
                <HelperSelect name="has_limitations" label="Physical limitations" value={d.answers.has_limitations ?? ""} options={YES_NO_OPTIONS} placeholder="Select yes or no" />
                <HelperInput name="limitations_desc" label="Limitations detail" value={d.answers.limitations_desc ?? ""} />
                <HelperInput name="medical_diagnoses" label="Medical conditions" value={d.answers.medical_diagnoses ?? ""} />
                <HelperInput name="treatments" label="Medical treatments" value={d.answers.treatments ?? ""} />
                <HelperInput name="hospitalizations" label="Hospitalizations / surgeries" value={d.answers.hospitalizations ?? ""} />
                <HelperInput name="last_physical_date" label="Last physical date" value={d.answers.last_physical_date ?? ""} />
                <HelperInput name="height" label="Height" value={d.answers.height ?? ""} />
                <HelperInput name="weight" label="Weight" value={d.answers.weight ?? ""} />
                <HelperInput name="hair_color" label="Hair color" value={d.answers.hair_color ?? ""} />
                <HelperInput name="eye_color" label="Eye color" value={d.answers.eye_color ?? ""} />
                <HelperInput name="identifying_marks" label="Identifying marks / tattoos" value={d.answers.identifying_marks ?? ""} />
                <HelperInput name="special_diets" label="Special diets" value={d.answers.special_diets ?? ""} />
                <HelperInput name="medical_alerts" label="Medical alerts" value={d.answers.medical_alerts ?? ""} />
                <HelperInput name="fax" label="Fax" value={d.answers.fax ?? ""} />
                <HelperTextArea name="medications" label="Prescription medications" value={d.answers.medications ?? ""} />
                <HelperTextArea name="otc_medications" label="Over-the-counter medications" value={d.answers.otc_medications ?? ""} />
                <HelperInput name="drug_allergies" label="Drug allergies" value={d.answers.drug_allergies ?? ""} />
                <HelperInput name="environmental_allergies" label="Food / environmental allergies" value={d.answers.environmental_allergies ?? ""} />
                <HelperInput name="allergies" label="Other allergies" value={d.answers.allergies ?? ""} />
                <HelperTextArea name="presenting_problem" label="What brings the client in?" value={d.answers.presenting_problem ?? ""} />
                <HelperInput name="strengths" label="Strengths" value={d.answers.strengths ?? ""} />
                <HelperInput name="needs" label="Needs" value={d.answers.needs ?? ""} />
                <HelperInput name="abilities" label="Abilities" value={d.answers.abilities ?? ""} />
                <HelperInput name="preferences" label="Care preferences" value={d.answers.preferences ?? ""} />
              </div>
            </HelperGroup>

            <HelperGroup title="Guardian & emergency contact" description="Use this when the guardian or emergency contact information is already known.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <HelperSelect name="pending_court_cases" label="Pending court cases" value={d.answers.pending_court_cases ?? ""} options={YES_NO_OPTIONS} placeholder="Select yes or no" />
                <HelperInput name="court_case_desc" label="Court case detail" value={d.answers.court_case_desc ?? ""} />
                <HelperSelect name="is_minor_or_incompetent" label="Minor or legal guardian" value={d.answers.is_minor_or_incompetent ?? ""} options={YES_NO_OPTIONS} placeholder="Select yes or no" />
                <HelperInput name="date_adjudicated" label="Date adjudicated" value={d.answers.date_adjudicated ?? ""} />
                <HelperInput name="guardian_name" label="Guardian name" value={d.answers.guardian_name ?? i.client.guardianName ?? ""} />
                <HelperInput name="guardian_address" label="Guardian address" value={d.answers.guardian_address ?? ""} />
                <HelperInput name="guardian_phone" label="Guardian phone" value={d.answers.guardian_phone ?? ""} />
                <HelperInput name="guardian_email" label="Guardian email" value={d.answers.guardian_email ?? ""} />
                <HelperInput name="ec1_name" label="Emergency contact" value={d.answers.ec1_name ?? ""} />
                <HelperInput name="ec1_cell_phone" label="Emergency cell phone" value={d.answers.ec1_cell_phone ?? ""} />
                <HelperInput name="ec1_home_phone" label="Emergency home phone" value={d.answers.ec1_home_phone ?? ""} />
                <HelperInput name="ec1_work_phone" label="Emergency work phone" value={d.answers.ec1_work_phone ?? ""} />
                <HelperInput name="ec1_street" label="Emergency street" value={d.answers.ec1_street ?? ""} />
                <HelperInput name="ec1_city" label="Emergency city" value={d.answers.ec1_city ?? ""} />
                <HelperInput name="ec1_state" label="Emergency state" value={d.answers.ec1_state ?? ""} />
              </div>
            </HelperGroup>

            <HelperGroup title="Staff & packet setup" description="These fields help staff complete the packet but do not replace client consent.">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <HelperInput name="record_number" label="Record #" value={d.answers.record_number ?? ""} />
                <HelperInput name="staff_receiving_intake" label="Staff / QP / clinician name" value={d.answers.staff_receiving_intake ?? d.answers.clinician_name ?? ""} />
                <HelperInput name="transport_destination" label="Transport line" value={d.answers.transport_destination ?? ""} />
                <HelperInput name="transport_purposes" label="Transport purpose(s)" value={d.answers.transport_purposes ?? ""} />
                <div className="flex flex-wrap items-center gap-2 md:col-span-3">
                  <button type="button" className="btn-secondary px-3 py-1.5 text-sm"
                    onClick={(e) => e.currentTarget.form && generateRecordNumberFromPanel(e.currentTarget.form)}>
                    Generate record # from insurance panel
                  </button>
                  <span className="text-xs text-slate-500">Format: PANEL-12345. Select the insurance type in the section above first.</span>
                </div>
                <details className="rounded-lg border border-amber-200 bg-amber-50 p-3 md:col-span-3">
                  <summary className="cursor-pointer text-sm font-semibold text-amber-900">Lookup Partners, Vaya, Alliance, or Trillium Record#</summary>
                  <p className="mt-2 text-xs text-amber-800">These four plans are lookup-only. Open the official page, find the client record, then type that Record# above.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {RECORD_NUMBER_LOOKUP_LINKS.map((link) => (
                      <a key={link.key} className="btn-ghost px-2 py-1 text-xs" href={link.url} target="_blank" rel="noreferrer">
                        {link.label} lookup
                      </a>
                    ))}
                  </div>
                </details>
              </div>
            </HelperGroup>

            <div className="flex flex-wrap gap-2 pt-1">
              <button className="btn-primary disabled:cursor-wait disabled:opacity-60" type="submit" disabled={saveAssistBusy}>
                {saveAssistBusy ? "Saving answers..." : "Save answers & notes"}
              </button>
              <span className="self-center text-xs text-slate-500">
                The confirmation above will tell you what reached the intake packet and what the client can skip.
              </span>
            </div>
            {saveAssistMessage && (
              <p className={`rounded-lg p-3 text-sm font-semibold ${
                saveAssistKind === "success" ? "bg-emerald-50 text-emerald-700" :
                saveAssistKind === "error" ? "bg-red-50 text-red-700" : "bg-brand-light text-brand"
              }`} role="status">
                {saveAssistMessage}
              </p>
            )}
          </form>
        </div>
        <MissingFieldsPanel required={d.missingRequired} optional={d.missingOptional} />
        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="mb-2 font-bold">Signatures</h3>
            <Link href={`/intakes/${i.id}/review#staff-signatures`} className="btn-ghost px-3 py-1.5 text-xs">Add / rerun signatures</Link>
          </div>
          {i.signatures.length === 0 && <p className="text-sm text-slate-400">None captured yet.</p>}
          <ul className="text-sm">
            {i.signatures.map((s) => (
              <li key={s.role}><b>{signatureRoleLabel(s.role)}</b> - {s.printedName} ({s.signedDate})</li>
            ))}
          </ul>
          <div className="mt-4 space-y-2 border-t border-slate-200 pt-3">
            {d.signatureStatuses.map((status) => (
              <div key={status.key} className={`rounded-lg px-3 py-2 text-xs ${
                status.state === "captured" ? "bg-emerald-50 text-emerald-800" :
                status.required ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
              }`}>
                <b>{status.label}:</b>{" "}
                {status.state === "captured"
                  ? `Captured${status.signedDate ? ` on ${status.signedDate}` : " (date not recorded)"}`
                  : `Missing - ${status.reason}`}
              </div>
            ))}
          </div>
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

function HelperTextArea({ name, label, value }: { name: string; label: string; value: unknown }) {
  return (
    <label>
      <span className="label">{label}</span>
      <textarea className="input min-h-[72px]" name={name} defaultValue={String(value ?? "")} />
    </label>
  );
}

function HelperGroup({
  title,
  description,
  defaultOpen = false,
  children,
}: { title: string; description: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="rounded-xl border border-slate-200 bg-slate-50/60 p-3" open={defaultOpen}>
      <summary className="cursor-pointer list-none">
        <span className="font-semibold text-slate-800">{title}</span>
        <span className="ml-2 text-xs text-slate-500">{description}</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function HelperSelect({
  name,
  label,
  value,
  options,
  placeholder,
}: {
  name: string;
  label: string;
  value: unknown;
  options: string[];
  placeholder?: string;
}) {
  return (
    <label>
      <span className="label">{label}</span>
      <select className="input" name={name} defaultValue={String(value ?? "")}>
        <option value="">{placeholder || "Choose an option"}</option>
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
