"use client";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import MissingFieldsPanel from "@/components/MissingFieldsPanel";
import CoveragePanel from "@/components/CoveragePanel";
import ManualSendPanel from "@/components/ManualSendPanel";
import type { CcaReview } from "@/lib/ccaReview";
import { canGenerateRecordNumber, makeRecordNumber, PROVIDER_CHOICE_PLAN_OPTIONS, RECORD_NUMBER_LOOKUP_LINKS, recordNumberPrefix } from "@/lib/insurancePlans";
import { moodScores } from "@/lib/moodScores";
import { REFERRAL_SOURCE_OPTIONS } from "@/config/mooreDivineQuestions";
import {
  copiesMailtoHref,
  copiesShareMessage,
  copiesSmsHref,
  followUpMailtoHref,
  followUpShareMessage,
  followUpSmsHref,
  intakeMailtoHref,
  intakeShareMessage,
  intakeSmsHref,
} from "@/lib/shareLinks";
import { clientLinkExpired, clientLinkMessagingFinished } from "@/lib/clientLinkState";
import {
  clientDeliveryContacts,
  clientDeliveryContactsForRole,
  clientFollowUpDeliveryContacts,
} from "@/lib/clientDeliveryContacts";
import { clientFollowUpQuestions } from "@/lib/clientFollowUp";
import { hasSmsDeliveryFailure } from "@/lib/dashboardFlash";
import { buildCasePageStatus, type CaseWorkflowStep } from "@/lib/staffCaseStatus";
import { buildPacketChecklistChips } from "@/lib/packetChecklist";

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
  resolved?: "corrected" | "overridden";
  correctionOptions?: Array<{
    id: string;
    label: string;
    detail: string;
    updates: Array<{
      key: string;
      fieldLabel: string;
      sourceKey: string;
      sourceLabel: string;
      expectedCurrent: string;
      proposedValue: string;
    }>;
  }>;
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

type FollowUpDeliveryResult = {
  link: string;
  deliveryOk: boolean;
  deliveryState: "sent" | "partial" | "failed";
  recipientRole: "client" | "guardian";
  sent: string[];
  failed: string[];
  expiresAt: string;
  fields: { key: string; label: string }[];
};

function maskedPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `ending ${digits.slice(-4)}` : "saved number";
}

function maskedEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "saved email";
  return `${local.slice(0, 1)}***@${domain}`;
}

interface Detail {
  intake: {
    id: string; status: string; tokenExpiresAt: string; intakeDate?: string; linkSentAt?: string | null;
    submittedAt?: string | null;
    expectCca?: boolean;
    docusignEnvelopeId?: string | null;
    provider?: { name: string; phone?: string | null } | null;
    client: {
      fullName: string;
      dob: string;
      midNumber?: string;
      email?: string;
      phone?: string;
      guardianName?: string;
      guardianEmail?: string;
      guardianPhone?: string;
    };
    signatures: { role: string; printedName: string; signedDate: string }[];
    uploadedDocuments: { id: string; docType: string; fileName: string; createdAt?: string; ccaReview?: CcaReview | null }[];
    generatedPdfs: { id: string; createdAt: string; packetVersion?: number; contentRevision?: number }[];
    auditLogs: { id: string; event: string; detail?: string; createdAt: string }[];
    followUps: {
      status: "OPEN" | "PROCESSING" | "COMPLETED" | "SUPERSEDED";
      recipientRole: "client" | "guardian";
      fieldKeys: string[];
      link: string;
      tokenExpiresAt: string;
      sentAt?: string | null;
      completedAt?: string | null;
      attestedAt?: string | null;
      skippedKeys: string[];
      savedCount: number;
      createdAt: string;
    }[];
  };
  answers: Record<string, unknown>;
  clientLink: string; percentComplete: number;
  missingRequired: { key: string; label: string }[];
  missingOptional: { key: string; label: string; section?: string }[];
  signatureStatuses: {
    key: string; label: string; state: "captured" | "missing" | "invalid"; required: boolean;
    onPacket?: boolean; signedDate?: string; reason: string;
  }[];
  providerPacketReadiness: {
    ready: boolean;
    state: string;
    templateName?: string | null;
    message: string;
  };
  generationReadiness?: {
    ready: boolean;
    blockers: { code: string; message: string; fieldKeys?: string[] }[];
    contentRevision: number;
  };
  packetFreshness?: { state: "missing" | "current" | "stale"; generatedAt?: string | null };
  accuracyConflicts?: {
    key: string; severity: "error" | "warning"; title: string; detail: string; fieldKeys: string[];
  }[];
  planCompleteness?: {
    pcp: { total: number; completed: number; missing: string[]; state: string };
    crisis: { total: number; completed: number; missing: string[]; state: string };
  } | null;
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
  const [signatureReminderBusy, setSignatureReminderBusy] = useState(false);
  const [clientLinkBusy, setClientLinkBusy] = useState(false);
  const [manualSendingOpen, setManualSendingOpen] = useState(false);
  const [smsFallbackNeeded, setSmsFallbackNeeded] = useState(false);
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [followUpRefreshBusy, setFollowUpRefreshBusy] = useState(false);
  const [followUpResult, setFollowUpResult] = useState<FollowUpDeliveryResult | null>(null);
  const [copiesLink, setCopiesLink] = useState("");
  const [copiesBusy, setCopiesBusy] = useState(false);
  const [ncTracksBusy, setNcTracksBusy] = useState(false);
  const [ncTracksUploadBusy, setNcTracksUploadBusy] = useState(false);
  const [ncTracksResult, setNcTracksResult] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/intakes/${params.id}`, { cache: "no-store" });
      if (r.status === 401) {
        window.location.href = "/login";
        return null;
      }
      if (r.ok) {
        const body = await r.json() as Detail;
        setD(body);
        if (body.intake.followUps?.[0]?.status === "COMPLETED") setFollowUpResult(null);
        return body;
      } else {
        setNote("Could not load this intake. Please refresh or sign in again.");
        return null;
      }
    } catch {
      setNote("Could not load this intake. Check your connection and try again.");
      return null;
    }
  }, [params.id]);
  useEffect(() => { void load(); }, [load]);

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
    const focusKey = query.get("focus");
    setNote(returningToPreflight
      ? "Saved. Your preflight checklist is still open; correct the next item and rerun the review when you are ready."
      : "Staff signature and changes saved successfully. Next step: review the intake/preflight findings, then generate the packet.");
    window.history.replaceState({}, "", window.location.pathname);
    if (returningToPreflight) {
      if (focusKey) {
        try {
          const stored = sessionStorage.getItem(`smart-intake:preflight:${params.id}`);
          if (stored) {
            const restored = JSON.parse(stored) as PreflightResult;
            const next = {
              ...restored,
              findings: restored.findings.map((finding) => finding.fieldKeys?.includes(focusKey)
                ? { ...finding, pendingRecheck: true, resolved: "corrected" as const }
                : finding),
            };
            setPreflight(next);
            sessionStorage.setItem(`smart-intake:preflight:${params.id}`, JSON.stringify(next));
          }
        } catch {
          sessionStorage.removeItem(`smart-intake:preflight:${params.id}`);
        }
      }
      window.setTimeout(() => document.getElementById("preflight-review")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  }, [params.id]);

  if (!d) return <main className="p-10 text-center text-slate-400">Loading...</main>;
  const i = d.intake;
  const packetReady = d.providerPacketReadiness.ready;
  const generationReady = d.generationReadiness?.ready === true;
  const generationBlockers = d.generationReadiness?.blockers || [];
  const finalPacketCurrent = d.packetFreshness?.state === "current";
  const signatureDeliveryBlockers = generationBlockers.filter((blocker) => {
    if (["client_signature_missing", "client_signature_invalid", "staff_signature_missing", "staff_signature_invalid"].includes(blocker.code)) return false;
    if (blocker.code === "required_fields" && blocker.fieldKeys?.every((key) => key === "signature")) return false;
    return true;
  });
  const signatureDeliveryReady = packetReady && signatureDeliveryBlockers.length === 0;
  const firstGenerationBlocker = generationBlockers[0]?.message || "Complete readiness review before generating.";
  const providerName = i.provider?.name || "Moore Divine Care";
  const providerPhone = i.provider?.phone || "";
  const clientMessage = intakeShareMessage(d.clientLink, providerName, providerPhone);
  const copiesMessage = copiesLink ? copiesShareMessage(copiesLink, providerName) : "";
  const helperFormKey = HELPER_FORM_KEYS.map((key) => String(d.answers[key] ?? "")).join("\u001f");
  const ccaDocuments = i.uploadedDocuments
    .filter((document) => document.docType === "CCA")
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")));
  const latestCca = ccaDocuments[0];
  const hasCca = ccaDocuments.length > 0;
  const expectCca = i.expectCca !== false;
  const ccaNeeded = expectCca && !hasCca;
  const ccaReview = latestCca?.ccaReview || null;
  const hasClientSignature = i.signatures.some((signature) => signature.role === "client" || signature.role === "guardian");
  const copiesSent = i.auditLogs.some((entry) => entry.event === "copies_link_sent");
  const reviewed = i.auditLogs.some((entry) => entry.event === "staff_reviewed");
  const missingAnswerCount = d.missingRequired.filter((field) => field.key !== "signature").length;
  const caseStatus = buildCasePageStatus({
    status: i.status,
    missingRequiredCount: missingAnswerCount,
    expectCca,
    hasCca,
    signatureStatuses: d.signatureStatuses,
    generatedPdfCount: i.generatedPdfs.length,
    providerPacketReady: packetReady,
    copiesSent,
    reviewed,
    providerPacketMessage: d.providerPacketReadiness.message,
  });
  const packetChecklist = buildPacketChecklistChips({
    answers: d.answers,
    uploadedDocuments: i.uploadedDocuments,
    expectCca,
    hasCca,
    signatureStatuses: d.signatureStatuses,
    provider: i.provider,
  });
  const linkExpired = clientLinkExpired(i.tokenExpiresAt);
  const linkFinished = clientLinkMessagingFinished(i.status);
  const deliveryContacts = clientDeliveryContacts(i.client);
  const defaultFollowUpDeliveryContacts = clientFollowUpDeliveryContacts(
    i.client,
    d.answers,
    i.signatures,
  );
  const hasClientContact = !!(deliveryContacts.phone || deliveryContacts.email);
  const originalClientIntakeFinished = hasClientSignature && (
    i.status === "SIGNED"
    || i.status === "COMPLETED"
    || !!i.submittedAt
  );
  const lastLinkOpened = i.auditLogs.find((entry) => entry.event === "link_opened");
  const openedCurrentDelivery = !!lastLinkOpened && (
    !i.linkSentAt || Date.parse(lastLinkOpened.createdAt) >= Date.parse(i.linkSentAt)
  );
  const lastLinkReminder = i.auditLogs.find((entry) => (
    entry.event === "link_reminder_sent" || entry.event === "signature_reminder_sent"
  ) && /(^|;\s*)sent\s/i.test(entry.detail || ""));
  const reminderCount = i.auditLogs.filter((entry) => (
    entry.event === "link_reminder_sent" || entry.event === "signature_reminder_sent"
  ) && /(^|;\s*)sent\s/i.test(entry.detail || "")).length;
  const contactSummary = [
    deliveryContacts.phone
      ? `SMS to ${deliveryContacts.phone.role} at ${deliveryContacts.phone.value}`
      : "",
    deliveryContacts.email
      ? `email to ${deliveryContacts.email.role} at ${deliveryContacts.email.value}`
      : "",
  ].filter(Boolean).join(" and ");
  const providerPacketEmailEnabled = d.answers.auto_email_provider_packet === true;
  const preflightBlockingCount = preflight?.findings.filter((finding) => finding.severity !== "info" && !finding.overridden && !finding.resolved).length ?? 0;
  const preflightOverrideCount = preflight?.findings.filter((finding) => finding.overridden || finding.resolved === "overridden").length ?? 0;
  const preflightCorrectedCount = preflight?.findings.filter((finding) => finding.resolved === "corrected").length ?? 0;
  const preflightIsClear = !!preflight && preflightBlockingCount === 0;
  const missingClientFieldKeys = [...new Set([
    ...d.missingRequired.map((field) => field.key),
    ...d.missingOptional.map((field) => field.key),
  ])];
  const allFollowUpQuestions = clientFollowUpQuestions(missingClientFieldKeys, d.answers);
  const deferredFollowUpKeys = new Set(i.followUps
    .filter((followUp) => followUp.status === "COMPLETED")
    .flatMap((followUp) => followUp.skippedKeys));
  const deferredFollowUpQuestions = allFollowUpQuestions.filter((question) => (
    deferredFollowUpKeys.has(question.key)
  ));
  const followUpQuestions = allFollowUpQuestions.filter((question) => (
    !deferredFollowUpKeys.has(question.key)
  ));
  const latestFollowUp = i.followUps?.[0] || null;
  const latestFollowUpQuestions = latestFollowUp
    ? clientFollowUpQuestions(latestFollowUp.fieldKeys, d.answers, { missingOnly: false })
    : [];
  const latestFollowUpExpired = !!latestFollowUp && Date.parse(latestFollowUp.tokenExpiresAt) <= Date.now();
  const activeFollowUp = !!latestFollowUp
    && latestFollowUp.status === "OPEN"
    && !latestFollowUpExpired;
  const processingFollowUp = latestFollowUp?.status === "PROCESSING";
  const followUpInProgress = activeFollowUp || processingFollowUp;
  const followUpLink = followUpResult?.link || (activeFollowUp ? latestFollowUp?.link || "" : "");
  const followUpFields = followUpResult?.fields || (activeFollowUp
    ? latestFollowUpQuestions.map((question) => ({ key: question.key, label: question.label }))
    : []);
  const followUpMessage = followUpLink
    ? followUpShareMessage(followUpLink, providerName, providerPhone)
    : "";
  const followUpRecipientRole = followUpResult?.recipientRole
    || (followUpInProgress ? latestFollowUp?.recipientRole : null)
    || defaultFollowUpDeliveryContacts.role;
  const followUpDeliveryContacts = clientDeliveryContactsForRole(
    i.client,
    followUpRecipientRole,
  );
  const followUpRecipientSummary = [
    followUpDeliveryContacts.phone ? `SMS ${maskedPhone(followUpDeliveryContacts.phone.value)}` : "",
    followUpDeliveryContacts.email ? `email ${maskedEmail(followUpDeliveryContacts.email.value)}` : "",
  ].filter(Boolean).join(" and ");

  function deliveryStatus(body: Record<string, unknown>, fallback: string): string {
    const sent = Array.isArray(body.sent) ? body.sent : [];
    const failed = Array.isArray(body.failed) ? body.failed : [];
    if (sent.length) {
      return `Delivery result: ${sent.join("; ")}${failed.length ? `. Not accepted: ${failed.join("; ")}` : "."}`;
    }
    return failed.length ? `Delivery was not accepted: ${failed.join("; ")}` : fallback;
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
      const review = b.ccaReview as CcaReview | undefined;
      const medicationCount = (review?.prescriptionMedications.length || 0) + (review?.otcMedications.length || 0);
      const majorErrors = review?.majorErrors.length || 0;
      setCcaResultKind("success");
      setCcaResult(`CCA successfully uploaded. It answered ${filled} intake question${filled === 1 ? "" : "s"} automatically` +
        (extracted && extracted !== filled ? ` (${extracted} found in the CCA` +
          (skipped ? `, ${skipped} kept from existing answers` : "") + ")" : "") +
        `. Medication review captured ${medicationCount} medication${medicationCount === 1 ? "" : "s"}.` +
        ` CCA accuracy review found ${majorErrors} major issue${majorErrors === 1 ? "" : "s"}. Review the separate CCA accuracy section before generating the packet.`);
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
    if (label === "Generate Completed Packet") {
      if (!r.ok && b.code === "IDENTITY_MISMATCH") {
        setIdentityMismatch({ recordName: String(b.recordName || "client record"), answerName: String(b.answerName || "intake answer") });
        setNote("Packet generation paused. Confirm the client name or review and correct it before generating.");
        return;
      }
      if (!r.ok && b.code === "INTAKE_NOT_READY" && Array.isArray(b.blockers)) {
        const messages = b.blockers.slice(0, 4).map((blocker: { message?: string }) => blocker.message).filter(Boolean);
        setNote(`Packet generation blocked: ${messages.join(" | ")}`);
        await load();
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
    if (!caseStatus.sendCopiesAllowed) {
      setNote(caseStatus.detail || caseStatus.headline);
      return;
    }
    setNote("Sending copies link...");
    setCopiesBusy(true);
    try {
      const r = await fetch(`/api/intakes/${i.id}/copies`, { method: "POST" });
      const b = await r.json().catch(() => ({}));
      if (r.ok) {
        setCopiesLink(b.link || "");
        setNote(deliveryStatus(b, "No email or phone is saved, so the client copies were not sent. A secure copies link was created below."));
      } else {
        setCopiesLink(b.link || "");
        setNote(deliveryStatus(b, `Client-copy delivery failed: ${b.error || r.status}`));
      }
    } finally {
      setCopiesBusy(false);
    }
    load();
  }

  async function setProviderPacketEmail(enabled: boolean) {
    setNote(`${enabled ? "Enabling" : "Disabling"} automatic provider packet email...`);
    const r = await fetch(`/api/intakes/${i.id}/copies/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoEmailProvider: enabled }),
    });
    const b = await r.json().catch(() => ({}));
    setNote(r.ok
      ? `Automatic completed packet email ${enabled ? "enabled" : "disabled"}.`
      : b.error || "Provider packet email setting could not be saved.");
    if (r.ok) load();
  }

  async function sendProviderPacketNow() {
    setNote("Emailing the completed packet to the provider...");
    const r = await fetch(`/api/intakes/${i.id}/copies/provider`, { method: "POST" });
    const b = await r.json().catch(() => ({}));
    setNote(r.ok ? `Completed packet emailed to ${b.to || "the provider"}.` : `Provider packet email failed: ${b.reason || b.detail || b.error || r.status}`);
  }

  async function sendIntakeLink() {
    setClientLinkBusy(true);
    setNote(linkExpired ? "Renewing the secure link and contacting the client..." : "Sending the secure link to the saved contacts...");
    try {
      const r = await fetch(`/api/intakes/${i.id}/remind`, { method: "POST" });
      const b = await r.json().catch(() => ({}));
      const failed = Array.isArray(b.failed) ? b.failed : [];
      const smsFailed = hasSmsDeliveryFailure(failed);
      setSmsFallbackNeeded(smsFailed);
      if (smsFailed) setManualSendingOpen(true);
      if (r.ok && b.ok) {
        setNote(`${b.renewed ? "Expired link renewed. " : ""}${deliveryStatus(b, "No delivery result was returned.")}`);
      } else {
        setNote(b.error || deliveryStatus(b, "The secure link was not sent."));
      }
      load();
    } catch {
      setNote("The secure link could not be sent. Check your connection and try again.");
    } finally {
      setClientLinkBusy(false);
    }
  }

  async function sendClientFollowUp(
    questionsToSend: typeof followUpQuestions = followUpQuestions,
  ) {
    if (!questionsToSend.length) {
      setNote("No missing client-safe questions are available to send. Use staff review or an override for the remaining items.");
      return;
    }
    setFollowUpBusy(true);
    setFollowUpResult(null);
    setNote(`Creating a private follow-up for ${questionsToSend.length} missing answer${questionsToSend.length === 1 ? "" : "s"}...`);
    try {
      const r = await fetch(`/api/intakes/${i.id}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKeys: questionsToSend.map((question) => question.key) }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNote(body.error || "The client follow-up could not be created.");
        return;
      }
      setFollowUpResult(body as FollowUpDeliveryResult);
      setNote(`Private follow-up created. ${deliveryStatus(body, "Use the manual SMS or email buttons to send the link.")}`);
      void load();
    } catch {
      setNote("The client follow-up could not connect. Check your connection and try again.");
    } finally {
      setFollowUpBusy(false);
    }
  }

  async function refreshClientFollowUp() {
    setFollowUpRefreshBusy(true);
    setNote("Refreshing the chart for new client answers...");
    const refreshed = await load();
    const refreshedFollowUp = refreshed?.intake.followUps?.[0];
    if (refreshedFollowUp?.status === "COMPLETED") {
      const saved = refreshedFollowUp.savedCount;
      const deferred = refreshedFollowUp.skippedKeys.length;
      setNote(
        saved
          ? `Chart refreshed. ${saved} client answer${saved === 1 ? " is" : "s are"} now in the intake${deferred ? `; ${deferred} item${deferred === 1 ? " needs" : "s need"} staff follow-up.` : "."}`
          : deferred
            ? `Chart refreshed. The client deferred ${deferred} item${deferred === 1 ? "" : "s"} for staff to confirm.`
            : "Chart refreshed. The latest client follow-up is complete.",
      );
    } else if (refreshedFollowUp?.status === "PROCESSING") {
      setNote("The client response is still being saved. Refresh again in a moment.");
    } else if (refreshedFollowUp?.status === "OPEN") {
      setNote("Chart refreshed. The client follow-up is still open.");
    } else if (refreshed) {
      setNote("Chart refreshed. No active client follow-up was found.");
    }
    setFollowUpRefreshBusy(false);
  }

  async function renewClientLink() {
    setClientLinkBusy(true);
    setNote("Renewing the secure client link...");
    try {
      const r = await fetch(`/api/intakes/${i.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extendToken: true }),
      });
      const b = await r.json().catch(() => ({}));
      setNote(r.ok
        ? "Secure link renewed. The manual SMS, email, and copy options are ready."
        : b.error || "The secure link could not be renewed.");
      if (r.ok) load();
    } catch {
      setNote("The secure link could not be renewed. Check your connection and try again.");
    } finally {
      setClientLinkBusy(false);
    }
  }

  async function sendSignatureReminder() {
    setSignatureReminderBusy(true);
    setNote("Checking the client signature and sending a secure reminder...");
    try {
      const r = await fetch(`/api/intakes/${i.id}/signature-reminder`, { method: "POST" });
      const b = await r.json().catch(() => ({}));
      if (b.alreadySigned) {
        setNote(b.message || "The client or guardian signature is already saved.");
      } else if (r.ok) {
        setNote(`${b.renewed ? "Expired link renewed. " : ""}${deliveryStatus(b, "The signature reminder was accepted.")} The client can reopen the same link, review saved answers, and sign at the end.`);
      } else {
        setNote(b.error || deliveryStatus(b, "Signature reminder could not be sent. Check the client's phone or email, then try again."));
      }
      load();
    } catch {
      setNote("Signature reminder could not connect. Please try again.");
    } finally {
      setSignatureReminderBusy(false);
    }
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
      const review = body.ccaReview as CcaReview | undefined;
      const medicationCount = (review?.prescriptionMedications.length || 0) + (review?.otcMedications.length || 0);
      const majorErrors = review?.majorErrors.length || 0;
      setCcaResult(`CCA re-scan complete. AI found ${Number(body.extracted || 0)} field${Number(body.extracted || 0) === 1 ? "" : "s"} and updated ${Number(body.filled || 0)} answer${Number(body.filled || 0) === 1 ? "" : "s"}. Medication review captured ${medicationCount} medication${medicationCount === 1 ? "" : "s"}; ${majorErrors} major CCA issue${majorErrors === 1 ? "" : "s"} need attention. Review the separate CCA accuracy section before generating the packet.`);
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
    setQuickFixChoice({});
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
        findings: preflight.findings.map((item) => item.key === finding.key
          ? { ...item, overridden: true, resolved: "overridden" as const, pendingRecheck: false }
          : item),
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
    const option = finding.correctionOptions?.find((item) => item.id === quickFixChoice[finding.key]);
    if (!option) {
      setNote("Choose a suggested correction before applying it.");
      return;
    }
    setQuickFixBusyKey(finding.key);
    try {
      const r = await fetch(`/api/intakes/${i.id}/preflight/correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          findingKey: finding.key,
          title: finding.title,
          optionId: option.id,
          optionLabel: option.label,
          updates: option.updates.map((update) => ({
            key: update.key,
            sourceKey: update.sourceKey,
            expectedCurrent: update.expectedCurrent,
            proposedValue: update.proposedValue,
          })),
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setNote(body.error || "The correction could not be saved.");
        return;
      }
      const next = preflight ? {
        ...preflight,
        findings: preflight.findings.map((item) => item.key === finding.key
          ? { ...item, pendingRecheck: true, resolved: "corrected" as const }
          : item),
      } : null;
      setPreflight(next);
      if (next) sessionStorage.setItem(`smart-intake:preflight:${params.id}`, JSON.stringify(next));
      setQuickFixChoice((current) => ({ ...current, [finding.key]: "" }));
      setNote(`Correction applied: ${option.label}. Rerun preflight after reviewing the remaining items.`);
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
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{i.client.fullName}</h1>
          <p className="text-sm text-slate-500">
            DOB {i.client.dob} - MID# {i.client.midNumber || "-"} - Chart{" "}
            {({ NOT_STARTED: "Not started", IN_PROGRESS: "In progress", SUBMITTED: "Submitted",
              NEEDS_REVIEW: "Needs review", SIGNED: "Client signed", COMPLETED: "Completed" } as Record<string, string>)[i.status] || i.status}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/intakes/${i.id}/review`} className="btn-primary">Review / edit answers</Link>
          <Link href={`/intakes/${i.id}/plans`} className="btn-secondary">PCP / Crisis Plan</Link>
          {packetReady ? (
            <>
              <Link href={`/intakes/${i.id}/pdf-preview`} className="btn-secondary">Preview PDF</Link>
              <button className="btn-secondary" disabled={!generationReady} title={generationReady ? "Generate a locked packet version" : firstGenerationBlocker}
                onClick={() => act("Generate Completed Packet", () => fetch(`/api/intakes/${i.id}/generate`, { method: "POST" }))}>
                Generate Completed Packet
              </button>
              {finalPacketCurrent ? (
                <a className="btn-ghost" href={`/api/intakes/${i.id}/pdf`} target="_blank">Download final PDF</a>
              ) : (
                <button className="btn-ghost" disabled title="Generate a current locked packet version before downloading the final PDF">Download final PDF</button>
              )}
            </>
          ) : (
            <button className="btn-secondary" disabled title="Master admin must approve and activate this provider's packet first">
              PDF setup required
            </button>
          )}
        </div>
      </div>
      <section
        className={`mt-4 rounded-xl border p-4 ${
          caseStatus.tone === "good" ? "border-emerald-300 bg-emerald-50 text-emerald-950" :
          caseStatus.tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-950" :
          "border-brand/30 bg-brand-light/40 text-slate-900"
        }`}
        aria-labelledby="case-status-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="case-status-heading" className="text-lg font-bold">{caseStatus.headline}</h2>
            <p className="mt-1 text-sm">{caseStatus.detail}</p>
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap gap-2">
            {caseStatus.sendCopiesAllowed ? (
              <button className="btn-primary px-3 py-2 text-sm" disabled={copiesBusy} onClick={() => { void sendCopiesLink(); }}>
                {copiesBusy ? "Sending client copies..." : "Send client copies"}
              </button>
            ) : (
              <button
                className="btn-ghost px-3 py-2 text-sm"
                disabled
                title={caseStatus.detail}
              >
                Send client copies blocked
              </button>
            )}
            <button
              className="btn-ghost px-3 py-2 text-sm"
              disabled={!signatureDeliveryReady}
              title={signatureDeliveryReady ? "Send missing signature fields through DocuSign" : signatureDeliveryBlockers[0]?.message || caseStatus.detail}
              onClick={() => {
                if (!window.confirm("Send the missing signature fields through DocuSign? Missing staff fields will be routed to your signed-in staff account.")) return;
                void act("DocuSign", () => fetch(`/api/intakes/${i.id}/docusign`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ allowStaffSigner: true }),
                }));
              }}
            >
              Send missing signatures
            </button>
            <button className="btn-ghost shrink-0 whitespace-nowrap px-3 py-2 text-sm" onClick={() => { void setProviderPacketEmail(!providerPacketEmailEnabled); }}>
              Email completed PDF to provider: {providerPacketEmailEnabled ? "On" : "Off"}
            </button>
            {packetReady && i.generatedPdfs.length > 0 && i.status === "COMPLETED" && (
              <button className="btn-ghost px-3 py-2 text-sm" onClick={() => { void sendProviderPacketNow(); }}>
                Email provider now
              </button>
            )}
            {i.docusignEnvelopeId && (
              <button className="btn-ghost px-3 py-2 text-sm" onClick={async () => {
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
      </section>
      <WorkflowSteps steps={caseStatus.steps} />
      <PacketChecklistChips
        chips={packetChecklist}
        pcp={d.planCompleteness?.pcp}
        crisis={d.planCompleteness?.crisis}
      />
      <SignatureSlotsRow statuses={d.signatureStatuses} reviewHref={`/intakes/${i.id}/review#staff-signatures`} />
      {(d.accuracyConflicts?.length || 0) > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
          <p className="text-sm font-semibold">Cross-section conflicts</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {d.accuracyConflicts!.slice(0, 6).map((conflict) => (
              <li key={conflict.key}><b>{conflict.title}:</b> {conflict.detail}</li>
            ))}
          </ul>
        </div>
      )}
      {note && (
        <p className="mt-3 rounded-lg bg-brand-light p-2 text-sm font-semibold text-brand" role="status" aria-live="polite">
          {note}
        </p>
      )}
      {copiesLink && (
        <div className="mt-3 rounded-lg border border-brand/30 bg-white p-3 text-sm">
          <p className="font-semibold text-brand">Secure client copies</p>
          <p className="mt-1 break-all font-mono text-xs">{copiesLink}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn-ghost px-3 py-1.5 text-xs" onClick={async () => { await navigator.clipboard.writeText(copiesLink); setNote("Client-copies link copied"); }}>
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
          <p className="mt-2 text-sm">Correct the client record or packet answer so the verified identity matches. Identity mismatches cannot be overridden.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/intakes/${i.id}/review?focus=client_full_name`} className="btn-secondary px-3 py-2 text-sm">Review / correct name</Link>
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
        <div className={`card ${ccaNeeded ? "order-3" : "order-1"} ${linkExpired && !linkFinished ? "border-amber-300 bg-amber-50/40" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">Secure client link</h3>
            <span className={`badge ${
              linkFinished
                ? "bg-emerald-100 text-emerald-800"
                : linkExpired
                  ? "bg-amber-100 text-amber-900"
                  : openedCurrentDelivery
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-blue-100 text-blue-800"
            }`}>
              {linkFinished ? "Intake signed" : linkExpired ? "Expired" : openedCurrentDelivery ? "Client opened" : "Active"}
            </span>
          </div>

          <div className="mt-3 break-all rounded bg-slate-100 p-2 font-mono text-xs">{d.clientLink}</div>
          <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <p><span className="font-semibold text-slate-800">Expires:</span> {new Date(i.tokenExpiresAt).toLocaleString()}</p>
            <p className="min-w-0 break-words"><span className="font-semibold text-slate-800">Recipients:</span> {contactSummary || "No phone or email saved"}</p>
            <p><span className="font-semibold text-slate-800">Last delivery accepted:</span> {i.linkSentAt ? new Date(i.linkSentAt).toLocaleString() : "Not sent yet"}</p>
            <p><span className="font-semibold text-slate-800">Client activity:</span> {lastLinkOpened ? `Opened ${new Date(lastLinkOpened.createdAt).toLocaleString()}` : "Not opened yet"}</p>
            {lastLinkReminder && (
              <p className="sm:col-span-2">
                <span className="font-semibold text-slate-800">Accepted reminder history:</span> {reminderCount} recent reminder{reminderCount === 1 ? "" : "s"}; latest {new Date(lastLinkReminder.createdAt).toLocaleString()}
              </p>
            )}
          </div>

          {linkExpired && !linkFinished && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              Manual SMS, email, and copy are paused so an expired link is not sent. Renew it first, or use Renew &amp; send to update the link and contact the client in one step.
            </p>
          )}
          {linkFinished && (
            <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
              The client or guardian has signed. Intake reminders are closed; use the client-copies delivery after staff review is complete.
            </p>
          )}
          {!hasClientContact && !linkFinished && (
            <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              Add a client or guardian phone number or email before using automatic delivery.
            </p>
          )}

          {!linkFinished && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="btn-primary px-3 py-2 text-sm"
                disabled={clientLinkBusy || signatureReminderBusy || !hasClientContact}
                onClick={() => { void sendIntakeLink(); }}
              >
                {clientLinkBusy ? "Working..." : linkExpired ? "Renew & send link" : "Send link to saved contacts"}
              </button>
              <button
                className="btn-ghost px-3 py-2 text-sm"
                disabled={clientLinkBusy || signatureReminderBusy}
                onClick={() => { void renewClientLink(); }}
              >
                {linkExpired ? "Renew link for 7 days" : "Extend link 7 days"}
              </button>
              <button
                className="btn-ghost px-3 py-2 text-sm"
                disabled={signatureReminderBusy || clientLinkBusy || hasClientSignature || !hasClientContact}
                onClick={sendSignatureReminder}
              >
                {hasClientSignature ? "Client signature saved" : signatureReminderBusy ? "Sending signature reminder..." : "Send signature-only reminder"}
              </button>
            </div>
          )}

          {!linkFinished && (
            <details
              className="mt-3 border-t border-slate-200 pt-3 [&>summary::-webkit-details-marker]:hidden"
              open={manualSendingOpen}
              onToggle={(event) => setManualSendingOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer text-sm font-semibold text-brand">Manual sending &amp; message preview</summary>
              <div className="mt-3">
                <ManualSendPanel
                  intakeId={i.id}
                  clientLink={d.clientLink}
                  message={clientMessage}
                  phone={deliveryContacts.phone?.value || ""}
                  email={deliveryContacts.email?.value || ""}
                  smsHref={deliveryContacts.phone ? intakeSmsHref(deliveryContacts.phone.value, d.clientLink, providerName, providerPhone) : undefined}
                  mailtoHref={deliveryContacts.email ? intakeMailtoHref(deliveryContacts.email.value, d.clientLink, providerName, providerPhone) : undefined}
                  reason={smsFallbackNeeded ? "Automatic SMS was not accepted. The secure link is still active." : undefined}
                  linkSentAt={i.linkSentAt || null}
                  disabled={linkExpired}
                  onMarked={() => { setNote("Recorded: the client got the link by hand."); void load(); }}
                />
              </div>
            </details>
          )}
        </div>
        <div className={`card border-brand/40 bg-brand-light/40 ${ccaNeeded ? "order-1" : "order-2"}`}>
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
          {hasCca && (
            <CcaAccuracyPanel
              review={ccaReview}
              onCopy={async () => {
                if (!ccaReview) return;
                await navigator.clipboard.writeText(formatCcaFollowUp(ccaReview));
                setNote("CCA creator follow-up note copied.");
              }}
            />
          )}
        </div>
        <div className={`card md:col-span-2 border-sky-200 bg-sky-50/50 ${ccaNeeded ? "order-2" : "order-3"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-3xl">
              <h3 className="font-bold text-sky-950">Ask client for missing answers</h3>
              <p className="mt-1 text-sm text-slate-600">
                Send a separate private link containing only unanswered client questions. It does not reopen the signed
                intake and cannot change consent, signatures, or staff-only clinical fields.
              </p>
              <p className="mt-2 text-xs font-semibold text-sky-900">
                {followUpRecipientSummary
                  ? `Automatic recipient: ${followUpDeliveryContacts.role} by ${followUpRecipientSummary}.`
                  : `No saved ${followUpDeliveryContacts.role} contact. The link will still be available to copy and send manually.`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!!followUpQuestions.length
                && !followUpInProgress
                && i.status !== "COMPLETED"
                && originalClientIntakeFinished
                && !i.docusignEnvelopeId && (
                <button
                  className="btn-primary px-4 py-2 text-sm disabled:cursor-wait disabled:opacity-60"
                  type="button"
                  disabled={followUpBusy || followUpRefreshBusy}
                  onClick={() => { void sendClientFollowUp(); }}
                >
                  {followUpBusy
                    ? "Creating secure link..."
                    : `Send ${followUpQuestions.length} missing answer${followUpQuestions.length === 1 ? "" : "s"}`}
                </button>
              )}
              {latestFollowUp && (
                <button
                  className="btn-ghost px-4 py-2 text-sm disabled:cursor-wait disabled:opacity-60"
                  type="button"
                  disabled={followUpBusy || followUpRefreshBusy}
                  onClick={() => { void refreshClientFollowUp(); }}
                >
                  {followUpRefreshBusy ? "Refreshing..." : "Refresh client answers"}
                </button>
              )}
              {!!(followUpQuestions.length || deferredFollowUpQuestions.length) && (
                <button
                  className="btn-ghost px-4 py-2 text-sm"
                  type="button"
                  disabled={preflightBusy}
                  onClick={() => {
                    void runPreflight();
                    window.setTimeout(() => document.getElementById("preflight-review")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    }), 80);
                  }}
                >
                  Review / override blanks
                </button>
              )}
            </div>
          </div>

          {!!followUpQuestions.length && !originalClientIntakeFinished && (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              Finish and sign the original client intake first. Then this button can send only the remaining safe questions.
            </p>
          )}
          {!!followUpQuestions.length && !!i.docusignEnvelopeId && (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              This chart already has a DocuSign envelope. Make corrections in staff review, then create a new envelope so the signed packet stays accurate.
            </p>
          )}

          {!!followUpQuestions.length ? (
            <div className="mt-4 rounded-lg border border-sky-200 bg-white p-3">
              <p className="text-sm font-semibold text-slate-800">Questions ready for the client:</p>
              <ul className="mt-2 grid gap-1 text-sm text-slate-700 sm:grid-cols-2">
                {followUpQuestions.slice(0, 12).map((question) => (
                  <li key={question.key}>- {question.label}</li>
                ))}
              </ul>
              {followUpQuestions.length > 12 && (
                <p className="mt-2 text-xs text-slate-500">Plus {followUpQuestions.length - 12} more client-safe question{followUpQuestions.length - 12 === 1 ? "" : "s"}.</p>
              )}
            </div>
          ) : (
            <p className={`mt-4 rounded-lg p-3 text-sm font-semibold ${
              deferredFollowUpQuestions.length
                ? "bg-amber-50 text-amber-900"
                : "bg-emerald-50 text-emerald-800"
            }`}>
              {deferredFollowUpQuestions.length
                ? "No new client questions remain. The items below were deferred to staff."
                : "No unanswered client-safe questions remain. Any other checklist items must be confirmed by staff."}
            </p>
          )}

          {!!deferredFollowUpQuestions.length && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
              <p className="font-bold">Staff must confirm</p>
              <p className="mt-1 text-sm">
                The client selected “I don&apos;t know” for these items. They will not be placed into another SMS automatically.
              </p>
              <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                {deferredFollowUpQuestions.map((question) => (
                  <li key={question.key}>- {question.label}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  className="btn-ghost bg-white px-3 py-2 text-sm"
                  href={`/intakes/${i.id}/review?focus=${encodeURIComponent(deferredFollowUpQuestions[0].key)}&return=preflight`}
                >
                  Review / edit deferred items
                </Link>
                {!followUpInProgress
                  && i.status !== "COMPLETED"
                  && originalClientIntakeFinished
                  && !i.docusignEnvelopeId && (
                  <button
                    className="btn-ghost bg-white px-3 py-2 text-sm disabled:cursor-wait disabled:opacity-60"
                    type="button"
                    disabled={followUpBusy || followUpRefreshBusy}
                    onClick={() => { void sendClientFollowUp(deferredFollowUpQuestions); }}
                  >
                    Ask client again
                  </button>
                )}
              </div>
            </div>
          )}

          {latestFollowUp && !followUpResult && (
            <p className={`mt-3 rounded-lg p-3 text-sm font-semibold ${
              latestFollowUp.status === "COMPLETED"
                ? "bg-emerald-100 text-emerald-900"
                : activeFollowUp
                  ? "bg-blue-100 text-blue-900"
                  : "bg-slate-100 text-slate-700"
            }`}>
              {latestFollowUp.status === "COMPLETED"
                ? `Latest client follow-up completed ${latestFollowUp.completedAt ? new Date(latestFollowUp.completedAt).toLocaleString() : ""}.` +
                  `${latestFollowUp.attestedAt && latestFollowUp.savedCount
                    ? ` Client confirmed ${latestFollowUp.savedCount} answer${latestFollowUp.savedCount === 1 ? "" : "s"}.`
                    : latestFollowUp.attestedAt && latestFollowUp.skippedKeys.length
                      ? " Client responded and asked staff to confirm the items."
                      : ""}` +
                  `${latestFollowUp.skippedKeys.length ? ` ${latestFollowUp.skippedKeys.length} item${latestFollowUp.skippedKeys.length === 1 ? " was" : "s were"} left for staff to confirm.` : ""}`
                : activeFollowUp
                  ? `A private follow-up is active for ${latestFollowUpQuestions.length} question${latestFollowUpQuestions.length === 1 ? "" : "s"}. It expires ${new Date(latestFollowUp.tokenExpiresAt).toLocaleString()}.`
                  : processingFollowUp
                    ? "The client submitted the follow-up and the answers are being saved. Refresh in a moment."
                  : latestFollowUpExpired
                    ? "The latest follow-up link expired. Create a new one for any questions still missing."
                    : "The latest follow-up link was replaced by a newer request."}
            </p>
          )}

          {followUpResult && (
            <div className={`mt-3 rounded-lg border p-3 text-sm ${
              followUpResult.deliveryState === "sent"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`} role="status">
              <p className="font-bold">
                {followUpResult.deliveryState === "sent"
                  ? `Delivery accepted or queued for the ${followUpResult.recipientRole}`
                  : followUpResult.deliveryState === "partial"
                    ? `Some delivery channels were accepted for the ${followUpResult.recipientRole}`
                    : "Follow-up link created; automatic delivery was not accepted"}
              </p>
              {!!followUpResult.sent?.length && <p className="mt-1">{followUpResult.sent.join("; ")}</p>}
              {!!followUpResult.failed?.length && <p className="mt-1">{followUpResult.failed.join("; ")}</p>}
            </div>
          )}

          {followUpLink && (
            <details
              className="mt-3 border-t border-sky-200 pt-3 [&>summary::-webkit-details-marker]:hidden"
              open={!!followUpResult?.failed.length}
            >
              <summary className="cursor-pointer text-sm font-semibold text-brand">Follow-up link and manual sending</summary>
              <p className="mt-2 break-all rounded-lg bg-white p-3 font-mono text-xs text-slate-700">{followUpLink}</p>
              {!!followUpFields.length && (
                <p className="mt-2 text-xs text-slate-600">
                  Includes: {followUpFields.map((field) => field.label).join(", ")}.
                </p>
              )}
              <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-slate-700">{followUpMessage}</p>
              <p className="mt-2 text-xs text-slate-500">The message contains no client name, diagnosis, or answer details.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="btn-ghost px-3 py-2 text-sm"
                  type="button"
                  onClick={async () => { await navigator.clipboard.writeText(followUpLink); setNote("Follow-up link copied."); }}
                >
                  Copy follow-up link
                </button>
                <button
                  className="btn-ghost px-3 py-2 text-sm"
                  type="button"
                  onClick={async () => { await navigator.clipboard.writeText(followUpMessage); setNote("Follow-up SMS message copied."); }}
                >
                  Copy SMS message
                </button>
                {followUpDeliveryContacts.phone && (
                  <a className="btn-ghost px-3 py-2 text-sm" href={followUpSmsHref(followUpDeliveryContacts.phone.value, followUpLink, providerName, providerPhone)}>
                    Open SMS on this computer
                  </a>
                )}
                {followUpDeliveryContacts.email && (
                  <a className="btn-ghost px-3 py-2 text-sm" href={followUpMailtoHref(followUpDeliveryContacts.email.value, followUpLink, providerName, providerPhone)}>
                    Open email
                  </a>
                )}
              </div>
            </details>
          )}

          <p className="mt-3 text-xs text-slate-600">
            If a blank is intentional, run the preflight review below and use <b>Override and continue</b>. The reason is recorded in the audit log.
          </p>
        </div>
        <div id="preflight-review" className={`card md:col-span-2 order-4 ${preflightIsClear ? "border-emerald-500 bg-emerald-100" : "border-emerald-200 bg-emerald-50/40"}`}>
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
                  <button className="btn-primary mt-3 px-3 py-1.5 text-sm" type="button" disabled={!generationReady} title={generationReady ? "Generate a locked packet version" : firstGenerationBlocker}
                    onClick={() => act("Generate Completed Packet", () => fetch(`/api/intakes/${i.id}/generate`, { method: "POST" }))}>
                    Continue to generate packet
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-300 bg-amber-100 p-3 text-amber-900">
                  <p className="font-bold">{preflightBlockingCount} item{preflightBlockingCount === 1 ? " needs" : "s need"} attention before the packet is ready.</p>
                  {preflightCorrectedCount > 0 && <p className="mt-1 text-sm font-semibold text-emerald-900">{preflightCorrectedCount} item{preflightCorrectedCount === 1 ? " is" : "s are"} corrected and removed from the attention count. Rerun the review to verify the saved changes.</p>}
                  <p className="mt-1 text-sm">{preflight.message}</p>
                </div>
              )}
              {preflight.findings.map((finding, index) => (
                <div key={`${finding.key}-${index}`} className={`rounded-lg border p-3 text-sm ${
                  finding.resolved === "overridden" || finding.overridden ? "border-lime-300 bg-lime-50 text-lime-950" :
                  finding.resolved === "corrected" ? "border-emerald-500 bg-emerald-100 text-emerald-950" :
                  finding.pendingRecheck ? "border-sky-200 bg-sky-50 text-sky-900" :
                  finding.severity === "error" ? "border-red-200 bg-red-50 text-red-800" :
                  finding.severity === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" :
                  "border-slate-200 bg-white text-slate-700"
                }`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <b>{finding.title}</b>
                    <span className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
                      {finding.resolved === "overridden" || finding.overridden ? "Override recorded" : finding.resolved === "corrected" ? "Corrected - rerun to verify" : finding.pendingRecheck ? "Saved - rerun to verify" : finding.source === "ai" ? "AI suggestion" : "Automatic check"}
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
                    {!finding.overridden && !finding.resolved && finding.severity !== "info" && (
                      <button className="font-semibold underline disabled:opacity-50" type="button"
                        disabled={overrideBusyKey === finding.key} onClick={() => { void overridePreflight(finding); }}>
                        {overrideBusyKey === finding.key ? "Recording..." : "Override and continue"}
                      </button>
                    )}
                  </div>
                  {!!finding.correctionOptions?.length && !finding.overridden && !finding.resolved && (
                    <div className="mt-3 border-t border-current/15 pt-3">
                      <label className="block text-xs font-bold uppercase tracking-wide" htmlFor={`preflight-correction-${index}`}>
                        Choose a suggested correction
                      </label>
                      <select
                        id={`preflight-correction-${index}`}
                        className="input mt-1 max-w-2xl py-2 text-sm"
                        value={quickFixChoice[finding.key] || ""}
                        onChange={(event) => setQuickFixChoice((current) => ({ ...current, [finding.key]: event.target.value }))}
                      >
                        <option value="">Choose a correction option</option>
                        {finding.correctionOptions.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                      {(() => {
                        const option = finding.correctionOptions?.find((item) => item.id === quickFixChoice[finding.key]);
                        if (!option) return null;
                        return (
                          <div className="mt-3">
                            <p className="text-sm font-semibold">{option.detail}</p>
                            <ul className="mt-2 space-y-1 text-xs">
                              {option.updates.map((update) => (
                                <li key={update.key}>
                                  <span className="font-bold">{update.fieldLabel}:</span>{" "}
                                  <span>{update.expectedCurrent || "Blank"}</span>{" → "}
                                  <span className="font-semibold">{update.proposedValue || "Clear this field"}</span>
                                </li>
                              ))}
                            </ul>
                            <button
                              className="btn-secondary mt-3 px-3 py-2 text-sm disabled:opacity-50"
                              type="button"
                              disabled={quickFixBusyKey === finding.key}
                              onClick={() => { void applyQuickFix(finding); }}
                            >
                              {quickFixBusyKey === finding.key ? "Applying..." : "Apply selected correction"}
                            </button>
                            <p className="mt-2 text-xs opacity-80">
                              This correction only reuses values already recorded in the intake or client record. Staff must confirm it before applying.
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  {!finding.correctionOptions?.length && !finding.overridden && !finding.resolved && finding.severity !== "info" && (
                    <p className="mt-3 border-t border-current/15 pt-3 text-xs font-semibold opacity-80">
                      No safe automatic correction is available because this item needs a confirmed answer. Use the linked field above to enter it.
                    </p>
                  )}
                </div>
              ))}
              <p className="text-xs text-slate-500">The checklist stays open while you correct several items. Run preflight again when you are ready to verify the saved changes.</p>
            </div>
          )}
        </div>
        <div className="card md:col-span-2 order-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">NC Tracks / staff helper info</h3>
              <p className="mt-1 text-sm text-slate-500">
                Use the dropdowns for common answers or paste one answer per line below.
                Saving a client answer here fills the packet and removes that question
                from the client&apos;s SMS intake. Consent and signature questions stay with the client.
              </p>
              {originalClientIntakeFinished && (
                <p className="mt-2 text-sm text-slate-600">
                  On a signed case, keep Quick notes and Common answers with{" "}
                  <Link href={`/intakes/${i.id}/review`} className="font-semibold text-brand underline">Review / edit answers</Link>
                  {" "}instead of a second form here.
                </p>
              )}
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
            <details open={!originalClientIntakeFinished} className="rounded-xl border border-brand/30 bg-brand-light/30 p-3">
              <summary className="cursor-pointer list-none">
                <span className="font-semibold text-brand">Quick Notes: paste confirmed answers</span>
                <span className="ml-2 text-xs text-slate-600">Race, veteran status, insurance, PCP, emergency contact, and more</span>
              </summary>
              <p className="mt-2 text-xs text-slate-600">Use one confirmed answer per line. Saving applies the answers to the intake packet and lets the client skip those questions in SMS. Consent and signature questions stay with the client.</p>
              <textarea name="helperNotes" className="input mt-3 min-h-[130px] w-full"
                defaultValue={String(d.answers.staff_helper_notes ?? "")}
                placeholder={"Race: Black or African American\nVeteran: No\nEthnicity: Non-Hispanic/Black\nEmployment status: Unemployed\nInsurance type: Alliance\nPCP: Guilford County Pediatrics\nPCP phone: 336-555-0100\nEmergency contact: Jane Smith\nEmergency phone: 336-555-0101\nTransport: Services / treatment plan activities"} />
            </details>

            <HelperGroup title="Common client answers" description="Start here to shorten the SMS questions." defaultOpen={!originalClientIntakeFinished}>
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
                  <p className="mt-2 text-xs text-amber-800">These four plans assign their own record numbers. Sign in to the plan&apos;s provider portal, find the member, then type that Record# above.</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {RECORD_NUMBER_LOOKUP_LINKS.map((link) => (
                      <a key={link.key} className="btn-ghost px-2 py-1 text-xs" href={link.url} target="_blank" rel="noreferrer" title={link.description}>
                        Open {link.label} portal
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
        <div className="order-4">
        <MissingFieldsPanel required={d.missingRequired} optional={d.missingOptional} />
        </div>
        <div className="card order-4">
          <h3 className="mb-2 font-bold">Uploaded documents</h3>
          {i.uploadedDocuments.length === 0 && <p className="text-sm text-slate-400">None uploaded.</p>}
          <ul className="space-y-1 text-sm">{i.uploadedDocuments.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2">
              <span>{u.docType.replace(/_/g, " ")}: {u.fileName}</span>
              <a className="btn-ghost px-2 py-0.5 text-xs" href={`/api/intakes/${i.id}/documents/${u.id}`}>Open</a>
            </li>
          ))}</ul>
        </div>
        <div className="card md:col-span-2 order-4">
          <h3 className="mb-2 font-bold">Audit log</h3>
          <ul className="max-h-56 space-y-1 overflow-y-auto text-xs text-slate-600">
            {i.auditLogs.map((a) => (
              <li key={a.id}><span className="text-slate-400">{new Date(a.createdAt).toLocaleString()}</span> - <b>{a.event}</b> {a.detail}</li>
            ))}
          </ul>
        </div>
      </div>
      <MoodPanel answers={d.answers} />
      <CoveragePanel intakeId={i.id} />
    </main>
  );
}

function formatCcaFollowUp(review: CcaReview): string {
  const lines = [
    "CCA creator follow-up requested",
    review.sourceClinician ? `Assessment clinician: ${review.sourceClinician}` : "Assessment clinician: not identified",
    review.assessmentDate ? `Assessment date: ${review.assessmentDate}` : "Assessment date: not identified",
    "",
    "Please review and correct these CCA items:",
    ...review.majorErrors.map((item) => `- MAJOR: ${item}`),
    ...review.warnings.map((item) => `- Clarification: ${item}`),
  ];
  return lines.join("\n");
}

function CcaAccuracyPanel({ review, onCopy }: { review: CcaReview | null; onCopy: () => void }) {
  if (!review) {
    return (
      <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <p className="font-bold">CCA accuracy review is not available yet</p>
        <p className="mt-1">Upload or re-scan the CCA to create the medication and documentation accuracy review.</p>
      </div>
    );
  }
  const medicationCount = review.prescriptionMedications.length + review.otcMedications.length;
  const clear = review.majorErrors.length === 0 && review.warnings.length === 0;
  return (
    <div className={`mt-4 rounded-xl border p-3 text-sm ${
      review.majorErrors.length ? "border-red-300 bg-red-50 text-red-950" :
      review.warnings.length ? "border-amber-300 bg-amber-50 text-amber-950" :
      "border-emerald-500 bg-emerald-100 text-emerald-950"
    }`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-bold">CCA accuracy review</p>
          <p className="mt-1 text-xs opacity-80">Separate from the intake preflight. AI suggests only; staff must confirm the CCA before using it.</p>
        </div>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={onCopy}>
          Copy creator follow-up note
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div><b>Clinician:</b> {review.sourceClinician || "Not identified"}</div>
        <div><b>Assessment date:</b> {review.assessmentDate || "Not identified"}</div>
        <div><b>Medications captured:</b> {medicationCount}</div>
      </div>
      {clear ? (
        <p className="mt-3 font-semibold text-emerald-950">No major CCA accuracy issues were identified. Confirm the medication list and source document manually.</p>
      ) : (
        <>
          {review.majorErrors.length > 0 && (
            <div className="mt-3 rounded-lg border border-red-300 bg-red-100 p-2">
              <p className="font-bold">Major issues to send back to the CCA creator</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">{review.majorErrors.map((item, index) => <li key={`major-${index}`}>{item}</li>)}</ul>
            </div>
          )}
          {review.warnings.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-100 p-2">
              <p className="font-bold">Clarifications to review</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">{review.warnings.map((item, index) => <li key={`warning-${index}`}>{item}</li>)}</ul>
            </div>
          )}
        </>
      )}
      {medicationCount > 0 && (
        <details className="mt-3 rounded-lg border border-current/20 bg-white/60 p-2">
          <summary className="cursor-pointer font-semibold">Show captured medication list</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="font-semibold">Prescription</p>
              {review.prescriptionMedications.length
                ? <ul className="mt-1 list-disc space-y-1 pl-5">{review.prescriptionMedications.map((item, index) => <li key={`rx-${index}`}>{item}</li>)}</ul>
                : <p className="mt-1 text-xs opacity-70">None identified.</p>}
            </div>
            <div>
              <p className="font-semibold">Over the counter</p>
              {review.otcMedications.length
                ? <ul className="mt-1 list-disc space-y-1 pl-5">{review.otcMedications.map((item, index) => <li key={`otc-${index}`}>{item}</li>)}</ul>
                : <p className="mt-1 text-xs opacity-70">None identified.</p>}
            </div>
          </div>
        </details>
      )}
    </div>
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
function WorkflowSteps({ steps }: { steps: CaseWorkflowStep[] }) {
  const visible = steps.filter((step) => !step.skipped);
  const current = visible.findIndex((step) => !step.done);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-2 text-xs">
      {visible.map((step, idx) => (
        <span key={step.key}
          className={`flex items-center gap-1 rounded-full px-2 py-1 font-semibold ${
            step.done ? "bg-emerald-100 text-emerald-700"
            : idx === current ? "bg-brand text-white"
            : "bg-slate-100 text-slate-400"}`}>
          <span>{step.done ? "✓" : idx + 1}</span> {step.label}
          {idx === current && <span className="font-normal">← next</span>}
        </span>
      ))}
    </div>
  );
}

function PacketChecklistChips({
  chips,
  pcp,
  crisis,
}: {
  chips: ReturnType<typeof buildPacketChecklistChips>;
  pcp?: { completed: number; total: number };
  crisis?: { completed: number; total: number };
}) {
  const tone = (state: string) => (
    state === "keep" ? "bg-emerald-100 text-emerald-800" :
    state === "na" ? "bg-slate-100 text-slate-600" :
    "bg-amber-100 text-amber-900"
  );
  const mark = (state: string) => (
    state === "keep" ? "Keep" : state === "na" ? "N/A" : "Missing"
  );
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Packet checklist</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span key={chip.key} className={`badge ${tone(chip.state)}`}>
            {chip.label}: {mark(chip.state)}
          </span>
        ))}
        {pcp && <span className="badge bg-white text-slate-700 ring-1 ring-slate-200">PCP plan: {pcp.completed}/{pcp.total}</span>}
        {crisis && <span className="badge bg-white text-slate-700 ring-1 ring-slate-200">Crisis plan: {crisis.completed}/{crisis.total}</span>}
      </div>
    </div>
  );
}

function SignatureSlotsRow({
  statuses,
  reviewHref,
}: {
  statuses: Detail["signatureStatuses"];
  reviewHref: string;
}) {
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Signatures</p>
        <Link href={reviewHref} className="btn-ghost px-3 py-1.5 text-xs">Add / rerun signatures</Link>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {statuses.map((status) => {
          const captured = status.state === "captured";
          const na = !captured && status.onPacket === false;
          const blocked = !captured && status.required;
          return (
            <div
              key={status.key}
              className={`rounded-lg px-3 py-2 text-xs ${
                captured ? "bg-emerald-50 text-emerald-800" :
                na ? "bg-slate-50 text-slate-600" :
                blocked ? "bg-red-50 text-red-700" :
                "bg-amber-50 text-amber-800"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <b>{status.label}</b>
                <span className="font-semibold">
                  {captured ? "Captured" : na ? "N/A" : status.state === "invalid" ? "Re-sign" : "Missing"}
                </span>
              </div>
              <p className="mt-1">
                {captured
                  ? (status.signedDate ? `On ${status.signedDate}` : "Date not recorded")
                  : na
                    ? "Not on this packet"
                    : status.reason}
              </p>
            </div>
          );
        })}
      </div>
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
