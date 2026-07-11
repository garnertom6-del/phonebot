"use client";
/**
 * EasyQuestionnaire - an ultra-simple ONE-question-at-a-time intake for
 * vulnerable clients (5th-grade reading level). One big question per screen,
 * giant tap targets, plain words from easyLanguage.ts, voice input on long
 * answers, auto-save after every answer, encouragement screens between
 * sections, one signature at the end.
 *
 * Drop-in replacement for ClientQuestionnaire (identical props).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SECTIONS, isQuestionPrefilledForClient, isQuickIntakeQuestion, type Question } from "@/config/mooreDivineQuestions";
import { EASY, SECTION_INTROS, ENCOURAGEMENTS } from "@/config/easyLanguage";
import { askIfSatisfied } from "@/lib/validation";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { brandText, intakeProcessExplanation, providerDisplayName, providerPhone } from "@/lib/providerBranding";
import VoiceInput from "./VoiceInput";
import SignaturePad from "./SignaturePad";
import ProgressBar from "./ProgressBar";

type Answers = Record<string, string | boolean | number | string[]>;
type Phase = "welcome" | "question" | "break" | "photos" | "signature" | "done";

interface FlatQ { q: Question; sectionKey: string; sectionTitle: string }

/** Plain-language helpers (fall back to the original packet wording). */
const easyQ = (q: Question, providerName?: string, supportPhone?: string) =>
  brandText(EASY[q.key]?.q ?? q.label, { name: providerName, phone: supportPhone });
const easyHelp = (q: Question, providerName?: string, supportPhone?: string) =>
  brandText(EASY[q.key]?.help ?? q.help, { name: providerName, phone: supportPhone });
const easyOpt = (q: Question, opt: string, providerName?: string, supportPhone?: string) =>
  brandText(EASY[q.key]?.options?.[opt] ?? opt, { name: providerName, phone: supportPhone });

const SURVEY_OPTIONS = ["1", "2", "3"];

function flattenVisible(answers: Answers, prefilledAnswers: Answers, quick: boolean): FlatQ[] {
  const out: FlatQ[] = [];
  for (const s of SECTIONS) {
    if (s.key === "welcome") continue; // Easy Mode IS the mode - no intake_mode question
    for (const q of s.questions) {
      if (q.staffOnly || q.type === "info" || q.type === "heading") continue;
      // Quick Intake: only the essentials + consents; the clinician's CCA
      // fills the rest after upload by staff.
      if (quick && !isQuickIntakeQuestion(q)) continue;
      if (quick && q.key === "client_phone_home") continue;
      if (!askIfSatisfied(q.askIf, answers)) continue;
      if (isQuestionPrefilledForClient(q, prefilledAnswers)) continue;
      out.push({ q, sectionKey: s.key, sectionTitle: s.title });
    }
  }
  return out;
}

function isAnswered(v: Answers[string] | undefined): boolean {
  return v !== undefined && v !== "" && v !== false && !(Array.isArray(v) && !v.length);
}

// answers that control whether OTHER questions appear - the visible-question
// list only needs recomputing when one of these changes, not on every keystroke
const GATE_KEYS: string[] = [...new Set(
  SECTIONS.flatMap((s) => s.questions.map((q) => q.askIf?.key).filter((k): k is string => !!k)))];

export default function EasyQuestionnaire({ token, clientName, providerName, providerPhone: supportPhone, initialAnswers, initialStatus, signed, quick = false }: {
  token: string; clientName: string; providerName?: string; providerPhone?: string; initialAnswers: Answers; initialStatus: string;
  signed: { client?: boolean; guardian?: boolean }; quick?: boolean;
}) {
  const branding = { name: providerName, phone: supportPhone };
  const [answers, setAnswers] = useState<Answers>(() => applyOperationalDefaults(initialAnswers) as Answers);
  const [phase, setPhase] = useState<Phase>(
    ["SUBMITTED", "SIGNED", "COMPLETED"].includes(initialStatus) ? "done" : "welcome");
  const [idx, setIdx] = useState(0);
  const [breakText, setBreakText] = useState("");
  const [justPicked, setJustPicked] = useState<string | null>(null);
  const [nudge, setNudge] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [missing, setMissing] = useState<{ key: string; label: string }[]>([]);
  const [hasSignature, setHasSignature] = useState(!!(signed.client || signed.guardian));

  const gateFingerprint = JSON.stringify(GATE_KEYS.map((k) => answers[k]));
  const prefilledRef = useRef<Answers>({ ...applyOperationalDefaults(initialAnswers) as Answers });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const flat = useMemo(() => flattenVisible(answers, prefilledRef.current, quick), [gateFingerprint, quick]);

  // Refs so timers (auto-advance) always see the latest state.
  const answersRef = useRef(answers); answersRef.current = answers;
  const flatRef = useRef(flat); flatRef.current = flat;
  const idxRef = useRef(idx); idxRef.current = idx;
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const breakCount = useRef(0);
  // what the server already has - autosaves send only the diff, not all 200+ answers
  const savedRef = useRef<Answers>({ ...applyOperationalDefaults(initialAnswers) as Answers });

  useEffect(() => () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const cur = flat[Math.min(idx, Math.max(flat.length - 1, 0))];
  const answeredCount = flat.filter((f) => isAnswered(answers[f.q.key])).length;
  const percent = flat.length ? Math.round((answeredCount / flat.length) * 100) : 0;
  const firstName = clientName.split(" ")[0] || "there";

  /* ------------------------------ saving ------------------------------ */

  const saveNow = useCallback(async (event?: "started" | "completed"): Promise<boolean> => {
    setSaving(true);
    // send only answers that changed since the last successful save
    const snapshot = answersRef.current;
    const changed: Answers = {};
    for (const [k, v] of Object.entries(snapshot)) {
      if (JSON.stringify(v) !== JSON.stringify(savedRef.current[k])) changed[k] = v;
    }
    if (!Object.keys(changed).length && !event) { setSaving(false); return true; }
    try {
      const res = await fetch(`/api/intake/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: changed,
          section: flatRef.current[idxRef.current]?.sectionKey,
          event,
        }),
      });
      if (res.status === 404) {
        // the link expired mid-session - tell the client what to do, not "check connection"
        const body = await res.json().catch(() => ({} as { error?: string }));
        setSaveError(body.error || `This link has stopped working. Please call ${providerPhone(supportPhone)} and we will text you a new one.`);
        return false;
      }
      if (!res.ok) throw new Error("Save failed");
      savedRef.current = { ...savedRef.current, ...changed };
      setSaveError("");
      return true;
    } catch {
      setSaveError("Not saved. Check connection.");
      return false;
    }
    finally { setSaving(false); }
  }, [token]);

  const queueSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void saveNow(); }, 800);
  }, [saveNow]);

  const set = useCallback((key: string, value: Answers[string]) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setNudge("");
    setSaveError("");
    queueSave();
  }, [queueSave]);

  /* ---------------------------- navigation ---------------------------- */

  const goNext = useCallback(() => {
    const list = flatRef.current;
    const i = idxRef.current;
    const nextIdx = i + 1;
    setJustPicked(null);
    setNudge("");
    if (nextIdx >= list.length) { void saveNow("completed"); setPhase("photos"); return; }
    const here = list[i];
    const next = list[nextIdx];
    setIdx(nextIdx);
    if (here && next.sectionKey !== here.sectionKey) {
      const cheer = ENCOURAGEMENTS.length
        ? ENCOURAGEMENTS[breakCount.current % ENCOURAGEMENTS.length]
        : "Nice work! Keep going.";
      breakCount.current += 1;
      setBreakText(brandText(SECTION_INTROS[next.sectionKey] ?? cheer, branding));
      setPhase("break");
    } else {
      setPhase("question");
    }
    window.scrollTo(0, 0);
  }, [branding, saveNow]);

  const goBack = useCallback(() => {
    setJustPicked(null);
    setNudge("");
    if (phase === "signature") {
      setIdx(Math.max(flatRef.current.length - 1, 0));
      setPhase("question");
    } else if (idxRef.current <= 0) {
      setPhase("welcome");
    } else {
      setIdx(idxRef.current - 1);
      setPhase("question");
    }
    window.scrollTo(0, 0);
  }, [phase]);

  /** Tap an answer -> brief highlight, then move to the next question. */
  const pickAndAdvance = useCallback((key: string, value: Answers[string], display: string) => {
    set(key, value);
    setJustPicked(display);
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(goNext, 350);
  }, [set, goNext]);

  const nextFromInput = useCallback(() => {
    const q = flatRef.current[idxRef.current]?.q;
    if (q?.required && !isAnswered(answersRef.current[q.key])) {
      setNudge("Please answer this one - we really need it.");
      return;
    }
    goNext();
  }, [goNext]);

  // Encouragement screens auto-advance after 1.2s (or tap to continue).
  useEffect(() => {
    if (phase !== "break") return;
    const t = setTimeout(() => setPhase("question"), 1200);
    return () => clearTimeout(t);
  }, [phase, breakText]);

  // Safety net: if there is somehow nothing left to ask, go to signing.
  useEffect(() => {
    if (phase === "question" && flat.length === 0) setPhase("photos");
  }, [phase, flat.length]);

  /* --------------------------- submit / sign -------------------------- */

  const isGuardian = answers.is_minor_or_incompetent === "Yes";
  const signRole: "client" | "guardian" = isGuardian ? "guardian" : "client";
  const signDefaultName = String(
    (isGuardian ? answers.guardian_name : answers.client_full_name) ?? clientName ?? "");

  async function captureSignature(d: { imageData: string; printedName: string; relationship?: string; signedDate: string; dobCheck?: string }) {
    setSubmitError("");
    const relationship = d.relationship || (signRole === "guardian" ? "guardian" : "client");
    const res = await fetch(`/api/intake/${token}/signature`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: signRole, ...d, relationship }),
    });
    if (res.ok) setHasSignature(true);
    else setSubmitError((await res.json()).error || "The signature did not save. Please try again.");
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError("");
    setMissing([]);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const saved = await saveNow();
      if (!saved) {
        setSubmitError("We could not save your latest answers. Check your connection and try again.");
        return;
      }
      const res = await fetch(`/api/intake/${token}`, { method: "POST" });
      const body = await res.json();
      if (res.ok) { setPhase("done"); }
      else {
        setSubmitError(body.error || "We could not send your answers yet.");
        setMissing(body.missing || []);
      }
    } catch {
      setSubmitError("Something went wrong. Check your connection and try again.");
    } finally { setSubmitting(false); }
  }

  function jumpToFirstMissing() {
    const first = missing.find((m) => flatRef.current.some((f) => f.q.key === m.key));
    if (!first) return;
    const i = flatRef.current.findIndex((f) => f.q.key === first.key);
    setIdx(i);
    setMissing([]);
    setSubmitError("");
    setPhase("question");
    window.scrollTo(0, 0);
  }

  /* ------------------------------ screens ----------------------------- */

  if (phase === "done") {
    return (
      <div className="card mx-auto mt-10 max-w-md text-center">
          <p className="text-sm font-bold uppercase tracking-wide text-emerald-600">All set</p>
          <h2 className="mt-4 text-3xl font-bold text-brand">You did it!</h2>
          <p className="mt-4 text-xl text-slate-600">
          {providerDisplayName(providerName)} got your answers. We will call you soon.
          </p>
        <p className="mt-6 text-base text-slate-400">Questions? Call {providerPhone(supportPhone)}.</p>
        </div>
      );
  }

  if (phase === "welcome") {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center text-center">
        <h2 className="mt-6 text-3xl font-bold text-brand">Hi {firstName}!</h2>
        <p className="mt-5 text-xl leading-relaxed text-slate-700">
          {intakeProcessExplanation(providerName)}
        </p>
        <p className="mt-3 text-lg leading-relaxed text-slate-500">
          You can speak or tap to answer. Your answers save as you go.
        </p>
        <button type="button" className="btn-primary mt-10 min-h-[72px] w-full text-2xl"
          onClick={() => { void saveNow("started"); setIdx(0); setPhase("question"); }}>
          Start
        </button>
      </div>
    );
  }

  if (phase === "break") {
    return (
      <button type="button" onClick={() => setPhase("question")}
        className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center text-center">
        <span className="text-2xl font-bold leading-relaxed text-brand">{breakText}</span>
        <span className="mt-6 text-base text-slate-400">Tap anywhere to keep going</span>
      </button>
    );
  }

  if (phase === "photos") {
    return (
      <div className="mx-auto max-w-md pb-28">
        <ProgressBar percent={100} label="Almost done!" />
        <h2 className="mt-6 text-3xl font-bold leading-snug text-brand">Two quick photos</h2>
        <p className="mt-3 text-xl leading-relaxed text-slate-600">
          If you have them handy, snap a photo of your insurance card and your ID.
          It&apos;s okay to skip this - we can get them later.
        </p>
        <div className="mt-6 space-y-4">
          <PhotoUpload token={token} docType="insurance_card" label="📷 My insurance card" />
          <PhotoUpload token={token} docType="photo_id" label="📷 My photo ID" />
        </div>
        <button type="button" className="btn-primary mt-8 min-h-[64px] w-full text-xl"
          onClick={() => setPhase("signature")}>
          Next: sign my name
        </button>
      </div>
    );
  }

  if (phase === "signature") {
    return (
      <div className="mx-auto max-w-md pb-28">
        <ProgressBar percent={100} label="Last step!" />
        <h2 className="mt-6 text-3xl font-bold leading-snug text-brand">One last thing</h2>
        <p className="mt-3 text-xl leading-relaxed text-slate-600">
          Sign your name with your finger in the box.
        </p>
        <div className="mt-4">
          {hasSignature ? (
            <p className="rounded-xl bg-emerald-50 p-4 text-lg font-semibold text-emerald-700">
              Signature saved. Thank you!
            </p>
          ) : (
            <SignaturePad
              roleLabel={isGuardian ? "Parent or guardian signs here" : "Sign here"}
              expectedRole={signRole}
              defaultName={signDefaultName}
              askDob
              onCapture={(d) => { void captureSignature(d); }} />
          )}
        </div>

        {submitError && (
          <div className="mt-4 rounded-xl bg-red-50 p-4 text-red-700">
            <p className="text-lg font-bold">{missing.length > 0 ? "We still need a few things:" : "We could not send your answers."}</p>
            {missing.length > 0 ? (
              <ul className="mt-2 list-inside list-disc space-y-1 text-base">
                {missing.map((m) => {
      const q = flat.find((f) => f.q.key === m.key)?.q;
      return <li key={m.key}>{q ? easyQ(q, providerName, supportPhone) : brandText(m.label, branding)}</li>;
                })}
              </ul>
            ) : <p className="mt-1 text-base">{submitError}</p>}
            {missing.some((m) => flat.some((f) => f.q.key === m.key)) && (
              <button type="button" className="btn-secondary mt-3 min-h-[56px] w-full text-lg"
                onClick={jumpToFirstMissing}>
                Take me to the first one
              </button>
            )}
          </div>
        )}

        <button type="button" className="btn-primary mt-6 min-h-[72px] w-full text-2xl"
          disabled={!hasSignature || submitting} onClick={() => { void submit(); }}>
          {submitting ? "Sending..." : "Send my answers"}
        </button>
        {!hasSignature && (
          <p className="mt-2 text-center text-base text-slate-400">Sign in the box first, then you can send.</p>
        )}

        <div
          className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-3"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <div className="mx-auto flex max-w-md items-center gap-3">
            <button type="button" className="btn-secondary min-h-[56px] flex-1 text-lg" onClick={goBack}>
              Back
            </button>
            <SaveIndicator saving={saving} saveError={saveError} onRetry={() => { void saveNow(); }} />
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------- question screen ------------------------ */

  if (!cur) return null; // effect above redirects to the signature step
  const q = cur.q;

  return (
    <div className="mx-auto max-w-md pb-32">
      <ProgressBar percent={percent} label={`Question ${idx + 1} of ${flat.length} - ${percent}% done`} />

      <div className="mt-8">
        <h2 className="text-2xl font-bold leading-snug text-slate-800 sm:text-3xl">{easyQ(q, providerName, supportPhone)}</h2>
        {easyHelp(q, providerName, supportPhone) && <p className="mt-3 text-lg leading-relaxed text-slate-500">{easyHelp(q, providerName, supportPhone)}</p>}
      </div>

      <div className="mt-6">
        <AnswerWidget key={q.key} q={q} value={answers[q.key]} justPicked={justPicked}
          set={set} pickAndAdvance={pickAndAdvance} onNext={nextFromInput}
          providerName={providerName} providerPhone={supportPhone} />
      </div>

      {nudge && (
        <p className="mt-4 rounded-xl bg-amber-50 p-4 text-lg font-semibold text-amber-700">{nudge}</p>
      )}

      <div
        className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white p-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex max-w-md items-center gap-3">
          <button type="button" className="btn-secondary min-h-[56px] flex-1 text-lg" onClick={goBack}>
            Back
          </button>
          <SaveIndicator saving={saving} saveError={saveError} onRetry={() => { void saveNow(); }} />
          {!q.required && (
            <button type="button" className="btn-ghost px-4 py-2 text-sm text-slate-500" onClick={goNext}>
              Skip
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ saving, saveError, onRetry }: {
  saving: boolean;
  saveError: string;
  onRetry: () => void;
}) {
  if (saving) return <span className="min-w-[76px] text-center text-xs text-slate-400">Saving...</span>;
  if (saveError) {
    return (
      <button type="button" className="btn-ghost min-h-[44px] min-w-[92px] px-3 text-xs text-red-700" onClick={onRetry}>
        Retry save
      </button>
    );
  }
  return <span className="min-w-[76px] text-center text-xs text-slate-400">Saved</span>;
}

/* ------------------------------------------------------------------ */
/*  One big answer widget per question type                            */
/* ------------------------------------------------------------------ */

function AnswerWidget({ q, value, justPicked, set, pickAndAdvance, onNext, providerName, providerPhone: supportPhone }: {
  q: Question;
  value: Answers[string] | undefined;
  justPicked: string | null;
  set: (key: string, v: Answers[string]) => void;
  pickAndAdvance: (key: string, v: Answers[string], display: string) => void;
  onNext: () => void;
  providerName?: string;
  providerPhone?: string;
}) {
  /* ---- consent: friendly summary + full text + agree/skip ---- */
  if (q.type === "consent") {
    const simple = brandText(
      EASY[q.key]?.consentSimple ?? `This form is called "${q.label}". Please read the whole form below before you agree.`,
      { name: providerName, phone: supportPhone },
    );
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-brand/20 bg-brand-light p-5">
          <p className="text-xl leading-relaxed text-slate-800">{simple}</p>
          {value === true && <p className="mt-3 text-lg font-bold text-emerald-600">You said yes to this.</p>}
        </div>
        <details className="rounded-xl border border-slate-200 p-4">
          <summary className="cursor-pointer text-base font-semibold text-brand">Read the whole form</summary>
          <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-slate-600">{brandText(q.consentText, { name: providerName, phone: supportPhone })}</p>
        </details>
        <button type="button"
          className={`btn-primary min-h-[64px] w-full text-xl ${justPicked === "yes" ? "ring-4 ring-emerald-300" : ""}`}
          onClick={() => pickAndAdvance(q.key, true, "yes")}>
          Yes, I understand and agree
        </button>
        {q.required ? (
          <p className="rounded-xl bg-amber-50 p-4 text-base font-semibold text-amber-800">
            Need help before you agree? Call {providerDisplayName(providerName)} at {providerPhone(supportPhone)}.
          </p>
        ) : (
          <button type="button" className="btn-ghost min-h-[56px] w-full text-lg text-slate-600"
            onClick={() => pickAndAdvance(q.key, "", "skip")}>
            Skip this one for now
          </button>
        )}
      </div>
    );
  }

  /* ---- radio / yesno / survey: big tap buttons, auto-advance ---- */
  if (q.type === "radio" || q.type === "yesno" || q.type === "survey") {
    const options = q.options && q.options.length ? q.options : SURVEY_OPTIONS;
    return (
      <div className="space-y-3">
        {options.length > 6 && (
          <div className="mb-4">
            <p className="mb-2 text-base text-slate-500">Tap your answer below, or pick from this list:</p>
            <select className="input min-h-[56px] text-lg" value={String(value ?? "")}
              onChange={(e) => { if (e.target.value) pickAndAdvance(q.key, e.target.value, e.target.value); }}>
              <option value="">Choose one...</option>
              {options.map((opt) => (
                  <option key={opt} value={opt}>{easyOpt(q, opt, providerName, supportPhone)}</option>
              ))}
            </select>
          </div>
        )}
        {options.map((opt) => {
          const on = value === opt || justPicked === opt;
          return (
            <button key={opt} type="button"
              aria-pressed={on}
              onClick={() => pickAndAdvance(q.key, opt, opt)}
              className={`block min-h-[56px] w-full rounded-2xl border-2 px-5 py-3 text-left text-lg font-semibold transition
                ${on ? "border-brand bg-brand text-white shadow-md" : "border-slate-300 bg-white text-slate-800 hover:border-brand"}
                ${justPicked === opt ? "scale-[0.98] ring-4 ring-brand/30" : ""}`}>
              {easyOpt(q, opt, providerName, supportPhone)}
            </button>
          );
        })}
      </div>
    );
  }

  /* ---- chips: multi-select toggles + Done button ---- */
  if (q.type === "chips") {
    const arr = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-3">
        <p className="text-base text-slate-500">You can pick more than one.</p>
        {(q.options || []).map((opt) => {
          const on = arr.includes(opt);
          return (
            <button key={opt} type="button"
              aria-pressed={on}
              onClick={() => set(q.key, on ? arr.filter((x) => x !== opt) : [...arr, opt])}
              className={`block min-h-[56px] w-full rounded-2xl border-2 px-5 py-3 text-left text-lg font-semibold transition
                ${on ? "border-brand bg-brand text-white shadow-md" : "border-slate-300 bg-white text-slate-800 hover:border-brand"}`}>
              {on ? "Selected: " : ""}{easyOpt(q, opt, providerName, supportPhone)}
            </button>
          );
        })}
        <button type="button" className="btn-primary mt-2 min-h-[64px] w-full text-xl" onClick={onNext}>
          Done - Next
        </button>
      </div>
    );
  }

  /* ---- date ---- */
  if (q.type === "date") {
    return (
      <div className="space-y-4">
        <input type="date" className="input min-h-[64px] text-xl" value={String(value ?? "")}
          onChange={(e) => set(q.key, e.target.value)} />
        <button type="button" className="btn-primary min-h-[64px] w-full text-xl" onClick={onNext}>
          Next
        </button>
      </div>
    );
  }

  /* ---- text / textarea / phone / email / number ---- */
  const multiline = q.type === "textarea";
  const inputMode = q.type === "phone" ? "tel" : q.type === "email" ? "email" : "text";
  return (
    <div className="space-y-4">
      {q.voice || multiline ? (
        <VoiceInput value={String(value ?? "")} onChange={(x) => set(q.key, x)}
          multiline={multiline} placeholder={q.placeholder} inputMode={inputMode} />
      ) : (
        <input
          className="input min-h-[64px] text-xl"
          type={q.type === "email" ? "email" : q.type === "phone" ? "tel" : "text"}
          inputMode={q.type === "number" ? "numeric" : undefined}
          value={String(value ?? "")} placeholder={q.placeholder}
          onChange={(e) => set(q.key, e.target.value)} />
      )}
      <button type="button" className="btn-primary min-h-[64px] w-full text-xl" onClick={onNext}>
        Next
      </button>
    </div>
  );
}

/** Big-button photo upload for the client link (camera opens on phones). */
function PhotoUpload({ token, docType, label }: { token: string; docType: string; label: string }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <label className={`flex min-h-[64px] w-full cursor-pointer items-center justify-between rounded-xl border-2 px-4 text-xl font-semibold ${status.startsWith("Got") ? "border-emerald-400 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-white text-brand"}`}>
      <span>{busy ? "Sending..." : status || label}</span>
      {status.startsWith("Got") && <span>✓</span>}
      <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          const fd = new FormData();
          fd.set("file", file); fd.set("docType", docType);
          const r = await fetch(`/api/intake/${token}/upload`, { method: "POST", body: fd });
          setBusy(false);
          setStatus(r.ok ? "Got it! Thank you" : "That didn't work - try again or skip");
        }} />
    </label>
  );
}
