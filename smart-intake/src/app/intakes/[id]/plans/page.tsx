"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Answers = Record<string, string | boolean | number | string[]>;

const FIELDS = [
  ["pcp_name", "Primary care doctor"],
  ["pcp_phone", "PCP phone"],
  ["pcp_address", "PCP address / practice"],
  ["preferred_emergency_facility", "Preferred hospital / emergency facility"],
  ["dis_pcp_plan", "PCP plan notes"],
  ["crisis_warning_signs", "Crisis warning signs"],
  ["crisis_steps", "What helps during a crisis"],
  ["crisis_supports", "Support people / agencies"],
  ["dis_crisis_contact", "Crisis recurrence contact"],
  ["dis_crisis_phone", "Crisis phone"],
] as const;

export default function PlansPage({ params }: { params: { id: string } }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [clientName, setClientName] = useState("");
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/intakes/${params.id}`).then(async (r) => {
      if (!r.ok) return;
      const d = await r.json();
      setAnswers(d.answers);
      setClientName(d.intake.client.fullName);
      setLoaded(true);
    });
  }, [params.id]);
  useEffect(load, [load]);

  const set = (key: string, value: string) => setAnswers((a) => ({ ...a, [key]: value }));

  async function save() {
    setNote("Saving...");
    const planAnswers = Object.fromEntries(FIELDS.map(([key]) => [key, answers[key] ?? ""]));
    const r = await fetch(`/api/intakes/${params.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: planAnswers, status: "NEEDS_REVIEW" }),
    });
    setNote(r.ok ? "Saved" : "Save failed");
  }

  if (!loaded) return <main className="p-10 text-center text-slate-400">Loading...</main>;
  const countCompleted = (fields: readonly (readonly [string, string])[]) => fields.filter(([key]) => String(answers[key] ?? "").trim()).length;
  const pcpCompleted = countCompleted(FIELDS.slice(0, 5));
  const crisisCompleted = countCompleted(FIELDS.slice(5));

  return (
    <main className="mx-auto max-w-4xl p-6 pb-24">
      <Link href={`/intakes/${params.id}`} className="text-sm text-brand hover:underline">Back to intake</Link>
      <h1 className="mt-1 text-2xl font-bold">PCP / Crisis Plan - {clientName}</h1>
      <p className="mt-1 text-sm text-slate-500">
        Capture PCP coordination and crisis-plan notes here. These fields can feed the intake packet now
        and become full PCP/crisis-plan documents in the next phase.
      </p>

      <nav className="card mt-4 flex flex-wrap items-center gap-2" aria-label="PCP and crisis plan navigation">
        <a href="#pcp-plan" className="btn-ghost px-3 py-1.5 text-sm">PCP: {pcpCompleted}/5</a>
        <a href="#crisis-plan" className="btn-ghost px-3 py-1.5 text-sm">Crisis plan: {crisisCompleted}/5</a>
        <span className="text-xs text-slate-500">These plans have separate completion status and do not inherit the intake checklist status.</span>
      </nav>

      <section id="pcp-plan" className="card mt-4 scroll-mt-4" aria-labelledby="pcp-heading">
        <div className="flex items-center justify-between gap-3"><h2 id="pcp-heading" className="text-lg font-bold text-brand">Primary Care / PCP</h2><span className="badge bg-slate-100 text-slate-700">{pcpCompleted}/5 complete</span></div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {FIELDS.slice(0, 5).map(([key, label]) => (
            <TextBox key={key} fieldKey={key} label={label} value={answers[key]} onChange={(v) => set(key, v)} />
          ))}
        </div>
      </section>

      <section id="crisis-plan" className="card mt-4 scroll-mt-4" aria-labelledby="crisis-heading">
        <div className="flex items-center justify-between gap-3"><h2 id="crisis-heading" className="text-lg font-bold text-brand">Crisis Plan</h2><span className={`badge ${crisisCompleted === 5 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{crisisCompleted}/5 complete</span></div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {FIELDS.slice(5).map(([key, label]) => (
            <TextBox key={key} fieldKey={key} label={label} value={answers[key]} onChange={(v) => set(key, v)} />
          ))}
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t bg-white p-3">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <button className="btn-primary flex-1" onClick={save}>Save PCP / crisis plan notes</button>
          <Link href={`/intakes/${params.id}/pdf-preview`} className="btn-secondary">Preview PDF</Link>
          <span className="text-sm text-slate-500">{note}</span>
        </div>
      </div>
    </main>
  );
}

function TextBox({ fieldKey, label, value, onChange }: { fieldKey: string; label: string; value: unknown; onChange: (value: string) => void }) {
  const id = `plan-${fieldKey}`;
  return (
    <label htmlFor={id}>
      <span className="label">{label}</span>
      <textarea id={id} className="input min-h-[80px]" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

