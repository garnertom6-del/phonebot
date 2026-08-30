"use client";
/**
 * The conversational client questionnaire. Renders the 34 sections from
 * mooreDivineQuestions.ts one at a time, saves progress after every section
 * (save-and-continue-later), supports Fast Intake (required sections first),
 * voice input on long answers, per-consent agreement, and one signature at
 * the end that the server applies to every agreed form.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS, ethnicityForRace, isClientQuestionVisible, questionCatalogId, questionVisibleInCatalog, usesStrongMenu, type Question, type Section } from "@/config/mooreDivineQuestions";
import { isQuestionRequired } from "@/lib/validation";
import { applyOperationalDefaults, applySkippedClientPlaceholders } from "@/lib/answerDefaults";
import { brandText, providerDisplayName, providerPhone } from "@/lib/providerBranding";
import { completedCopyDeliveryChannels } from "@/lib/clientCopyDelivery";
import VoiceInput from "./VoiceInput";
import SignaturePad from "./SignaturePad";
import ProgressBar from "./ProgressBar";
import IntakeOrientationAudio from "./IntakeOrientationAudio";
import ConsentAudio from "./ConsentAudio";

type Answers = Record<string, string | boolean | number | string[]>;

const UPLOAD_TYPES = [
  ["photo_id", "Photo ID"], ["birth_certificate", "Birth certificate"], ["insurance_card", "Health insurance card"],
  ["court_order", "Court order (if in DSS/guardian custody)"], ["ss_card", "Social Security card"],
  ["iep_records", "IEP / school records"], ["medication_list", "Medication list"],
  ["pcp_plan", "Person-Centered Plan"], ["immunization_records", "Immunization records"],
  ["standing_orders", "Physician standing orders"],
] as const;

export default function ClientQuestionnaire({ token, clientName, providerName, providerPhone: supportPhone, initialAnswers, initialStatus, signed, ccaAttestationReady = false, progressVersion = "initial", resignMode = null, reviewQuestionKeys = [] }: {
  token: string; clientName: string; providerName?: string; providerPhone?: string;
  initialAnswers: Answers; initialStatus: string;
  signed: { client?: boolean; guardian?: boolean };
  ccaAttestationReady?: boolean;
  progressVersion?: string;
  resignMode?: "assessment" | "record" | null;
  reviewQuestionKeys?: string[];
}) {
  const branding = { name: providerName, phone: supportPhone };
  const [answers, setAnswers] = useState<Answers>(() => applyOperationalDefaults(initialAnswers) as Answers);
  const [stepIdx, setStepIdx] = useState(0);
  const [progressRestored, setProgressRestored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<{ key: string; label: string }[]>([]);
  const [done, setDone] = useState(["SUBMITTED", "SIGNED", "COMPLETED"].includes(initialStatus));
  const [hasSignature, setHasSignature] = useState(!!(signed.client || signed.guardian));
  const [submitting, setSubmitting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<Record<string, string>>({});
  const isResign = initialStatus === "NEEDS_REVIEW" && !!resignMode;
  const isAssessmentResign = isResign && resignMode === "assessment" && ccaAttestationReady;
  const recordReviewKeys = useMemo(
    () => new Set(isResign && resignMode === "record" ? reviewQuestionKeys : []),
    [isResign, resignMode, reviewQuestionKeys],
  );
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const prefilledRef = useRef<Answers>({ ...applyOperationalDefaults(initialAnswers) as Answers });
  // what the server already has - saves send only the diff
  const savedRef = useRef<Answers>({ ...applyOperationalDefaults(initialAnswers) as Answers });
  const progressKey = `smart-intake-full-progress:v2:${token}:${progressVersion}:${resignMode || "initial"}:${reviewQuestionKeys.join(",")}`;

  const fastMode = answers.intake_mode === "Fast Intake - required questions first";
  const steps: Section[] = useMemo(() => {
    const catalogId = questionCatalogId(providerName);
    const visible = SECTIONS.map((section) => ({
      ...section,
      questions: section.questions.filter((question) => (
        questionVisibleInCatalog(question, catalogId)
        && (!isAssessmentResign || question.key === "consent_cca")
        && (!recordReviewKeys.size || recordReviewKeys.has(question.key))
        && (question.key !== "consent_cca" || ccaAttestationReady)
      )),
    })).filter((section) => section.questions.length);
    const base = isResign ? visible : fastMode ? visible.filter((s) => s.fastIntake) : visible;
    return [...base, { key: "__signature", title: "Signature & Submit", questions: [] }];
  }, [fastMode, providerName, ccaAttestationReady, isAssessmentResign, isResign, recordReviewKeys]);
  const step = steps[Math.min(stepIdx, steps.length - 1)];

  // Keep the current section when a phone briefly leaves the page for its camera.
  useEffect(() => {
    if (["SUBMITTED", "SIGNED", "COMPLETED"].includes(initialStatus)) {
      localStorage.removeItem(progressKey);
      setProgressRestored(true);
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(progressKey) || "null") as { stepIdx?: number } | null;
      if (saved) setStepIdx(Math.max(0, Math.min(Number(saved.stepIdx) || 0, Math.max(steps.length - 1, 0))));
    } catch {
      // Server autosave remains the source of truth if local storage is blocked.
    }
    setProgressRestored(true);
  }, [initialStatus, progressKey, steps.length]);

  useEffect(() => {
    if (!progressRestored) return;
    try {
      if (done) localStorage.removeItem(progressKey);
      else localStorage.setItem(progressKey, JSON.stringify({ stepIdx }));
    } catch {
      // This is only resume help; answers are still saved to the server.
    }
  }, [done, progressKey, progressRestored, stepIdx]);

  const visibleQuestions = (s: Section): Question[] =>
    s.questions.filter((q) =>
      recordReviewKeys.has(q.key)
        ? !q.staffOnly && q.type !== "info" && q.type !== "heading"
        : isClientQuestionVisible(q, answers, prefilledRef.current));

  const set = (key: string, value: Answers[string]) =>
    setAnswers((a) => {
      const next: Answers = { ...a, [key]: value };
      if (key === "race") {
        const ethnicity = ethnicityForRace(value);
        if (ethnicity) next.ethnicity = ethnicity;
      }
      if (key === "has_pcp" && value === "No") next.pcp_name = "I do not have a primary care";
      return next;
    });

  const save = useCallback(async (sectionKey?: string, event?: string): Promise<boolean> => {
    setSaving(true);
    const snapshot = answersRef.current;
    const changed: Answers = {};
    for (const [k, v] of Object.entries(snapshot)) {
      if (JSON.stringify(v) !== JSON.stringify(savedRef.current[k])) changed[k] = v;
    }
    if (!Object.keys(changed).length && !event) { setSaving(false); return true; }
    try {
      const res = await fetch(`/api/intake/${token}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: changed, section: sectionKey, event }),
      });
      if (!res.ok) throw new Error("Save failed");
      savedRef.current = { ...savedRef.current, ...changed };
      setSaveError("");
      return true;
    } catch {
      setSaveError("Not saved. Check connection.");
      return false;
    } finally { setSaving(false); }
  }, [token]);

  useEffect(() => {
    if (step && step.key !== "__signature") void save(step.key, "started");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx]);

  async function next() {
    setError("");
    for (const q of visibleQuestions(step)) {
      if (isQuestionRequired(q, answers)) {
        const v = answers[q.key];
        if (v === undefined || v === "" || (Array.isArray(v) && !v.length) || v === false) {
          setError(`Please answer: ${q.label}`);
          return;
        }
      }
    }
    const filled = applySkippedClientPlaceholders(answers) as Answers;
    if (filled !== answers) {
      setAnswers(filled);
      answersRef.current = filled;
    }
    const saved = await save(step.key, "completed");
    if (!saved) {
      setError("We could not save this page. Check your connection and try again.");
      return;
    }
    setStepIdx((i) => Math.min(i + 1, steps.length - 1));
    window.scrollTo(0, 0);
  }

  async function submit() {
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const saved = await save();
      if (!saved) {
        setError("We could not save your latest answers. Check your connection and try again.");
        return;
      }
      const res = await fetch(`/api/intake/${token}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { setDone(true); setMissing([]); }
      else { setError(body.error || "Could not submit"); setMissing(body.missing || []); }
    } catch {
      setError("We could not send your answers. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function captureSignature(role: "client" | "guardian",
    data: { imageData: string; printedName: string; relationship?: string; signedDate: string }) {
    if (isResign) {
      const saved = await save();
      if (!saved) {
        setError("We could not save your review. Check your connection and try again.");
        return;
      }
    }
    const relationship = data.relationship || (role === "guardian" ? "guardian" : "client");
    const res = await fetch(`/api/intake/${token}/signature`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, ...data, relationship }),
    });
    if (res.ok) {
      setHasSignature(true);
      setError("");
      if (isResign) setDone(true);
    }
    else setError((await res.json()).error || "Signature failed");
  }

  async function upload(docType: string, file: File) {
    const fd = new FormData();
    fd.set("file", file); fd.set("docType", docType);
    setUploadStatus((s) => ({ ...s, [docType]: "Uploading..." }));
    const res = await fetch(`/api/intake/${token}/upload`, { method: "POST", body: fd });
    setUploadStatus((s) => ({ ...s, [docType]: res.ok ? `Uploaded: ${file.name}` : "Upload failed" }));
  }

  const answeredCount = useMemo(() => {
    const catalogId = questionCatalogId(providerName);
    let total = 0, filled = 0;
    for (const s of SECTIONS) for (const q of s.questions) {
      if (!questionVisibleInCatalog(q, catalogId)) continue;
      if (!isClientQuestionVisible(q, answers, prefilledRef.current)) continue;
      total++;
      const v = answers[q.key];
      if (v !== undefined && v !== "" && !(Array.isArray(v) && !v.length)) filled++;
    }
    return total ? Math.round((filled / total) * 100) : 0;
  }, [answers, providerName]);

  if (done) {
    return (
      <div className="card mx-auto max-w-xl text-center">
          <p className="text-sm font-bold uppercase tracking-wide text-amber-700">Submitted - pending completion</p>
          <h2 className="mt-2 text-xl font-bold">Your part is saved, {clientName.split(" ")[0]}.</h2>
          <p className="mt-2 text-slate-600">
          {isAssessmentResign
            ? "Your updated assessment acknowledgment and signature were saved. Your provider can continue the review."
            : isResign
              ? "Your review and updated signature were saved. Your provider can continue the packet."
            : `${providerDisplayName(providerName)} got your answers. The care team will finish the CCA, required information, review, QP signature, and final packet before marking the intake completed.`}
          </p>
        {!isResign && (
          <p className="mt-4 rounded-xl bg-sky-50 p-4 text-sm font-semibold text-sky-900">
            When it is completed, your secure copy link will be sent by {completedCopyDeliveryChannels(answers).label} when that contact information is available.
          </p>
        )}
        <a className="btn-secondary mt-5 min-h-[56px] w-full text-base" href={`/rights/${token}`}>
          View or save my rights &amp; privacy
        </a>
        <p className="mt-4 text-sm text-slate-500">Questions? Call {providerPhone(supportPhone, providerName)}.</p>
        </div>
      );
  }

  return (
    <div className="mx-auto max-w-2xl pb-28">
      <ProgressBar percent={answeredCount}
        label={brandText(`You are ${answeredCount}% complete - Step ${stepIdx + 1} of ${steps.length}: ${step.title}`, branding)} />

      <div className="card mt-4">
        <h2 className="text-lg font-bold text-brand">{brandText(step.title, branding)}</h2>
        {step.intro && <p className="mt-1 text-sm text-slate-600">{brandText(step.intro, branding)}</p>}

        {step.key === "basic" && (
          <details className="mt-4 rounded-lg border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-600">
              Have documents handy? Upload photos of them (optional)
            </summary>
            <div className="mt-3 space-y-2">
              {UPLOAD_TYPES.map(([type, label]) => (
                <div key={type} className="flex items-center justify-between gap-2 text-sm">
                  <span>{label}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-emerald-600">{uploadStatus[type]}</span>
                    <label className="btn-ghost cursor-pointer px-2 py-1 text-xs">
                      Upload
                      <input type="file" className="hidden" accept="image/*,.pdf"
                        onChange={(e) => e.target.files?.[0] && upload(type, e.target.files[0])} />
                    </label>
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}

        {stepIdx === 0 && <IntakeOrientationAudio providerName={providerName} providerPhone={supportPhone} compact />}

        <div className="mt-4 space-y-5">
          {visibleQuestions(step).map((q) => <QuestionField key={q.key} q={q} answers={answers} set={set} providerName={providerName} providerPhone={supportPhone} />)}
        </div>

        {step.key === "__signature" && (
          <SignatureStep answers={answers} hasSignature={hasSignature} submitting={submitting}
            onCapture={captureSignature} onSubmit={submit} missing={missing} />
        )}
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}

      <div
        className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-2xl gap-3">
          <button className="btn-secondary w-28" disabled={stepIdx === 0}
            onClick={() => { setStepIdx((i) => i - 1); window.scrollTo(0, 0); }}>Back</button>
          <SaveIndicator saving={saving} saveError={saveError} onRetry={() => { void save(step.key); }} />
          {step.key !== "__signature" && (
            <button className="btn-primary flex-1" onClick={next}>
              {stepIdx === 0 ? "Start" : "Save & Continue"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionField({ q, answers, set, providerName, providerPhone: supportPhone }: {
  q: Question; answers: Answers; set: (k: string, v: Answers[string]) => void;
  providerName?: string; providerPhone?: string;
}) {
  const branding = { name: providerName, phone: supportPhone };
  const v = answers[q.key];
  if (q.type === "consent" && q.key === "consent_tailored_plan") {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="font-semibold">{brandText(q.label, branding)}</p>
        <details className="mt-1 rounded-lg border border-brand/30 bg-white p-2">
          <summary className="cursor-pointer text-sm font-bold text-brand">Tap to read the full text</summary>
          <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{brandText(q.consentText, branding)}</p>
        </details>
        <div className="mt-2">
          <ConsentAudio text={q.consentText} providerName={providerName} providerPhone={supportPhone} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={`chip ${v === true ? "chip-on" : ""}`} onClick={() => set(q.key, true)}>
            Yes, help me ask about plan options
          </button>
          <button type="button" className={`chip ${v === false ? "chip-on" : ""}`} onClick={() => set(q.key, false)}>
            No, do not ask to change my plan
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">If we cannot provide the service under your insurance, staff will explain and offer a referral to a provider that accepts your plan.</p>
      </div>
    );
  }
  if (q.type === "consent") {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="font-semibold">{brandText(q.label, branding)}</p>
        <details className="mt-1 rounded-lg border border-brand/30 bg-white p-2">
          <summary className="cursor-pointer text-sm font-bold text-brand">Tap to read the full text</summary>
          <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{brandText(q.consentText, branding)}</p>
        </details>
        <div className="mt-2">
          <ConsentAudio text={q.consentText} providerName={providerName} providerPhone={supportPhone} />
        </div>
        <label className="mt-3 flex items-center gap-3 text-sm font-semibold">
          <input type="checkbox" className="h-5 w-5" checked={v === true}
            onChange={(e) => set(q.key, e.target.checked)} />
          I agree and consent to sign this form{q.required && <span className="text-red-500">*</span>}
        </label>
      </div>
    );
  }
  const label = (
      <label className="label">
        {brandText(q.label, branding)} {q.required && <span className="text-red-500">*</span>}
        {q.help && <span className="block font-normal text-xs text-slate-400">{brandText(q.help, branding)}</span>}
      </label>
    );
  if (q.type === "radio" || q.type === "yesno") {
    const options = q.options || [];
    if (usesStrongMenu(q)) {
      return (
        <div>{label}
          <p className="mb-2 rounded-2xl bg-amber-50 p-3 text-base font-extrabold text-amber-950">Tap the big menu button to pick one answer.</p>
          <div className="relative">
            <select
              aria-label={brandText(q.label, branding)}
              className="min-h-[72px] w-full appearance-none rounded-2xl border-4 border-brand bg-white px-4 pr-14 text-xl font-black text-brand shadow-lg"
              value={String(v ?? "")}
              onChange={(e) => set(q.key, e.target.value)}
            >
              <option value="">Tap here to choose…</option>
              {options.map((opt) => <option key={opt} value={opt}>{brandText(opt, branding)}</option>)}
            </select>
            <span aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-3xl font-black text-brand">▾</span>
          </div>
        </div>
      );
    }
    return (
      <div>{label}
        <div className="flex flex-wrap gap-2">
          {options.map((opt) => (
            <button key={opt} type="button" onClick={() => set(q.key, opt)} aria-pressed={v === opt}
              className={`chip ${v === opt ? "chip-on" : ""}`}>{opt}</button>
          ))}
        </div>
      </div>
    );
  }
  if (q.type === "chips") {
    const arr = Array.isArray(v) ? v : [];
    return (
      <div>{label}
        <div className="flex flex-wrap gap-2">
          {(q.options || []).map((opt) => (
            <button key={opt} type="button" aria-pressed={arr.includes(opt)}
              onClick={() => set(q.key, arr.includes(opt) ? arr.filter((x) => x !== opt) : [...arr, opt])}
              className={`chip ${arr.includes(opt) ? "chip-on" : ""}`}>{opt}</button>
          ))}
        </div>
      </div>
    );
  }
  if (q.type === "survey") {
    return (
      <div>{label}
        <div className="flex gap-2">
          {["1", "2", "3"].map((n) => (
            <button key={n} type="button" onClick={() => set(q.key, n)}
              className={`chip w-12 justify-center ${v === n ? "chip-on" : ""}`}>{n}</button>
          ))}
        </div>
      </div>
    );
  }
  if (q.type === "date") {
    return (
      <div>{label}
        <input type="date" className="input max-w-[240px]" value={String(v ?? "")}
          onChange={(e) => set(q.key, e.target.value)} />
      </div>
    );
  }
  const multiline = q.type === "textarea";
  return (
    <div>{label}
      {q.contactPicker && (
        <p className="mb-2 text-xs text-slate-500">You can type or speak. Optional: pick one person from your phone if your phone offers it.</p>
      )}
      {q.voice ? (
        <VoiceInput value={String(v ?? "")} onChange={(x) => set(q.key, x)} multiline={multiline}
          placeholder={q.placeholder}
          inputMode={q.type === "phone" ? "tel" : q.type === "email" ? "email" : "text"} />
      ) : multiline ? (
        <textarea className="input min-h-[110px]" value={String(v ?? "")} placeholder={q.placeholder}
          onChange={(e) => set(q.key, e.target.value)} />
      ) : (
        <input className="input" value={String(v ?? "")} placeholder={q.placeholder}
          type={q.type === "email" ? "email" : q.type === "phone" ? "tel" : "text"}
          onChange={(e) => set(q.key, e.target.value)} />
      )}
    </div>
  );
}

function SignatureStep({ answers, hasSignature, submitting, onCapture, onSubmit, missing }: {
  answers: Answers; hasSignature: boolean; submitting: boolean;
  onCapture: (role: "client" | "guardian", d: { imageData: string; printedName: string; relationship?: string; signedDate: string }) => Promise<void>;
  onSubmit: () => void; missing: { key: string; label: string }[];
}) {
  const isMinor = answers.is_minor_or_incompetent === "Yes";
  const [signedRoles, setSignedRoles] = useState<string[]>([]);
  const consentCount = Object.keys(answers).filter((k) => k.startsWith("consent_") && answers[k] === true).length;

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-600">
        You sign <b>once</b> below. Your signature and initials are applied only to the{" "}
        <b>{consentCount} form(s) you agreed to</b> - on paper you would sign about 15 separate times.
      </p>
      {!hasSignature || signedRoles.length === 0 ? (
        <SignaturePad roleLabel={isMinor ? "Parent / Legal Guardian signature" : "Client signature"}
          expectedRole={isMinor ? "guardian" : "client"}
          defaultName={String((isMinor ? answers.guardian_name : answers.client_full_name) ?? "")}
          askDob
          onCapture={async (d) => {
            const relationship = d.relationship || "client";
            const role = isMinor || ["parent", "guardian", "legalRepresentative"].includes(relationship)
              ? "guardian" : "client";
            await onCapture(role, { ...d, relationship });
            setSignedRoles((r) => [...r, role]);
          }} />
      ) : (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
          Signature captured ({signedRoles.join(", ") || "on file"})
        </p>
      )}
      {isMinor && signedRoles.includes("guardian") && !signedRoles.includes("client") && (
        <details className="rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-semibold">Client also signing? (optional)</summary>
          <div className="mt-3">
            <SignaturePad roleLabel="Client signature" defaultName={String(answers.client_full_name ?? "")}
              expectedRole="client" askDob
              onCapture={async (d) => { await onCapture("client", { ...d, relationship: d.relationship || "client" }); setSignedRoles((r) => [...r, "client"]); }} />
          </div>
        </details>
      )}
      {missing.length > 0 && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <p className="font-bold">Still needed before you can submit:</p>
          <ul className="list-inside list-disc">{missing.map((m) => <li key={m.key}>{m.label}</li>)}</ul>
        </div>
      )}
      <button className="btn-primary w-full" disabled={submitting || (!hasSignature && signedRoles.length === 0)} onClick={onSubmit}>
        {submitting ? "Sending..." : "Send my answers"}
      </button>
    </div>
  );
}

function SaveIndicator({ saving, saveError, onRetry }: {
  saving: boolean;
  saveError: string;
  onRetry: () => void;
}) {
  if (saving) return <span className="flex items-center text-xs text-slate-400">Saving...</span>;
  if (saveError) {
    return (
      <button type="button" className="btn-ghost px-3 py-1.5 text-xs text-red-700" onClick={onRetry}>
        Retry save
      </button>
    );
  }
  return <span className="flex items-center text-xs text-slate-400">Progress saved</span>;
}
