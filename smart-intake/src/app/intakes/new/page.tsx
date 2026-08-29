"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { intakeMailtoHref, intakeShareMessage, intakeSmsHref } from "@/lib/shareLinks";
import { clientDeliveryContacts } from "@/lib/clientDeliveryContacts";
import { makeRecordNumber, PROVIDER_CHOICE_PLAN_OPTIONS, RECORD_NUMBER_GENERATOR_PLAN_OPTIONS, RECORD_NUMBER_LOOKUP_LINKS, RECORD_NUMBER_LOOKUP_PLAN_OPTIONS, recordNumberPrefix } from "@/lib/insurancePlans";
import { REFERRAL_SOURCE_OPTIONS } from "@/config/mooreDivineQuestions";
import { deliveryDashboardFlash, storeDashboardFlash } from "@/lib/dashboardFlash";
import {
  assignIntakeContacts,
  formatUsPhoneDisplay,
} from "@/lib/intakeContacts";
import {
  extractIntakeNoteFields,
  type IntakeNoteField,
} from "@/lib/parseIntakeNotes";
import { buildNewIntakeReadiness } from "@/lib/newIntakeReadiness";
import {
  DEFAULT_INTAKE_STATE,
  canOfferCompletedPacketEmail,
  resolveCreateIntakeHousing,
} from "@/lib/newIntakeHousing";

const FIELDS = [
  ["fullName", "Client full name *", "text"], ["dob", "Date of birth *", "date"],
  ["midNumber", "MID#", "text"], ["recordNumber", "Record# (generated if blank)", "text"],
  ["intakeDate", "Date of intake", "date"], ["location", "Location", "text"],
  ["email", "Client email", "text"], ["phone", "Client cell (SMS)", "tel"],
  ["guardianName", "Guardian name (if applicable)", "text"],
  ["guardianEmail", "Guardian email", "email"], ["guardianPhone", "Guardian phone", "tel"],
  ["addressStreet", "Street address", "text"], ["addressCity", "City", "text"], ["addressState", "State", "text"],
  ["livingArrangement", "Living arrangement", "text"],
] as const;
type FieldKey = (typeof FIELDS)[number][0];

const IDENTITY_KEYS = new Set(["fullName", "dob"]);
const DETAILS_FORM_KEYS = new Set(["midNumber", "intakeDate", "location", "guardianName", "guardianEmail", "guardianPhone"]);
const DETAILS_NOTE_KEYS = new Set([
  "mid_number", "address_street", "address_city", "address_state", "living_arrangement",
  "gender", "race", "ethnicity", "veteran", "employment_status", "pcp_name", "pcp_phone",
  "ec1_name", "ec1_cell_phone",
]);
const ADVANCED_NOTE_KEYS = new Set(["provider_choice_plan", "record_number"]);

const QUICK_NOTE_RACE_OPTIONS = [
  "American Indian or Alaska Native", "Asian", "Black or African American",
  "Caucasian or White", "Multiracial", "Native American", "Native Hawaiian or Pacific Islander",
];
const QUICK_NOTE_GENDER_OPTIONS = ["Female", "Male", "Transgender", "Other"];
const QUICK_NOTE_ETHNICITY_OPTIONS = ["Hispanic/White", "Non-Hispanic/White", "Latino", "Hispanic/Black", "Non-Hispanic/Black"];
const QUICK_NOTE_EMPLOYMENT_OPTIONS = ["Not in Labor Force", "Unemployed", "Disabled", "Employed"];
const QUICK_NOTE_YES_NO_OPTIONS = ["Yes", "No"];

const NOTE_TARGETS: Record<string, { kind: "form"; key: FieldKey } | { kind: "quick"; key: string }> = {
  client_full_name: { kind: "form", key: "fullName" },
  dob: { kind: "form", key: "dob" },
  mid_number: { kind: "form", key: "midNumber" },
  client_phone_cell: { kind: "form", key: "phone" },
  client_email: { kind: "form", key: "email" },
  address_street: { kind: "form", key: "addressStreet" },
  address_city: { kind: "form", key: "addressCity" },
  address_state: { kind: "form", key: "addressState" },
  living_arrangement: { kind: "form", key: "livingArrangement" },
  gender: { kind: "quick", key: "gender" },
  race: { kind: "quick", key: "race" },
  ethnicity: { kind: "quick", key: "ethnicity" },
  veteran: { kind: "quick", key: "veteran" },
  employment_status: { kind: "quick", key: "employment_status" },
  provider_choice_plan: { kind: "quick", key: "provider_choice_plan" },
  pcp_name: { kind: "quick", key: "pcp_name" },
  pcp_phone: { kind: "quick", key: "pcp_phone" },
  ec1_name: { kind: "quick", key: "ec1_name" },
  ec1_cell_phone: { kind: "quick", key: "ec1_cell_phone" },
};

type NcTracksTab = "upload" | "howto" | "nctracks";

function todayInputDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function readFieldValues(formEl: HTMLFormElement, fallback: Record<string, string>): Record<FieldKey, string> {
  const formData = new FormData(formEl);
  return Object.fromEntries(FIELDS.map(([key]) => {
    const value = formData.get(key);
    return [key, typeof value === "string" ? value : (fallback[key] || "")];
  })) as Record<FieldKey, string>;
}

export default function NewIntake() {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>({ intakeDate: todayInputDate(), addressState: DEFAULT_INTAKE_STATE });
  const [recordPanel, setRecordPanel] = useState("");
  const [referralSource, setReferralSource] = useState("");
  const [recordTab, setRecordTab] = useState<"generate" | "lookup">("generate");
  const [homelessSelected, setHomelessSelected] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [recordGeneratorNote, setRecordGeneratorNote] = useState("");
  const [recordNumberWasGenerated, setRecordNumberWasGenerated] = useState(false);
  const [expectCca, setExpectCca] = useState(true);
  const [autoEmailProviderPacket, setAutoEmailProviderPacket] = useState(false);
  const [error, setError] = useState("");
  const [contactError, setContactError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<{ id: string; clientLink: string; linkDays?: number; recordNumber?: string; providerChoicePlan?: string; publicLinkReady?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [messageCopied, setMessageCopied] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const [sendStatusKind, setSendStatusKind] = useState<"success" | "warning" | "error" | "info">("info");
  const [sendBusy, setSendBusy] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [ncTracksTab, setNcTracksTab] = useState<NcTracksTab>("upload");
  const [helperNotes, setHelperNotes] = useState("");
  const [quickAnswers, setQuickAnswers] = useState<Record<string, string>>({});
  const [extractedFields, setExtractedFields] = useState<IntakeNoteField[]>([]);
  const [ncTracksFile, setNcTracksFile] = useState<File | null>(null);
  const [setupStatus, setSetupStatus] = useState("");
  const [setupStatusKind, setSetupStatusKind] = useState<"success" | "error" | "info">("info");
  const [providerName, setProviderName] = useState("Provider");
  const [providerPhone, setProviderPhone] = useState("");
  const [packetName, setPacketName] = useState("");
  const [packetPageCount, setPacketPageCount] = useState<number | null>(null);
  const [packetReady, setPacketReady] = useState(true);
  const [packetReadinessMessage, setPacketReadinessMessage] = useState("");
  const [packetContextLoaded, setPacketContextLoaded] = useState(false);
  const [packetSetupHref, setPacketSetupHref] = useState("");
  const [packetContextError, setPacketContextError] = useState("");
  const [sendSmsAfterCreate, setSendSmsAfterCreate] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const assignedPreview = assignIntakeContacts(form.email || "", form.phone || "");
  const smsPhone = assignedPreview.error ? "" : assignedPreview.phone;
  const housingPreview = resolveCreateIntakeHousing({
    addressStreet: form.addressStreet,
    addressCity: form.addressCity,
    addressState: form.addressState,
    livingArrangement: form.livingArrangement,
    homelessSelected,
  });
  const packetEmailEnabled = canOfferCompletedPacketEmail({
    packetContextLoaded,
    packetReady,
    packetContextError: !!packetContextError,
  });
  const intakeReadiness = buildNewIntakeReadiness({
    fullName: form.fullName,
    dob: form.dob,
    contactReady: !assignedPreview.error && !!(assignedPreview.phone || assignedPreview.email),
    packetContextLoaded,
    packetContextError: !!packetContextError,
    packetReady,
  });

  useEffect(() => {
    let active = true;
    fetch("/api/intakes/context").then(async (res) => {
      const body = await readResponse(res) as {
        error?: string;
        provider?: { name?: string; phone?: string };
        packet?: { name?: string; pageCount?: number | null; ready?: boolean; state?: string; message?: string };
        access?: { canManageProvider?: boolean; packetSetupHref?: string | null };
      };
      if (!active) return;
      if (!res.ok) {
        setPacketReady(false);
        setPacketContextError(body.error || "Provider context could not be loaded. Sign in again before creating an intake.");
        setPacketContextLoaded(true);
        return;
      }
      setProviderName(body.provider?.name || "Provider");
      setProviderPhone(body.provider?.phone || "");
      setPacketName(body.packet?.name || `${body.provider?.name || "Provider"} Client Intake Package`);
      setPacketPageCount(typeof body.packet?.pageCount === "number" ? body.packet.pageCount : null);
      setPacketReady(body.packet?.ready !== false);
      setPacketReadinessMessage(body.packet?.message || "");
      setPacketSetupHref(body.access?.canManageProvider ? (body.access.packetSetupHref || "") : "");
      setPacketContextLoaded(true);
    }).catch(() => {
      if (active) {
        setPacketReady(false);
        setPacketContextError("Provider context could not be loaded. Refresh the page or sign in again before creating an intake.");
        setPacketContextLoaded(true);
      }
    });
    return () => { active = false; };
  }, []);

  async function readResponse(res: Response) {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
  }

  function noteFieldCurrentValue(field: IntakeNoteField): string {
    const target = NOTE_TARGETS[field.key];
    if (!target) return "";
    return target.kind === "form" ? (form[target.key] || "") : (quickAnswers[target.key] || "");
  }

  function applyNoteField(field: IntakeNoteField, onlyIfEmpty = false) {
    const target = NOTE_TARGETS[field.key];
    if (!target) return;
    const current = noteFieldCurrentValue(field).trim();
    if (onlyIfEmpty && current) return;
    applyNoteFields([field], onlyIfEmpty);
  }

  function applyNoteFields(fields: IntakeNoteField[], onlyIfEmpty = false) {
    const formPatch: Record<string, string> = {};
    const quickPatch: Record<string, string> = {};
    let useAddress = false;
    let useHomeless = false;
    let openDetails = false;
    let openAdvanced = false;
    for (const field of fields) {
      const target = NOTE_TARGETS[field.key];
      if (!target) continue;
      const current = (target.kind === "form" ? form[target.key] : quickAnswers[target.key]) || "";
      if (onlyIfEmpty && current.trim()) continue;
      if (DETAILS_NOTE_KEYS.has(field.key)) openDetails = true;
      if (ADVANCED_NOTE_KEYS.has(field.key)) openAdvanced = true;
      if (target.kind === "form") {
        formPatch[target.key] = field.value;
        if (target.key === "addressStreet" || target.key === "addressCity" || target.key === "addressState") useAddress = true;
        if (target.key === "livingArrangement" && field.value.toLowerCase() === "homeless") useHomeless = true;
      } else {
        quickPatch[target.key] = field.value;
      }
    }
    if (Object.keys(formPatch).length) setForm((existing) => ({ ...existing, ...formPatch }));
    if (Object.keys(quickPatch).length) setQuickAnswers((existing) => ({ ...existing, ...quickPatch }));
    if (useHomeless) setHomelessSelected(true);
    else if (useAddress) setHomelessSelected(false);
    if (openDetails) setDetailsOpen(true);
    if (openAdvanced) setAdvancedOpen(true);
    if (formPatch.phone) setSendSmsAfterCreate(true);
  }

  function ingestHelperNotes(notes: string, fillEmpty: boolean) {
    setHelperNotes(notes);
    const extracted = extractIntakeNoteFields(notes);
    setExtractedFields(extracted);
    if (fillEmpty) applyNoteFields(extracted, true);
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

  function selectRecordTab(tab: "generate" | "lookup") {
    if (tab === "lookup" && recordNumberWasGenerated) {
      setForm((current) => ({ ...current, recordNumber: "" }));
      setRecordGeneratorNote("");
      setRecordNumberWasGenerated(false);
    }
    setRecordTab(tab);
  }

  function onRecordPanelChange(value: string) {
    setRecordPanel(value);
    if (recordGeneratorNote.toLowerCase().includes("choose an insurance panel")) {
      setRecordGeneratorNote("");
    }
  }

  function generateRecordNumber() {
    if (!recordPanel) {
      setRecordGeneratorNote("Choose an insurance panel first so the Record# gets the correct prefix.");
      return;
    }
    const generated = makeRecordNumber(recordPanel);
    setForm((current) => ({ ...current, recordNumber: generated }));
    setRecordNumberWasGenerated(true);
    setRecordGeneratorNote(`Generated ${generated} for ${recordPanel}.`);
  }

  function selectNcTracksTab(tab: NcTracksTab) {
    setNcTracksTab(tab);
    if (tab === "nctracks") {
      window.open("https://www.nctracks.nc.gov/", "_blank", "noreferrer");
    }
  }

  async function applyStarterInfo(intakeId: string) {
    const selectedNotes = Object.entries(quickAnswers)
      .filter(([, value]) => value.trim())
      .map(([key, value]) => `${key}: ${value.trim()}`);
    const notes = [helperNotes.trim(), ...selectedNotes].filter(Boolean).join("\n");
    const messages: string[] = [];
    let hadError = false;

    if (notes) {
      const res = await fetch(`/api/intakes/${intakeId}/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: quickAnswers, helperNotes: notes, fillEmptyOnly: true }),
      });
      const body = await readResponse(res) as { applied?: number; error?: string };
      if (res.ok) messages.push(body.applied ? `Saved helper notes (${body.applied} field updates).` : "Saved helper notes.");
      else {
        messages.push(body.error || "Helper notes could not be saved.");
        hadError = true;
      }
    }

    if (ncTracksFile) {
      const fd = new FormData();
      fd.set("file", ncTracksFile);
      const res = await fetch(`/api/intakes/${intakeId}/nctracks-upload`, { method: "POST", body: fd });
      const body = await readResponse(res) as { count?: number; error?: string; details?: Array<{ label?: string }> };
      if (res.ok) {
        messages.push(ncTracksSuccessText(body));
      } else {
        messages.push(body.error || "NC Tracks card could not be read.");
        hadError = true;
      }
    }

    if (messages.length) {
      setSetupStatus(messages.join(" "));
      setSetupStatusKind(hadError ? "error" : "success");
    } else {
      setSetupStatus("Best next step: open the intake to finish NC Tracks, upload the CCA, and generate the packet.");
      setSetupStatusKind("info");
    }
  }

  async function sendCreatedLink(intakeId: string) {
    setSendBusy(true);
    setSendStatusKind("info");
    setSendStatus("Sending...");
    try {
      const res = await fetch(`/api/intakes/${intakeId}/remind`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        const sent = Array.isArray(body.sent) ? body.sent : [];
        const failed = Array.isArray(body.failed) ? body.failed : [];
        const parts = [
          sent.length ? `Delivery result: ${sent.join("; ")}` : "",
          failed.length ? `Not accepted: ${failed.join("; ")}` : "",
        ].filter(Boolean);
        const flash = deliveryDashboardFlash(sent, failed);
        if (flash) {
          setSendStatusKind(flash.kind);
          setSendStatus(`${parts.join(" | ")} Returning to the dashboard...`);
          storeDashboardFlash(flash);
          setRedirecting(true);
          window.setTimeout(() => router.replace("/dashboard"), 700);
        } else {
          setSendStatusKind("error");
          setSendStatus(parts.length ? parts.join(" | ") : "No message was accepted. Check the saved phone number or email and try again.");
        }
      } else {
        setSendStatusKind("error");
        setSendStatus(`Send failed: ${body.error || body.failed?.join("; ") || res.status}`);
      }
    } catch {
      setSendStatusKind("error");
      setSendStatus("Send failed. Check your connection and try again.");
    } finally {
      setSendBusy(false);
    }
  }

  function focusFirstMissing() {
    const missing = intakeReadiness.items.find((item) => !item.ready)?.key;
    const targetId = missing === "identity"
      ? (!(form.fullName || "").trim() ? "new-intake-fullName" : "new-intake-dob")
      : "new-intake-phone";
    const target = document.getElementById(targetId) as HTMLElement | null;
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => target?.focus({ preventScroll: true }), 250);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nextForm = readFieldValues(e.currentTarget, form);
    const assigned = assignIntakeContacts(nextForm.email, nextForm.phone);
    setError("");
    setContactError("");
    setSetupStatus("");
    if (!(nextForm.fullName || "").trim() || !(nextForm.dob || "").trim()) {
      setForm((current) => ({ ...current, ...nextForm }));
      setError("Add the client's full name and date of birth before creating the secure link.");
      window.setTimeout(focusFirstMissing, 0);
      return;
    }
    if (assigned.error) {
      setForm((current) => ({ ...current, ...nextForm }));
      setContactError(assigned.error);
      window.setTimeout(() => {
        const target = document.getElementById("new-intake-phone");
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        (target as HTMLElement | null)?.focus({ preventScroll: true });
      }, 0);
      return;
    }
    const housing = resolveCreateIntakeHousing({
      addressStreet: nextForm.addressStreet,
      addressCity: nextForm.addressCity,
      addressState: nextForm.addressState,
      livingArrangement: nextForm.livingArrangement || form.livingArrangement,
      homelessSelected,
    });
    setForm((current) => ({ ...current, ...nextForm, email: assigned.email, phone: assigned.phone }));
    setIsCreating(true);
    try {
      const requestBody = {
        ...form,
        ...nextForm,
        email: assigned.email,
        phone: assigned.phone,
        providerChoicePlan: recordPanel,
        referralSource,
        livingArrangement: housing.livingArrangement,
        addressStreet: housing.addressStreet,
        addressCity: housing.addressCity,
        addressState: housing.addressState,
        expectCca,
        autoEmailProviderPacket: packetEmailEnabled && autoEmailProviderPacket,
      };
      const res = await fetch("/api/intakes", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody),
      });
      const body = await readResponse(res);
      if (res.ok) {
        const created = body as { id: string; clientLink: string; linkDays?: number; recordNumber?: string; providerChoicePlan?: string; publicLinkReady?: boolean };
        await applyStarterInfo(created.id);
        setResult(created);
        if (assigned.phone && sendSmsAfterCreate && created.publicLinkReady !== false) {
          await sendCreatedLink(created.id);
        }
      }
      else setError((body as { error?: string }).error || "Failed to create intake");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the intake right now.");
    } finally {
      setIsCreating(false);
    }
  }

  if (result) {
    const deliveryContacts = clientDeliveryContacts({
      phone: form.phone,
      email: form.email,
      guardianPhone: form.guardianPhone,
      guardianEmail: form.guardianEmail,
    });
    const phone = deliveryContacts.phone?.value || "";
    const email = deliveryContacts.email?.value || "";
    const message = intakeShareMessage(result.clientLink, providerName, providerPhone);
    const hasContact = !!(phone || email);
    const recipientSummary = [
      deliveryContacts.phone ? `SMS to ${deliveryContacts.phone.role} at ${deliveryContacts.phone.value}` : "",
      deliveryContacts.email ? `email to ${deliveryContacts.email.role} at ${deliveryContacts.email.value}` : "",
    ].filter(Boolean).join("; ");
    return (
      <main className="mx-auto max-w-xl p-6">
        <div className="card">
          <h1 className="text-xl font-bold text-emerald-600">Intake created</h1>
          <p className="mt-2 text-sm text-slate-600">
            Package: <b>{packetName || "Client Intake Package"}</b>. Send the client this secure
            link (works for {result.linkDays || 7} days, no client info in the URL):
          </p>
          <p className="mt-2 text-sm font-semibold text-brand">
            Record#: {result.recordNumber || "Generated"}{result.providerChoicePlan ? ` (${result.providerChoicePlan})` : ""}
          </p>
          <div className="mt-3 break-all rounded-lg bg-slate-100 p-3 font-mono text-sm">{result.clientLink}</div>
          {result.publicLinkReady === false ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="font-semibold">Local workspace only</p>
              <p className="mt-1">This intake is saved on this computer, not on the live Render site. Do not text or email this link to the client.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a className="btn-primary text-center" href="https://mdc-smart-intake.onrender.com/login" target="_blank" rel="noreferrer">
                  Open live dashboard
                </a>
                <Link href={`/intakes/${result.id}`} className="btn-secondary">Open local intake</Link>
              </div>
            </div>
          ) : (
            <>
              {hasContact && (
                <p className="mt-3 break-words rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                  <span className="font-bold">Send to:</span> {recipientSummary}
                </p>
              )}
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  className="btn-primary"
                  disabled={sendBusy || redirecting || !hasContact}
                  onClick={() => { void sendCreatedLink(result.id); }}
                >
                  {redirecting ? "Returning to dashboard..." : sendBusy ? "Sending..." : hasContact ? "Send to saved contacts" : "No saved contact"}
                </button>
                <Link href={`/intakes/${result.id}`} className="btn-secondary text-center">
                  Open intake &amp; staff setup
                </Link>
              </div>
              {!hasContact && (
                <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                  Add a client or guardian phone number or email on the intake page before sending.
                </p>
              )}
              <details className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <summary className="cursor-pointer font-semibold text-slate-800">
                  Manual sending &amp; message preview
                </summary>
                <p className="mt-3 break-all whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-slate-700">{message}</p>
                <p className="mt-2 text-xs text-slate-500">
                  The message contains a secure link and no client name or health details. Confirm the recipient before sending.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button className="btn-ghost" onClick={async () => {
                    await navigator.clipboard.writeText(result.clientLink); setCopied(true);
                  }}>{copied ? "Link copied" : "Copy client link"}</button>
                  <button className="btn-ghost" onClick={async () => {
                    await navigator.clipboard.writeText(message); setMessageCopied(true);
                  }}>{messageCopied ? "Message copied" : "Copy SMS message"}</button>
                  {phone && (
                    <a
                      className="btn-ghost text-center"
                      href={intakeSmsHref(phone, result.clientLink, providerName, providerPhone)}
                    >
                      Open SMS on this computer
                    </a>
                  )}
                  {email && (
                    <a
                      className="btn-ghost text-center"
                      href={intakeMailtoHref(email, result.clientLink, providerName, providerPhone)}
                    >
                      Open email
                    </a>
                  )}
                </div>
              </details>
            </>
          )}
          {setupStatus && (
            <p className={`mt-3 rounded-lg p-3 text-sm font-semibold ${
              setupStatusKind === "success" ? "bg-emerald-50 text-emerald-700" :
              setupStatusKind === "error" ? "bg-red-50 text-red-700" :
              "bg-slate-50 text-slate-700"
            }`} role={setupStatusKind === "error" ? "alert" : "status"} aria-live="polite">
              {setupStatus}
            </p>
          )}
          {sendStatus && (
            <p className={`mt-3 rounded-lg p-3 text-sm font-semibold ${
              sendStatusKind === "success" ? "bg-emerald-50 text-emerald-700" :
              sendStatusKind === "warning" ? "bg-amber-50 text-amber-800" :
              sendStatusKind === "error" ? "bg-red-50 text-red-700" :
              "bg-brand-light text-brand"
            }`}
            role={sendStatusKind === "error" ? "alert" : "status"}
            aria-live="polite"
            >
              {sendStatus}
            </p>
          )}
        </div>
      </main>
    );
  }

  const submitLabel = isCreating
    ? (smsPhone && sendSmsAfterCreate ? "Creating and texting the link..." : "Creating intake...")
    : packetContextError
      ? "Sign in to create an intake"
    : smsPhone
      ? "Create and text the link"
      : "Create intake";

  return (
    <main className="mx-auto max-w-xl p-4 pb-28 sm:p-6">
      <Link href="/dashboard" className="text-sm text-brand hover:underline">Dashboard</Link>
      <form ref={formRef} method="post" onSubmit={submit} className="card mt-3" noValidate>
        <h1 className="mb-1 text-xl font-bold">Create New Intake</h1>
        <div className="mb-4 flex min-h-[1.75rem] flex-wrap items-center gap-2 text-sm text-slate-600" role="status" aria-live="polite">
          <span>
            {packetContextError
              ? "Provider context unavailable"
              : packetContextLoaded
              ? `${packetReady ? "Approved package" : "Uploaded packet (not active)"}: ${packetName}${packetPageCount ? ` (${packetPageCount} pages)` : ""}`
              : "Checking provider packet status…"}
          </span>
          {packetContextLoaded && !packetContextError && (
            <span className={`badge ${packetReady ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
              {packetReady ? "Ready" : "Setup pending"}
            </span>
          )}
        </div>
        <section aria-labelledby="new-intake-readiness-title" className="mb-4 rounded-xl border border-brand/20 bg-brand-light/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="new-intake-readiness-title" className="font-bold text-slate-900">{intakeReadiness.title}</h2>
            <span className="badge bg-white text-brand">
              {intakeReadiness.completedRequired}/{intakeReadiness.totalRequired} required
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {intakeReadiness.items.map((item) => (
              <div key={item.key} className="flex items-start gap-2 rounded-lg bg-white p-3 text-sm">
                <span aria-hidden="true" className={item.ready ? "text-emerald-600" : "text-slate-400"}>{item.ready ? "✓" : "○"}</span>
                <span>
                  <span className="block font-semibold text-slate-800">{item.label}</span>
                  <span className="text-xs text-slate-500">{item.help}</span>
                </span>
              </div>
            ))}
          </div>
          <p className={`mt-3 text-xs font-semibold ${intakeReadiness.packet.tone === "warning" ? "text-amber-800" : intakeReadiness.packet.tone === "success" ? "text-emerald-700" : "text-slate-500"}`}>
            Packet: {intakeReadiness.packet.label}
          </p>
        </section>
        {packetContextError && (
          <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-bold">Provider context unavailable</p>
            <p className="mt-1">{packetContextError}</p>
            <Link href="/provider" className="btn-secondary mt-3 px-3 py-2 text-sm">Open provider sign in</Link>
          </div>
        )}
        {!packetReady && packetContextLoaded && !packetContextError && (
          <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-bold">Provider packet setup required before PDF or DocuSign</p>
            <p className="mt-1 leading-6">{packetReadinessMessage}</p>
            <p className="mt-1 font-semibold">You can still create this intake, send the secure link, and collect the client&apos;s answers.</p>
            {packetSetupHref && (
              <Link href={packetSetupHref} className="btn-ghost mt-3 border-amber-400 bg-white px-3 py-2 text-sm text-amber-950">
                Open packet setup
              </Link>
            )}
          </div>
        )}
        <section id="new-intake-paste" className="mb-4 rounded-xl border border-brand/20 bg-brand-light/20 p-4">
          <h2 className="font-bold text-slate-900">Paste CCA / quick notes</h2>
          <p className="mt-1 text-sm text-slate-600">
            Paste first, confirm the chips, then create. Empty identity, address, phone, and emergency-contact fields fill automatically. Confirmed fields are not overwritten unless you choose replace.
          </p>
          <label className="mt-3 block">
            <span className="label">Quick notes</span>
            <textarea
              className="input min-h-[120px]"
              value={helperNotes}
              onChange={(e) => ingestHelperNotes(e.target.value, false)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (!pasted) return;
                const target = e.currentTarget;
                const start = target.selectionStart ?? helperNotes.length;
                const end = target.selectionEnd ?? helperNotes.length;
                e.preventDefault();
                ingestHelperNotes(helperNotes.slice(0, start) + pasted + helperNotes.slice(end), true);
              }}
              placeholder={"Label: value, one per line\nName:\nDOB:\nAddress:\nPhone:\nEmergency contact:\nMID:"}
            />
          </label>
          {extractedFields.length > 0 && (
            <div className="mt-3 rounded-lg border border-brand/20 bg-white p-3">
              <p className="text-sm font-semibold text-slate-800">Extracted from notes — confirm each value</p>
              <p className="mt-1 text-xs text-slate-500">Empty fields are filled automatically. Confirmed fields are not overwritten unless you choose replace.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {extractedFields.map((field) => {
                  const current = noteFieldCurrentValue(field).trim();
                  const applied = current === field.value.trim();
                  const occupied = !!current && !applied;
                  return (
                    <button
                      key={`${field.key}:${field.value}`}
                      type="button"
                      className={applied ? "chip chip-on" : "chip"}
                      onClick={() => applyNoteField(field)}
                    >
                      {field.label}: {field.value}
                      {applied ? " (applied)" : occupied ? " (replace)" : " (use)"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
        <div id="new-intake-basics" className="scroll-mt-28 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.filter(([key]) => IDENTITY_KEYS.has(key)).map(([key, label, type]) => (
            <div key={key} className={key === "fullName" ? "sm:col-span-2" : ""}>
              <label className="label" htmlFor={`new-intake-${key}`}>{label}</label>
              <input className="input" id={`new-intake-${key}`} name={key} type={type} value={form[key] || ""}
                required={key === "fullName" || key === "dob"}
                max={key === "dob" ? new Date().toISOString().slice(0, 10) : undefined}
                autoComplete={key === "fullName" ? "name" : key === "dob" ? "bday" : "off"}
                autoCapitalize={key === "fullName" ? "words" : undefined}
                enterKeyHint="next"
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
          <div id="new-intake-contact" className="scroll-mt-28 sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="font-semibold text-slate-900">How to send the secure link</p>
            <p className="mt-1 text-sm text-slate-600">
              Cell is the SMS field. Type a phone in either box and it is treated as a phone.
              Email is optional. One of phone or email is required.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label htmlFor="new-intake-phone">
                <span className="label">Client cell (SMS)</span>
                <input
                  className="input"
                  id="new-intake-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="next"
                  aria-invalid={contactError ? true : undefined}
                  aria-describedby="new-intake-contact-help"
                  value={form.phone || ""}
                  onChange={(e) => {
                    const phone = e.target.value;
                    setForm((f) => ({ ...f, phone }));
                    const assigned = assignIntakeContacts(form.email || "", phone);
                    setSendSmsAfterCreate(!!assigned.phone && !assigned.error);
                    if (contactError) setContactError("");
                  }}
                  placeholder="10-digit cell"
                />
              </label>
              <label htmlFor="new-intake-email">
                <span className="label">Client email</span>
                <input
                  className="input"
                  id="new-intake-email"
                  name="email"
                  type="text"
                  inputMode="email"
                  autoComplete="email"
                  enterKeyHint="next"
                  aria-invalid={contactError ? true : undefined}
                  aria-describedby="new-intake-contact-help"
                  value={form.email || ""}
                  onChange={(e) => {
                    const email = e.target.value;
                    setForm((f) => ({ ...f, email }));
                    const assigned = assignIntakeContacts(email, form.phone || "");
                    setSendSmsAfterCreate(!!assigned.phone && !assigned.error);
                    if (contactError) setContactError("");
                  }}
                  placeholder="Optional email"
                />
              </label>
            </div>
            <p id="new-intake-contact-help" className="mt-2 text-xs text-slate-500">
              Phone or email required. The cell number is the SMS destination for the secure link.
            </p>
            {contactError && (
              <p className="mt-2 text-sm font-semibold text-red-700" role="alert">{contactError}</p>
            )}
            {smsPhone && (
              <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
                <p className="font-bold">Text destination: {formatUsPhoneDisplay(smsPhone)}</p>
                <p className="mt-1 text-xs leading-5 text-blue-900">
                  The text contains the provider name, private link, save-and-return instructions, help number, and STOP wording. It does not contain the client name or health details.
                </p>
                <label className="mt-3 flex min-h-11 items-start gap-3 rounded-lg bg-white p-3 font-semibold">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-5 w-5 shrink-0"
                    checked={sendSmsAfterCreate}
                    onChange={(event) => setSendSmsAfterCreate(event.target.checked)}
                  />
                  <span>I confirmed this mobile number and want to text the link immediately.</span>
                </label>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <label className="flex min-h-11 items-start gap-3 text-sm font-semibold text-amber-950">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0"
              checked={homelessSelected}
              onChange={(event) => setHomelessSelected(event.target.checked)}
            />
            <span>Homeless / no fixed address</span>
          </label>
          {housingPreview.homeless ? (
            <p className="mt-2 text-sm text-amber-800">
              Street is blank, so this intake uses the no-fixed-address path. The packet will mark the client as homeless, skip the street-address requirement, and let the client continue without repeating that question. Open Details only if you have a confirmed street.
            </p>
          ) : (
            <p className="mt-2 text-sm text-amber-800">Check this if the client has no fixed address. Do not enter a made-up street.</p>
          )}
          {housingPreview.homeless && <input type="hidden" name="livingArrangement" value="Homeless" />}
        </div>
        <details
          id="new-intake-details"
          className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
          open={detailsOpen}
          onToggle={(event) => setDetailsOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-bold text-slate-900">Details</summary>
          <p className="mt-1 text-sm text-slate-600">MID, location, guardian, referral, address extras, and Quick-fill. Stays filled even when collapsed.</p>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {FIELDS.filter(([key]) => DETAILS_FORM_KEYS.has(key)).map(([key, label, type]) => (
              <div key={key} className={key === "guardianName" ? "sm:col-span-2" : ""}>
                <label className="label" htmlFor={`new-intake-${key}`}>{label}</label>
                <input className="input" id={`new-intake-${key}`} name={key} type={type} value={form[key] || ""}
                  autoComplete={key === "location" ? "address-level2" : key === "guardianEmail" ? "email" : key === "guardianPhone" ? "tel" : "off"}
                  autoCapitalize={key === "midNumber" ? "characters" : key === "location" || key === "guardianName" ? "words" : undefined}
                  spellCheck={key === "midNumber" ? false : undefined}
                  placeholder={key === "location" ? "Office or city" : undefined}
                  enterKeyHint="next"
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}
            <label>
              <span className="label">Referral source</span>
              <select className="input" value={referralSource} onChange={(e) => setReferralSource(e.target.value)}>
                <option value="">Select referral source</option>
                {REFERRAL_SOURCE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
            <h3 className="font-semibold text-slate-900">Address extras</h3>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(["addressStreet", "addressCity", "addressState"] as const).map((key) => (
                <label key={key} className={key === "addressStreet" ? "sm:col-span-3" : ""}>
                  <span className="label">{key === "addressStreet" ? "Street address" : key === "addressCity" ? "City" : "State"}</span>
                  <input className="input" name={key} value={form[key] || ""}
                    autoComplete={key === "addressStreet" ? "street-address" : key === "addressCity" ? "address-level2" : "address-level1"}
                    onChange={(e) => {
                      const value = e.target.value;
                      setForm((current) => ({ ...current, [key]: value }));
                      if (key === "addressStreet" && value.trim()) setHomelessSelected(false);
                    }}
                    placeholder={key === "addressState" ? DEFAULT_INTAKE_STATE : key === "addressStreet" ? "Leave blank if no fixed address" : ""} />
                </label>
              ))}
            </div>
            {!housingPreview.homeless && (
              <label className="mt-3 block">
                <span className="label">Living arrangement</span>
                <input className="input" name="livingArrangement" value={form.livingArrangement || ""}
                  onChange={(e) => setForm((current) => ({ ...current, livingArrangement: e.target.value }))} />
              </label>
            )}
          </div>
          <div className="mt-4 rounded-lg border border-brand/20 bg-white p-3">
            <p className="font-semibold text-brand">Quick-fill common answers</p>
            <p className="mt-2 text-xs text-slate-600">Use only answers confirmed by the client or records. When you create the intake, these answers are saved to the packet and the client can skip those SMS questions.</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label>
                <span className="label">Gender</span>
                <select className="input" value={quickAnswers.gender || ""} onChange={(e) => setQuickAnswers((current) => ({ ...current, gender: e.target.value }))}>
                  <option value="">Select gender</option>
                  {QUICK_NOTE_GENDER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label>
                <span className="label">Race</span>
                <select className="input" value={quickAnswers.race || ""} onChange={(e) => setQuickAnswers((current) => ({ ...current, race: e.target.value }))}>
                  <option value="">Select race</option>
                  {QUICK_NOTE_RACE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label>
                <span className="label">Ethnicity</span>
                <select className="input" value={quickAnswers.ethnicity || ""} onChange={(e) => setQuickAnswers((current) => ({ ...current, ethnicity: e.target.value }))}>
                  <option value="">Select ethnicity</option>
                  {QUICK_NOTE_ETHNICITY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label>
                <span className="label">Veteran</span>
                <select className="input" value={quickAnswers.veteran || ""} onChange={(e) => setQuickAnswers((current) => ({ ...current, veteran: e.target.value }))}>
                  <option value="">Select yes or no</option>
                  {QUICK_NOTE_YES_NO_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label>
                <span className="label">Employment status</span>
                <select className="input" value={quickAnswers.employment_status || ""} onChange={(e) => setQuickAnswers((current) => ({ ...current, employment_status: e.target.value }))}>
                  <option value="">Select employment</option>
                  {QUICK_NOTE_EMPLOYMENT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label>
                <span className="label">Type of insurance</span>
                <select className="input" value={quickAnswers.provider_choice_plan || ""} onChange={(e) => setQuickAnswers((current) => ({ ...current, provider_choice_plan: e.target.value }))}>
                  <option value="">Select insurance</option>
                  {PROVIDER_CHOICE_PLAN_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label>
                <span className="label">PCP name</span>
                <input className="input" value={quickAnswers.pcp_name || ""} onChange={(e) => setQuickAnswers((current) => ({ ...current, pcp_name: e.target.value }))} placeholder="Name from records" />
              </label>
              <label>
                <span className="label">PCP phone</span>
                <input className="input" value={quickAnswers.pcp_phone || ""} onChange={(e) => setQuickAnswers((current) => ({ ...current, pcp_phone: e.target.value }))} placeholder="10-digit number from the record" />
              </label>
              <label>
                <span className="label">Emergency contact</span>
                <input className="input" value={quickAnswers.ec1_name || ""} onChange={(e) => setQuickAnswers((current) => ({ ...current, ec1_name: e.target.value }))} placeholder="Full name from the record" />
              </label>
              <label>
                <span className="label">Emergency phone</span>
                <input className="input" value={quickAnswers.ec1_cell_phone || ""} onChange={(e) => setQuickAnswers((current) => ({ ...current, ec1_cell_phone: e.target.value }))} placeholder="10-digit number from the record" />
              </label>
            </div>
          </div>
        </details>
        <details
          id="new-intake-advanced"
          className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer font-bold text-slate-900">Advanced</summary>
          <p className="mt-1 text-sm text-slate-600">Record#, insurance lookup, and NC Tracks. Leave closed to create the link without scrolling past them. A Record# is generated if you skip this.</p>
          <div id="new-intake-record" className="scroll-mt-28 mt-4 rounded-xl border border-brand/20 bg-brand-light/40 p-4">
            <h3 className="font-bold text-brand">Record number</h3>
            <p className="mt-1 text-sm text-slate-600">
              Auto-generate a Record# in the format <b>PANEL-12345</b>, or look up the official number.
              The five digits are random and the server checks for duplicates within this provider.
            </p>
            <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Record number method">
              <button id="record-tab-generate" type="button" role="tab" aria-selected={recordTab === "generate"}
                aria-controls="record-tabpanel" tabIndex={recordTab === "generate" ? 0 : -1}
                onClick={() => selectRecordTab("generate")}
                className={`min-h-11 rounded-full px-3 py-2 text-sm font-semibold ${recordTab === "generate" ? "bg-brand text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                Auto-generate
              </button>
              <button id="record-tab-lookup" type="button" role="tab" aria-selected={recordTab === "lookup"}
                aria-controls="record-tabpanel" tabIndex={recordTab === "lookup" ? 0 : -1}
                onClick={() => selectRecordTab("lookup")}
                className={`min-h-11 rounded-full px-3 py-2 text-sm font-semibold ${recordTab === "lookup" ? "bg-brand text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                Panel lookup
              </button>
            </div>
            <div id="record-tabpanel" role="tabpanel" aria-labelledby={`record-tab-${recordTab}`}>
              {recordTab === "generate" ? (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <label>
                    <span className="label">Insurance panel</span>
                    <select id="new-intake-record-panel" className="input" value={recordPanel} onChange={(e) => onRecordPanelChange(e.target.value)}>
                      <option value="">Select panel</option>
                      {RECORD_NUMBER_GENERATOR_PLAN_OPTIONS.map((plan) => (
                        <option key={plan} value={plan}>{plan} ({recordNumberPrefix(plan) || "OTHER"})</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="btn-secondary" disabled={!recordPanel} onClick={generateRecordNumber}>Generate Record#</button>
                </div>
              ) : (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm font-semibold text-amber-900">These panels are lookup-only. Open the official site, find the client record, then enter the returned number below.</p>
                  <label className="mt-3 block">
                    <span className="label">Insurance panel</span>
                    <select id="new-intake-record-panel" className="input" value={recordPanel} onChange={(e) => onRecordPanelChange(e.target.value)}>
                      <option value="">Select lookup panel</option>
                      {RECORD_NUMBER_LOOKUP_PLAN_OPTIONS.map((plan) => (
                        <option key={plan} value={plan}>{plan}</option>
                      ))}
                    </select>
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {RECORD_NUMBER_LOOKUP_LINKS.map((link) => (
                      <a key={link.key} className="btn-ghost px-2 py-1 text-xs" href={link.url} target="_blank" rel="noreferrer">
                        {link.label} lookup
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <label className="mt-3 block">
              <span className="label">Record#</span>
              <input className="input" name="recordNumber" value={form.recordNumber || ""}
                onChange={(e) => {
                  setRecordNumberWasGenerated(false);
                  setForm((current) => ({ ...current, recordNumber: e.target.value }));
                }}
                placeholder={recordTab === "lookup" ? "Enter the official lookup Record#" : "Leave blank to auto-generate"} />
            </label>
            {recordGeneratorNote && <p className="mt-2 text-sm font-semibold text-brand">{recordGeneratorNote}</p>}
            <p className="mt-2 text-xs text-slate-500">Only Blue Cross Blue Shield = BCBS-12345, United Health Care = UHC-12345, AmeriHealth = AMERI-12345, and Carolina Complete = CC-12345 use the generator. Other panels require their official Record#. Skipping this generates a TEMP Record#.</p>
          </div>
          <div id="new-intake-optional" className="scroll-mt-28 mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-bold text-slate-900">NC Tracks</h3>
            <p className="mt-1 text-sm text-slate-600">
              Upload a card or open NC Tracks if you already have it. Paste stays at the top of this page.
            </p>
            <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="NC Tracks starter options">
              {([
                ["upload", "Upload"],
                ["howto", "How it works"],
                ["nctracks", "Open NC Tracks"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  id={`nctracks-tab-${key}`}
                  type="button"
                  role="tab"
                  aria-selected={ncTracksTab === key}
                  aria-controls="nctracks-tabpanel"
                  tabIndex={ncTracksTab === key ? 0 : -1}
                  onClick={() => selectNcTracksTab(key)}
                  className={`min-h-11 rounded-full px-3 py-2 text-sm font-semibold ${
                    ncTracksTab === key ? "bg-brand text-white" : "bg-white text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div id="nctracks-tabpanel" role="tabpanel" aria-labelledby={`nctracks-tab-${ncTracksTab}`}>
            {ncTracksTab === "upload" && (
              <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
                <label className="btn-primary inline-flex cursor-pointer items-center justify-center px-4 py-2">
                  {ncTracksFile ? "Replace NC Tracks file" : "Choose NC Tracks screenshot / card / PDF"}
                  <input
                    type="file"
                    className="hidden"
                    accept="application/pdf,image/*"
                    onChange={(e) => setNcTracksFile(e.target.files?.[0] || null)}
                  />
                </label>
                <p className="mt-2 text-sm text-slate-600">
                  Upload a screenshot, photo, or PDF from Downloads. After the intake is created, the app
                  scans it and fills MID, PCP, Medicaid plan, and other matching helper fields.
                </p>
                {ncTracksFile && <p className="mt-2 text-sm font-semibold text-slate-700">{ncTracksFile.name}</p>}
              </div>
            )}
            {ncTracksTab === "howto" && (
              <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                The app cannot safely read another signed-in browser tab by itself. The good workflows are:
                paste quick notes at the top of this page, upload a card / PDF to scan, or open NC Tracks in a new tab.
              </div>
            )}
            {ncTracksTab === "nctracks" && (
              <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                NC Tracks opens in a new tab. Copy Recipient ID, PCP, and plan details back to Paste at the top, or upload a screenshot.
                <div className="mt-3">
                  <a className="btn-secondary px-3 py-1.5 text-sm" href="https://www.nctracks.nc.gov/" target="_blank" rel="noreferrer">
                    Open NC Tracks again
                  </a>
                </div>
              </div>
            )}
            </div>
          </div>
        </details>
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={expectCca}
            onChange={(e) => setExpectCca(e.target.checked)} />
          <span><b>Fast Intake</b> - only ask the client the essentials (about 35 quick
          taps + consents + signature). The clinician&apos;s CCA will fill in the rest when you
          upload it in the <b>Add CCA</b> section on the client&apos;s page. Uncheck for the full question set.</span>
        </label>
        <label className={`mt-3 flex items-start gap-3 rounded-lg border p-3 text-sm ${packetEmailEnabled ? "border-slate-200 bg-slate-50 text-slate-600" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5"
            checked={packetEmailEnabled && autoEmailProviderPacket}
            disabled={!packetEmailEnabled}
            onChange={(e) => setAutoEmailProviderPacket(e.target.checked)}
          />
          <span>
            <b>Email completed packet to provider</b> - after the client signs and the packet is generated,
            email the completed PDF to the provider email on file. This stays off unless you turn it on.
            {!packetEmailEnabled && (
              <span className="mt-1 block font-semibold text-amber-800">
                Disabled until this provider&apos;s packet is approved and active. You can still create the intake and collect answers.
              </span>
            )}
          </span>
        </label>
        {error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm font-semibold text-red-700">{error}</p>
            {error.toLowerCase().includes("not signed in") && (
              <Link href="/login" className="btn-secondary mt-3 inline-flex px-3 py-1.5 text-sm">
                Sign in again
              </Link>
            )}
          </div>
        )}
        <button type="submit" className="btn-primary mt-5 hidden min-h-12 w-full disabled:cursor-not-allowed disabled:opacity-70 sm:block" disabled={isCreating || !!packetContextError}>
          {submitLabel}
        </button>
        {smsPhone && (
          <p className="mt-2 text-center text-xs text-slate-500">
            Uses cell {formatUsPhoneDisplay(smsPhone)} as the SMS destination.
          </p>
        )}
      </form>
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur sm:hidden"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <span className="min-w-[64px] text-center text-xs font-bold text-slate-600" aria-live="polite">
            {intakeReadiness.completedRequired}/{intakeReadiness.totalRequired}<br />ready
          </span>
          <button
            type="button"
            className="btn-primary min-h-12 flex-1 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isCreating || !!packetContextError}
            onClick={() => intakeReadiness.ready ? formRef.current?.requestSubmit() : focusFirstMissing()}
          >
            {intakeReadiness.ready ? submitLabel : intakeReadiness.title}
          </button>
        </div>
      </div>
    </main>
  );
}
