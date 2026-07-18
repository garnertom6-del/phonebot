"use client";
/**
 * Staff review/edit screen: every client answer plus all staff-only fields
 * (page-1 checklist, screening, clinical, PCP collaboration, discharge
 * summary), and staff-side signature capture.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SECTIONS, STAFF_FIELDS, type Question } from "@/config/mooreDivineQuestions";
import { askIfSatisfied } from "@/lib/validation";
import SignaturePad from "@/components/SignaturePad";

type Answers = Record<string, string | boolean | number | string[]>;
type StaffSignatureRole = "staff" | "clinician" | "witness" | "medicalDirector";
type SignatureRecord = { role: string; printedName: string; signedDate: string };

const SIGNER_OPTIONS: { role: StaffSignatureRole; label: string; padLabel: string }[] = [
  { role: "staff", label: "QP / Qualified Professional", padLabel: "QP / Qualified Professional signature" },
  { role: "clinician", label: "Clinician", padLabel: "Clinician signature" },
  { role: "witness", label: "Witness", padLabel: "Witness signature" },
  { role: "medicalDirector", label: "Medical director", padLabel: "Medical director signature" },
];
const CARE_TEAM_ROLES: StaffSignatureRole[] = ["staff", "clinician", "witness"];

export default function ReviewPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>({});
  const [clientName, setClientName] = useState("");
  const [note, setNote] = useState("");
  const [selectedSignerRoles, setSelectedSignerRoles] = useState<StaffSignatureRole[]>([]);
  const [signatures, setSignatures] = useState<SignatureRecord[]>([]);
  const [sameSignatureForSelected, setSameSignatureForSelected] = useState(true);
  const [activeSignerIndex, setActiveSignerIndex] = useState(0);
  const [isSigning, setIsSigning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [returningToPreflight, setReturningToPreflight] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/intakes/${params.id}`).then(async (r) => {
      if (r.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!r.ok) {
        setNote("Could not load this intake. Please refresh or sign in again.");
        setLoaded(true);
        return;
      }
      const d = await r.json();
      setAnswers(d.answers);
      setClientName(d.intake.client.fullName);
      setSignatures(Array.isArray(d.intake.signatures) ? d.intake.signatures : []);
      setLoaded(true);
    });
  }, [params.id]);
  useEffect(load, [load]);

  useEffect(() => {
    setReturningToPreflight(new URLSearchParams(window.location.search).get("return") === "preflight");
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const focusKey = new URLSearchParams(window.location.search).get("focus");
    if (!focusKey) return;
    const timer = window.setTimeout(() => {
      const field = Array.from(document.querySelectorAll<HTMLElement>("[data-field-key]"))
        .find((element) => element.dataset.fieldKey === focusKey);
      if (!field) return;
      const details = field.closest("details");
      if (details) details.open = true;
      field.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = field.querySelector<HTMLElement>("input, textarea");
      input?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loaded]);

  const set = (k: string, v: Answers[string]) => setAnswers((a) => ({ ...a, [k]: v }));

  async function save() {
    if (saving) return;
    setSaving(true);
    setNote("Saving...");
    try {
      const r = await fetch(`/api/intakes/${params.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, status: "NEEDS_REVIEW" }),
      });
      const body = await r.json().catch(() => ({} as { error?: string }));
      if (!r.ok) {
        setNote(body.error || "Save failed. Please refresh and try again.");
        setSaving(false);
        return;
      }
      const query = new URLSearchParams({ saved: "staff" });
      if (returningToPreflight) query.set("return", "preflight");
      const focusKey = new URLSearchParams(window.location.search).get("focus");
      if (focusKey) query.set("focus", focusKey);
      router.push(`/intakes/${params.id}?${query.toString()}`);
    } catch {
      setNote("Save failed because the connection was interrupted. Please try again.");
      setSaving(false);
    }
  }

  function toggleSigner(role: StaffSignatureRole) {
    if (isSigning) return;
    setSelectedSignerRoles((current) => current.includes(role)
      ? current.filter((selected) => selected !== role)
      : [...current, role]);
  }

  function selectCareTeam() {
    if (!isSigning) setSelectedSignerRoles(CARE_TEAM_ROLES);
  }

  function selectMissingStaffSignatures() {
    if (isSigning) return;
    setSelectedSignerRoles(CARE_TEAM_ROLES.filter((role) => !signatures.some((signature) => signature.role === role)));
  }

  function startSigning() {
    if (!selectedSignerRoles.length) {
      setNote("Select at least one staff role before starting signatures.");
      return;
    }
    setActiveSignerIndex(0);
    setIsSigning(true);
    setNote(`Ready for ${SIGNER_OPTIONS.find((option) => option.role === selectedSignerRoles[0])?.label || "the first signer"}.`);
  }

  async function captureStaffSig(role: StaffSignatureRole, d: { imageData: string; printedName: string; relationship?: string; signedDate: string }) {
    const config = SIGNER_OPTIONS.find((option) => option.role === role);
    const rolesToSave = sameSignatureForSelected ? selectedSignerRoles.slice(activeSignerIndex) : [role];
    for (const roleToSave of rolesToSave) {
      const response = await fetch(`/api/intakes/${params.id}/signature`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: roleToSave, ...d }),
      });
      const body = await response.json().catch(() => ({} as { error?: string }));
      if (!response.ok) {
        setNote(body.error || `${config?.label || "Staff"} signature failed. Please try again.`);
        load();
        return;
      }
    }

    setSignatures((current) => [
      ...current.filter((signature) => !rolesToSave.includes(signature.role as StaffSignatureRole)),
      ...rolesToSave.map((savedRole) => ({ role: savedRole, printedName: d.printedName, signedDate: d.signedDate })),
    ]);
    if (!sameSignatureForSelected && activeSignerIndex + 1 < selectedSignerRoles.length) {
      const nextIndex = activeSignerIndex + 1;
      setActiveSignerIndex(nextIndex);
      const nextRole = selectedSignerRoles[nextIndex];
      setNote(`${config?.label || "Staff"} signature saved. Next: ${SIGNER_OPTIONS.find((option) => option.role === nextRole)?.label || "staff signer"}.`);
    } else {
      setIsSigning(false);
      setSelectedSignerRoles([]);
      setActiveSignerIndex(0);
      setNote(`Saved ${rolesToSave.length} staff signature${rolesToSave.length === 1 ? "" : "s"}. Review the intake before generating the packet.`);
    }
    if (role === "clinician" || rolesToSave.includes("clinician")) {
      setAnswers((current) => ({
        ...current,
        clinician_name: d.printedName,
        c_clinician: d.printedName,
        cca_provider_credentials: current.cca_provider_credentials || d.printedName,
        dis_prepared_by: current.dis_prepared_by || d.printedName,
      }));
    }
    load();
  }

  if (!loaded) return <main className="p-10 text-center text-slate-400">Loading...</main>;

  return (
    <main className="mx-auto max-w-4xl p-6 pb-24">
      <Link href={`/intakes/${params.id}`} className="text-sm text-brand hover:underline">Back to intake</Link>
      <h1 className="mt-1 text-2xl font-bold">Review & edit - {clientName}</h1>
      <p className="text-sm text-slate-500">Client answers first, then staff-only sections. Everything here fills the packet PDF.</p>

      {SECTIONS.map((s) => (
        <details key={s.key} className="card mt-3" open={s.key === "basic"}>
          <summary className="cursor-pointer font-bold text-brand">{s.title} (client)</summary>
          <div className="mt-3 space-y-3">
            {s.questions.filter((q) => askIfSatisfied(q.askIf, answers)).map((q) => (
              <EditField key={q.key} q={q} answers={answers} set={set} />
            ))}
          </div>
        </details>
      ))}
      {STAFF_FIELDS.map((g) => (
        <details key={g.group} className="card mt-3 border-amber-200 bg-amber-50/40">
          <summary className="cursor-pointer font-bold text-amber-800">{g.group} (staff only)</summary>
          <div className="mt-3 space-y-3">
            {g.fields.map((q) => <EditField key={q.key} q={q} answers={answers} set={set} />)}
          </div>
        </details>
      ))}

      <div id="staff-signatures" className="card mt-3 scroll-mt-4">
        <h3 className="font-bold">Staff-side signatures</h3>
        <p className="mb-2 text-xs text-slate-500">
          The client or guardian signs through the secure client link. Use this section to add or replace staff signatures before the packet is generated.
        </p>
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {[
            { role: "client", label: "Client / guardian", note: "Signs from the secure client link." },
            { role: "staff", label: "QP / Qualified Professional", note: "Staff review signature." },
            { role: "clinician", label: "Clinician", note: "Printed name is copied to the CCA." },
            { role: "witness", label: "Witness", note: "Use only when the form requires it." },
            { role: "medicalDirector", label: "Medical Director", note: "Use only when the form requires it." },
          ].map((item) => {
            const found = signatures.find((signature) => signature.role === item.role || (item.role === "client" && signature.role === "guardian"));
            return (
              <div key={item.role} className={`rounded-lg border p-2 text-sm ${found ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                <div className="flex items-center justify-between gap-2">
                  <b>{item.label}</b>
                  <span className={`text-xs font-semibold ${found ? "text-emerald-700" : "text-amber-700"}`}>{found ? "Captured" : "Missing"}</span>
                </div>
                <p className="mt-1 text-xs text-slate-600">{found ? `${found.printedName} (${found.signedDate})` : item.note}</p>
              </div>
            );
          })}
        </div>
        <label className="mb-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={sameSignatureForSelected} onChange={(event) => setSameSignatureForSelected(event.target.checked)} disabled={isSigning} />
          <span><b>Same person and same signature for selected roles</b><br /><span className="text-xs text-slate-600">Use this when the QP, witness, and clinician are the same person. Each role is still recorded separately.</span></span>
        </label>
        <div className="flex flex-wrap gap-2">
          {SIGNER_OPTIONS.map((option) => (
            <button key={option.role} type="button" aria-pressed={selectedSignerRoles.includes(option.role)} disabled={isSigning}
              className={selectedSignerRoles.includes(option.role) ? "btn-primary text-sm" : "btn-ghost text-sm"}
              onClick={() => toggleSigner(option.role)}>
              {selectedSignerRoles.includes(option.role) ? "Selected: " : "Select: "}{option.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" disabled={isSigning} onClick={selectMissingStaffSignatures}>
            Select missing staff signatures
          </button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" disabled={isSigning} onClick={selectCareTeam}>
            Select QP + clinician + witness
          </button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" disabled={isSigning || !selectedSignerRoles.length}
            onClick={() => setSelectedSignerRoles([])}>
            Clear selection
          </button>
          <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={isSigning || !selectedSignerRoles.length} onClick={startSigning}>
            Start selected signatures
          </button>
        </div>
        {isSigning && selectedSignerRoles[activeSignerIndex] && (
          <div className="mt-3">
            <p className="mb-2 text-sm font-semibold text-brand">
              Signature {activeSignerIndex + 1} of {selectedSignerRoles.length}: {SIGNER_OPTIONS.find((option) => option.role === selectedSignerRoles[activeSignerIndex])?.label}
            </p>
            <SignaturePad
              key={`${selectedSignerRoles[activeSignerIndex]}-${activeSignerIndex}`}
              roleLabel={SIGNER_OPTIONS.find((option) => option.role === selectedSignerRoles[activeSignerIndex])?.padLabel}
              expectedRole={selectedSignerRoles[activeSignerIndex]}
              defaultName={String(answers.clinician_name || answers.c_clinician || answers.staff_receiving_intake || "")}
              onCapture={(d) => { void captureStaffSig(selectedSignerRoles[activeSignerIndex], d); }}
            />
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t bg-white p-3">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <button className="btn-primary flex-1 disabled:cursor-wait disabled:opacity-60" disabled={saving} onClick={save}>
            {saving ? "Saving changes..." : returningToPreflight ? "Save & return to preflight" : "Save all changes & continue"}
          </button>
          <Link href={`/intakes/${params.id}/pdf-preview`} className="btn-secondary">Preview PDF</Link>
          <span className={`text-sm ${note.toLowerCase().includes("failed") || note.toLowerCase().includes("could not") ? "text-red-700" : "text-slate-600"}`} role="status">
            {note}
          </span>
        </div>
      </div>
    </main>
  );
}

function EditField({ q, answers, set }: { q: Question; answers: Answers; set: (k: string, v: Answers[string]) => void }) {
  const v = answers[q.key];
  if (q.type === "consent") {
    return (
      <label data-field-key={q.key} className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={v === true} onChange={(e) => set(q.key, e.target.checked)} />
        <span><b>Consent:</b> {q.label}</span>
      </label>
    );
  }
  if (q.type === "radio" || q.type === "yesno" || q.type === "survey") {
    const opts = q.type === "survey" ? ["1", "2", "3"] : q.options || [];
    return (
      <div data-field-key={q.key}>
        <label className="label">{q.label}</label>
        <div className="flex flex-wrap gap-1.5">
          {opts.map((o) => (
            <button key={o} type="button" className={`chip px-3 py-1 text-xs ${v === o ? "chip-on" : ""}`}
              onClick={() => set(q.key, v === o ? "" : o)}>{o}</button>
          ))}
        </div>
      </div>
    );
  }
  if (q.type === "chips") {
    const arr = Array.isArray(v) ? v : [];
    return (
      <div data-field-key={q.key}>
        <label className="label">{q.label}</label>
        <div className="flex flex-wrap gap-1.5">
          {(q.options || []).map((o) => (
            <button key={o} type="button" className={`chip px-3 py-1 text-xs ${arr.includes(o) ? "chip-on" : ""}`}
              onClick={() => set(q.key, arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])}>{o}</button>
          ))}
        </div>
      </div>
    );
  }
  if (q.type === "textarea") {
    return (
      <div data-field-key={q.key}>
        <label className="label">{q.label}</label>
        <textarea className="input min-h-[70px]" value={String(v ?? "")} onChange={(e) => set(q.key, e.target.value)} />
      </div>
    );
  }
  return (
    <div data-field-key={q.key}>
      <label className="label">{q.label}</label>
      <input className="input" type={q.type === "date" ? "date" : "text"} value={String(v ?? "")}
        onChange={(e) => set(q.key, e.target.value)} />
    </div>
  );
}
