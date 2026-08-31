"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PLAN_SOURCE_VALUES } from "@/lib/recordIntegrity";

type Answers = Record<string, string | boolean | number | string[]>;
type PlanSummary = {
  total: number;
  completed: number;
  missing: string[];
  state: string;
  fieldsFilled?: boolean;
  gates?: Array<{ key: string; met: boolean; detail: string }>;
};

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

function planBadge(summary?: PlanSummary) {
  const state = summary?.state || "incomplete";
  if (state === "complete") return { className: "bg-emerald-100 text-emerald-800", label: "Complete" };
  if (state === "not_started") return { className: "bg-slate-100 text-slate-700", label: "Not started" };
  return { className: "bg-amber-100 text-amber-800", label: "Incomplete" };
}

export default function PlansPage({ params }: { params: { id: string } }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [clientName, setClientName] = useState("");
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [pcp, setPcp] = useState<PlanSummary | undefined>();
  const [crisis, setCrisis] = useState<PlanSummary | undefined>();

  const load = useCallback(() => {
    fetch(`/api/intakes/${params.id}`).then(async (r) => {
      if (!r.ok) return;
      const d = await r.json();
      setAnswers(d.answers);
      setClientName(d.intake.client.fullName);
      setPcp(d.planCompleteness?.pcp);
      setCrisis(d.planCompleteness?.crisis);
      setLoaded(true);
    });
  }, [params.id]);
  useEffect(load, [load]);

  const set = (key: string, value: string) => setAnswers((a) => ({ ...a, [key]: value }));

  async function save() {
    setNote("Saving...");
    const planAnswers = Object.fromEntries([
      ...FIELDS.map(([key]) => [key, answers[key] ?? ""]),
      ["pcp_plan_date", answers.pcp_plan_date ?? ""],
      ["pcp_plan_source", answers.pcp_plan_source ?? ""],
      ["crisis_plan_date", answers.crisis_plan_date ?? ""],
      ["crisis_plan_source", answers.crisis_plan_source ?? ""],
    ]);
    const r = await fetch(`/api/intakes/${params.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: planAnswers, status: "NEEDS_REVIEW" }),
    });
    setNote(r.ok ? "Saved" : "Save failed");
    if (r.ok) load();
  }

  if (!loaded) return <main className="p-10 text-center text-slate-400">Loading...</main>;
  const pcpBadge = planBadge(pcp);
  const crisisBadge = planBadge(crisis);

  return (
    <main className="mx-auto max-w-4xl p-6 pb-24">
      <Link href={`/intakes/${params.id}`} className="text-sm text-brand hover:underline">Back to intake</Link>
      <h1 className="mt-1 text-2xl font-bold">PCP / Crisis Plan - {clientName}</h1>
      <p className="mt-1 text-sm text-slate-500">
        Capture PCP coordination and crisis-plan notes here. A plan is complete only after staff review,
        required signatures, a real date, and a documented CCA or staff source — not because the text fields are filled.
      </p>

      <nav className="card mt-4 flex flex-wrap items-center gap-2" aria-label="PCP and crisis plan navigation">
        <a href="#pcp-plan" className="btn-ghost px-3 py-1.5 text-sm">PCP: {pcpBadge.label}</a>
        <a href="#crisis-plan" className="btn-ghost px-3 py-1.5 text-sm">Crisis plan: {crisisBadge.label}</a>
        <span className="text-xs text-slate-500">These plans have separate completion status and do not inherit the intake checklist status.</span>
      </nav>

      <section id="pcp-plan" className="card mt-4 scroll-mt-4" aria-labelledby="pcp-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="pcp-heading" className="text-lg font-bold text-brand">Primary Care / PCP</h2>
          <span className={`badge ${pcpBadge.className}`}>{pcpBadge.label}</span>
        </div>
        <GateList gates={pcp?.gates} />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {FIELDS.slice(0, 5).map(([key, label]) => (
            <TextBox key={key} fieldKey={key} label={label} value={answers[key]} onChange={(v) => set(key, v)} />
          ))}
          <label htmlFor="plan-pcp_plan_date">
            <span className="label">Plan date</span>
            <input id="plan-pcp_plan_date" className="input" type="date" value={String(answers.pcp_plan_date ?? "")} onChange={(e) => set("pcp_plan_date", e.target.value)} />
          </label>
          <label htmlFor="plan-pcp_plan_source">
            <span className="label">Documented source</span>
            <select id="plan-pcp_plan_source" className="input" value={String(answers.pcp_plan_source ?? "")} onChange={(e) => set("pcp_plan_source", e.target.value)}>
              <option value="">Select CCA or staff</option>
              {PLAN_SOURCE_VALUES.map((source) => (
                <option key={source} value={source}>{source === "CCA" ? "CCA" : "Staff"}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section id="crisis-plan" className="card mt-4 scroll-mt-4" aria-labelledby="crisis-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="crisis-heading" className="text-lg font-bold text-brand">Crisis Plan</h2>
          <span className={`badge ${crisisBadge.className}`}>{crisisBadge.label}</span>
        </div>
        <GateList gates={crisis?.gates} />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {FIELDS.slice(5).map(([key, label]) => (
            <TextBox key={key} fieldKey={key} label={label} value={answers[key]} onChange={(v) => set(key, v)} />
          ))}
          <label htmlFor="plan-crisis_plan_date">
            <span className="label">Plan date</span>
            <input id="plan-crisis_plan_date" className="input" type="date" value={String(answers.crisis_plan_date ?? "")} onChange={(e) => set("crisis_plan_date", e.target.value)} />
          </label>
          <label htmlFor="plan-crisis_plan_source">
            <span className="label">Documented source</span>
            <select id="plan-crisis_plan_source" className="input" value={String(answers.crisis_plan_source ?? "")} onChange={(e) => set("crisis_plan_source", e.target.value)}>
              <option value="">Select CCA or staff</option>
              {PLAN_SOURCE_VALUES.map((source) => (
                <option key={source} value={source}>{source === "CCA" ? "CCA" : "Staff"}</option>
              ))}
            </select>
          </label>
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

function GateList({ gates }: { gates?: Array<{ key: string; met: boolean; detail: string }> }) {
  if (!gates?.length) return null;
  return (
    <ul className="mt-3 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
      {gates.map((gate) => (
        <li key={gate.key} className={gate.met ? "text-emerald-800" : "text-amber-900"}>
          {gate.met ? "✓" : "•"} {gate.detail}
        </li>
      ))}
    </ul>
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
