"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { providerWorkflowHref } from "@/lib/providerWorkflowHref";
import { copyTextToClipboard } from "@/lib/clipboardFeedback";
import { insurancePlanDisplayLabel, PROVIDER_CHOICE_PLAN_OPTIONS, RECORD_NUMBER_GENERATOR_PLAN_OPTIONS, recordNumberPrefix } from "@/lib/insurancePlans";
import { batchRetryDrafts, type BatchFailure } from "@/lib/batchRetryDrafts";
import { generateBatchRecordNumbers } from "@/lib/batchRecordNumbers";
import { createProviderContextReady } from "@/lib/newIntakeReadiness";

type Draft = {
  fullName: string;
  dob: string;
  midNumber: string;
  recordNumber: string;
  intakeDate: string;
  location: string;
  email: string;
  phone: string;
  guardianName: string;
  guardianEmail: string;
  guardianPhone: string;
  providerChoicePlan: string;
};

type Created = {
  id: string;
  clientName: string;
  clientLink: string;
  packet?: { filled: number; skipped: number } | null;
  packetError?: string;
};

const COLUMNS: Array<[keyof Draft, string, string, string?]> = [
  ["fullName", "Client full name *", "text", "min-w-56"],
  ["dob", "DOB *", "date", "min-w-40"],
  ["providerChoicePlan", "Insurance / MCO *", "select", "min-w-56"],
  ["recordNumber", "Record# *", "text", "min-w-32"],
  ["midNumber", "MID#", "text", "min-w-32"],
  ["email", "Email", "email", "min-w-48"],
  ["phone", "Phone", "tel", "min-w-36"],
  ["guardianName", "Guardian", "text", "min-w-44"],
  ["guardianEmail", "Guardian email", "email", "min-w-48"],
  ["guardianPhone", "Guardian phone", "tel", "min-w-36"],
];

function blankDraft(): Draft {
  return {
    fullName: "",
    dob: "",
    midNumber: "",
    recordNumber: "",
    intakeDate: "",
    location: "",
    email: "",
    phone: "",
    guardianName: "",
    guardianEmail: "",
    guardianPhone: "",
    providerChoicePlan: "",
  };
}

function hasDraftData(row: Draft): boolean {
  return Object.entries(row).some(([key, value]) => key !== "location" && value.trim() !== "");
}

function parsePastedRows(text: string): Draft[] {
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 25)
    .map((line) => {
      const cells = line.includes("\t") ? line.split("\t") : line.split(",");
      const row = blankDraft();
      row.fullName = cells[0]?.trim() || "";
      row.dob = cells[1]?.trim() || "";
      row.providerChoicePlan = cells[2]?.trim() || "";
      row.recordNumber = cells[3]?.trim() || "";
      row.midNumber = cells[4]?.trim() || "";
      row.email = cells[5]?.trim() || "";
      row.phone = cells[6]?.trim() || "";
      row.guardianName = cells[7]?.trim() || "";
      row.guardianEmail = cells[8]?.trim() || "";
      row.guardianPhone = cells[9]?.trim() || "";
      return row;
    });
}

function CreateManyIntakesForm({ requestedProviderId }: { requestedProviderId: string | null }) {
  const [rows, setRows] = useState<Draft[]>([blankDraft(), blankDraft(), blankDraft()]);
  const [recordPanel, setRecordPanel] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [expectCca, setExpectCca] = useState(true);
  const [generateDraftPackets, setGenerateDraftPackets] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created[]>([]);
  const [copyNotice, setCopyNotice] = useState("");
  const [manualCopyText, setManualCopyText] = useState("");
  const [copyingLinks, setCopyingLinks] = useState(false);
  const copyingLinksRef = useRef(false);
  const [failures, setFailures] = useState<BatchFailure[]>([]);
  const [providerId, setProviderId] = useState("");
  const [providerName, setProviderName] = useState("");
  const [contextLoaded, setContextLoaded] = useState(false);
  const [contextError, setContextError] = useState("");
  const [generationNote, setGenerationNote] = useState("");
  const providerContextReady = createProviderContextReady(providerId, contextLoaded, contextError);
  const activeRows = useMemo(() => rows.filter(hasDraftData), [rows]);

  useEffect(() => {
    let active = true;
    fetch(providerWorkflowHref("/api/intakes/context", requestedProviderId), { cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok || !body.provider?.id?.trim()) throw new Error(body.error || "Provider context could not be loaded.");
      if (!active) return;
      setProviderId(body.provider.id);
      setProviderName(body.provider.name);
      setContextLoaded(true);
    }).catch((failure) => {
      if (!active) return;
      setContextError(failure instanceof Error ? failure.message : "Provider context could not be loaded.");
      setContextLoaded(true);
    });
    return () => { active = false; };
  }, [requestedProviderId]);

  function updateRow(index: number, key: keyof Draft, value: string) {
    setGenerationNote("");
    setRows((current) => current.map((row, i) => i === index ? { ...row, [key]: value } : row));
  }

  function addRows(count = 1) {
    setGenerationNote("");
    setRows((current) => [...current, ...Array.from({ length: count }, blankDraft)].slice(0, 25));
  }

  function removeRow(index: number) {
    setGenerationNote("");
    setRows((current) => current.length === 1 ? [blankDraft()] : current.filter((_, i) => i !== index));
  }

  function importPaste() {
    const imported = parsePastedRows(pasteText);
    if (!imported.length) return;
    setGenerationNote("");
    setRows(imported);
    setPasteText("");
    setFailures([]);
  }

  function generateMissingRecordNumbers() {
    setError("");
    const result = generateBatchRecordNumbers(rows, recordPanel, hasDraftData);
    setRows(result.rows);
    setGenerationNote([
      `Generated ${result.generatedCount} Record# value${result.generatedCount === 1 ? "" : "s"} using each row's insurance plan.`,
      result.manualRows.length ? `Rows ${result.manualRows.join(", ")} need their official Record# entered manually.` : "",
      result.missingPlanRows.length ? `Choose a plan for rows ${result.missingPlanRows.join(", ")}, or choose a default panel.` : "",
      result.failedRows.length ? `Could not find an unused Record# for rows ${result.failedRows.join(", ")}. Try again.` : "",
    ].filter(Boolean).join(" "));
  }

  async function copyAllLinks() {
    if (copyingLinksRef.current || !created.length) return;
    copyingLinksRef.current = true;
    setCopyingLinks(true);
    setCopyNotice("");
    const text = created.map((item) => `${item.clientName}: ${item.clientLink}`).join("\n");
    try {
      const copied = await copyTextToClipboard(text);
      setManualCopyText(copied ? "" : text);
      setCopyNotice(copied ? `${created.length} intake link${created.length === 1 ? "" : "s"} copied. No messages were sent.` : "Automatic copy is unavailable. Select and copy the links below using your device's copy command.");
    } finally {
      copyingLinksRef.current = false;
      setCopyingLinks(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current || copyingLinksRef.current) return;
    if (!providerContextReady) { setError(contextError || "Wait for the provider to load before creating these intakes."); return; }
    setError("");
    setFailures([]);
    const missing = rows.findIndex((row) => hasDraftData(row) && (!row.fullName || !row.dob || !row.providerChoicePlan || !row.recordNumber));
    if (!activeRows.length) {
      setError("Add at least one intake.");
      return;
    }
    if (missing >= 0) {
      setError(`Row ${missing + 1} needs client name, DOB, insurance / MCO, and Record#.`);
      return;
    }
    const recordRows = new Map<string, number>();
    for (const [index, row] of rows.entries()) {
      if (!hasDraftData(row)) continue;
      const key = row.recordNumber.trim().toLowerCase();
      const firstRow = recordRows.get(key);
      if (firstRow) {
        setError(`Rows ${firstRow} and ${index + 1} use the same Record#.`);
        return;
      }
      recordRows.set(key, index + 1);
    }
    const submittedRowIndexes = rows.flatMap((row, index) => hasDraftData(row) ? [index] : []);
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/intakes/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId, intakes: activeRows, expectCca, generateDraftPackets }),
      });
      const body = await res.json();
      if (!res.ok && !body.created?.length && !body.failures?.length) throw new Error(body.error || "Failed to create intakes");
      const newCreated = (body.created || []) as Created[];
      setCreated((current) => [...new Map([...current, ...newCreated].map((item) => [item.id, item])).values()]);
      const retry = batchRetryDrafts(rows, submittedRowIndexes, body.failures || [], blankDraft);
      setFailures(retry.failures);
      if (newCreated.length) {
        setGenerationNote("");
        setRows(retry.drafts);
        setCopyNotice("");
        setManualCopyText("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create intakes");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <Link href={providerWorkflowHref("/dashboard", providerId || requestedProviderId)} className="text-sm text-brand hover:underline">Dashboard</Link>
          <h1 className="mt-1 text-2xl font-bold">Create Many Intakes</h1>
          <p className="mt-1 text-sm text-slate-600" role="status">{providerContextReady ? `Saving to ${providerName}` : contextError || "Loading provider…"}</p>
        </div>
        <Link href={providerWorkflowHref("/intakes/new", providerId || requestedProviderId)} className="btn-secondary">Create one</Link>
      </div>

      <section className="card mb-4">
        <label className="label">Paste rows</label>
        <textarea
          className="input min-h-24 font-mono text-xs"
          disabled={busy}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={"Full name\tDOB\tInsurance/MCO\tRecord#\tMID#\tEmail\tPhone\tGuardian\tGuardian email\tGuardian phone"}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={importPaste} disabled={busy}>Import pasted rows</button>
          <button type="button" className="btn-ghost" onClick={() => addRows(3)} disabled={busy || rows.length >= 25}>Add 3 rows</button>
        </div>
      </section>

      <form onSubmit={submit} className="card">
        <fieldset disabled={busy} className="min-w-0">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Batch details</h2>
            <p className="text-sm text-slate-500">{activeRows.length} intake row{activeRows.length === 1 ? "" : "s"} started. Complete the required fields before creating.</p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={expectCca} onChange={(e) => setExpectCca(e.target.checked)} />
              Short client intake
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4" checked={generateDraftPackets} onChange={(e) => setGenerateDraftPackets(e.target.checked)} />
              Auto-generate draft packet
            </label>
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-brand/20 bg-brand-light/40 p-4">
          <h3 className="font-bold text-brand">Record number generator</h3>
          <p className="mt-1 text-sm text-slate-600">Fill missing Record# values using each row's plan. A default panel applies only to rows without a plan; plans requiring an official number stay manual.</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="min-w-64">
              <span className="label">Default panel for rows without a plan</span>
              <select className="input" value={recordPanel} onChange={(e) => setRecordPanel(e.target.value)}>
                <option value="">Select panel</option>
                {RECORD_NUMBER_GENERATOR_PLAN_OPTIONS.map((plan) => (
                  <option key={plan} value={plan}>{plan} ({recordNumberPrefix(plan) || "OTHER"})</option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-secondary" onClick={generateMissingRecordNumbers}>Generate missing Record# values</button>
          </div>
        </div>

        {generationNote && <p className="mb-4 text-sm text-slate-700" role="status">{generationNote}</p>}

        <div className="space-y-3 md:hidden">
          {rows.map((row, index) => (
            <fieldset key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <legend className="px-1 font-bold text-brand">Client row {index + 1}</legend>
              <div className="mt-2 grid gap-3">
                {COLUMNS.map(([key, label, type]) => (
                  <label key={key}>
                    <span className="label">{label}</span>
                    {type === "select" ? (
                      <select className="input min-h-11" value={row[key]} onChange={(e) => updateRow(index, key, e.target.value)}>
                        <option value="">Select insurance / MCO</option>
                        {PROVIDER_CHOICE_PLAN_OPTIONS.map((plan) => <option key={plan} value={plan}>{insurancePlanDisplayLabel(plan)}</option>)}
                      </select>
                    ) : (
                      <input className="input min-h-11" type={type} value={row[key]} onChange={(e) => updateRow(index, key, e.target.value)} />
                    )}
                  </label>
                ))}
              </div>
              <button type="button" className="btn-ghost mt-3 w-full px-2 py-2 text-sm" onClick={() => removeRow(index)}>Remove row {index + 1}</button>
            </fieldset>
          ))}
        </div>

        <div className="hidden overflow-x-auto rounded-lg border border-slate-200 md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">#</th>
                {COLUMNS.map(([key, label]) => <th key={key} className="px-3 py-2">{label}</th>)}
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-400">{index + 1}</td>
                  {COLUMNS.map(([key, label, type, width]) => (
                    <td key={key} className="px-3 py-2">
                      {type === "select" ? (
                        <select
                          aria-label={`${label.replace(" *", "")}, row ${index + 1}`}
                          className={`input h-9 ${width || "min-w-32"}`}
                          value={row[key]}
                          onChange={(e) => updateRow(index, key, e.target.value)}
                        >
                          <option value="">Select insurance / MCO</option>
                          {PROVIDER_CHOICE_PLAN_OPTIONS.map((plan) => <option key={plan} value={plan}>{insurancePlanDisplayLabel(plan)}</option>)}
                        </select>
                      ) : (
                        <input
                          aria-label={`${label.replace(" *", "")}, row ${index + 1}`}
                          className={`input h-9 ${width || "min-w-32"}`}
                          type={type}
                          value={row[key]}
                          onChange={(e) => updateRow(index, key, e.target.value)}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => removeRow(index)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <p className="mt-3 text-sm font-semibold text-red-600">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy || copyingLinks || !providerContextReady || activeRows.length === 0}>{busy ? "Creating..." : "Create Many"}</button>
          <button type="button" className="btn-ghost" onClick={() => { setRows([blankDraft(), blankDraft(), blankDraft()]); setGenerationNote(""); }}>Clear</button>
        </div>
        </fieldset>
      </form>

      {(created.length > 0 || failures.length > 0) && (
        <section className="card mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Batch result</h2>
            {created.length > 0 && <button type="button" className="btn-secondary" disabled={copyingLinks || busy} onClick={() => void copyAllLinks()}>{copyingLinks ? "Copying…" : "Copy all links"}</button>}
          </div>
          {copyNotice && <p className={`mb-3 text-sm font-semibold ${manualCopyText ? "text-amber-900" : "text-emerald-800"}`} role="status">{copyNotice}</p>}
          {manualCopyText && <label className="mb-3 block text-sm font-semibold">Select and copy all intake links
            <textarea className="input mt-2 min-h-32 w-full font-mono text-xs" readOnly value={manualCopyText} onFocus={(event) => event.currentTarget.select()} />
          </label>}
          {created.length > 0 && (
            <div className="space-y-2">
              {created.map((item) => (
                <div key={item.id} className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <div className="font-semibold text-emerald-800">{item.clientName}</div>
                  <div className="break-all font-mono text-xs text-slate-700">{item.clientLink}</div>
                  {item.packet && <div className="mt-1 text-xs text-slate-500">Draft packet generated: {item.packet.filled} fields filled</div>}
                  {item.packetError && <div className="mt-1 text-xs text-red-600">Packet not generated: {item.packetError}</div>}
                </div>
              ))}
            </div>
          )}
          {failures.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-sm font-semibold text-amber-900" role="status">Failed rows stay in the form above. Correct them and choose Create Many to retry; saved intakes will not be created again.</p>
              {failures.map((failure) => (
                <div key={`${failure.row}-${failure.clientName}`} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  Row {failure.row}: {failure.error}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function CreateManyIntakesForProvider() {
  const requestedProviderId = useSearchParams().get("providerId");
  return <CreateManyIntakesForm key={requestedProviderId ?? "selected-provider"} requestedProviderId={requestedProviderId} />;
}

export default function CreateManyIntakes() {
  return <Suspense fallback={<main className="p-6" role="status">Loading provider…</main>}><CreateManyIntakesForProvider /></Suspense>;
}
