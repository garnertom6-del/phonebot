"use client";
/**
 * Staff review/edit screen: every client answer plus all staff-only fields
 * (page-1 checklist, screening, clinical, PCP collaboration, discharge
 * summary), and staff-side signature capture.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SECTIONS, STAFF_FIELDS, type Question } from "@/config/mooreDivineQuestions";
import { askIfSatisfied } from "@/lib/validation";
import SignaturePad from "@/components/SignaturePad";

type Answers = Record<string, string | boolean | number | string[]>;

export default function ReviewPage({ params }: { params: { id: string } }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [clientName, setClientName] = useState("");
  const [note, setNote] = useState("");
  const [signRole, setSignRole] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/intakes/${params.id}`).then(async (r) => {
      if (!r.ok) return;
      const d = await r.json();
      setAnswers(d.answers); setClientName(d.intake.client.fullName); setLoaded(true);
    });
  }, [params.id]);
  useEffect(load, [load]);

  const set = (k: string, v: Answers[string]) => setAnswers((a) => ({ ...a, [k]: v }));

  async function save() {
    setNote("Saving...");
    const r = await fetch(`/api/intakes/${params.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers, status: "NEEDS_REVIEW" }),
    });
    setNote(r.ok ? "Saved ✓ (marked Needs Review until packet is generated)" : "Save failed");
  }

  async function captureStaffSig(role: string, d: { imageData: string; printedName: string; relationship: string; signedDate: string }) {
    const r = await fetch(`/api/intakes/${params.id}/signature`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, ...d }),
    });
    setNote(r.ok ? `${role} signature captured ✓` : "Signature failed");
    setSignRole(null);
  }

  if (!loaded) return <main className="p-10 text-center text-slate-400">Loading...</main>;

  return (
    <main className="mx-auto max-w-4xl p-6 pb-24">
      <Link href={`/intakes/${params.id}`} className="text-sm text-brand hover:underline">← Back to intake</Link>
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

      <div className="card mt-3">
        <h3 className="font-bold">Staff-side signatures</h3>
        <p className="mb-2 text-xs text-slate-500">These stay blank on the PDF until captured here.</p>
        <div className="flex flex-wrap gap-2">
          {["staff", "clinician", "witness", "medicalDirector"].map((r) => (
            <button key={r} className="btn-ghost text-sm" onClick={() => setSignRole(r)}>Sign as {r}</button>
          ))}
        </div>
        {signRole && (
          <div className="mt-3">
            <SignaturePad roleLabel={`${signRole} signature`} onCapture={(d) => captureStaffSig(signRole, d)} />
          </div>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t bg-white p-3">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <button className="btn-primary flex-1" onClick={save}>Save all changes</button>
          <Link href={`/intakes/${params.id}/pdf-preview`} className="btn-secondary">Preview PDF</Link>
          <span className="text-sm text-slate-500">{note}</span>
        </div>
      </div>
    </main>
  );
}

function EditField({ q, answers, set }: { q: Question; answers: Answers; set: (k: string, v: Answers[string]) => void }) {
  const v = answers[q.key];
  if (q.type === "consent") {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={v === true} onChange={(e) => set(q.key, e.target.checked)} />
        <span><b>Consent:</b> {q.label}</span>
      </label>
    );
  }
  if (q.type === "radio" || q.type === "yesno" || q.type === "survey") {
    const opts = q.type === "survey" ? ["1", "2", "3"] : q.options || [];
    return (
      <div>
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
      <div>
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
      <div>
        <label className="label">{q.label}</label>
        <textarea className="input min-h-[70px]" value={String(v ?? "")} onChange={(e) => set(q.key, e.target.value)} />
      </div>
    );
  }
  return (
    <div>
      <label className="label">{q.label}</label>
      <input className="input" type={q.type === "date" ? "date" : "text"} value={String(v ?? "")}
        onChange={(e) => set(q.key, e.target.value)} />
    </div>
  );
}
