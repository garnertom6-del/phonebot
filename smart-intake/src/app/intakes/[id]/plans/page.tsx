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
    const r = await fetch(`/api/intakes/${params.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers, status: "NEEDS_REVIEW" }),
    });
    setNote(r.ok ? "Saved" : "Save failed");
  }

  if (!loaded) return <main className="p-10 text-center text-slate-400">Loading...</main>;

  return (
    <main className="mx-auto max-w-4xl p-6 pb-24">
      <Link href={`/intakes/${params.id}`} className="text-sm text-brand hover:underline">Back to intake</Link>
      <h1 className="mt-1 text-2xl font-bold">PCP / Crisis Plan - {clientName}</h1>
      <p className="mt-1 text-sm text-slate-500">
        Capture PCP coordination and crisis-plan notes here. These fields can feed the intake packet now
        and become full PCP/crisis-plan documents in the next phase.
      </p>

      <section className="card mt-4">
        <h2 className="text-lg font-bold text-brand">Primary Care / PCP</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {FIELDS.slice(0, 5).map(([key, label]) => (
            <TextBox key={key} label={label} value={answers[key]} onChange={(v) => set(key, v)} />
          ))}
        </div>
      </section>

      <section className="card mt-4">
        <h2 className="text-lg font-bold text-brand">Crisis Plan</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {FIELDS.slice(5).map(([key, label]) => (
            <TextBox key={key} label={label} value={answers[key]} onChange={(v) => set(key, v)} />
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

function TextBox({ label, value, onChange }: { label: string; value: unknown; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="label">{label}</span>
      <textarea className="input min-h-[80px]" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

