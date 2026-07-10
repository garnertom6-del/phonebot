"use client";
import Link from "next/link";
import { useMemo, useState } from "react";

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
};

type Created = {
  id: string;
  clientName: string;
  clientLink: string;
  packet?: { filled: number; skipped: number } | null;
  packetError?: string;
};

type Failure = { row: number; clientName?: string; error: string };

const COLUMNS: Array<[keyof Draft, string, string, string?]> = [
  ["fullName", "Client full name *", "text", "min-w-56"],
  ["dob", "DOB *", "date", "min-w-40"],
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
    location: "Greensboro",
    email: "",
    phone: "",
    guardianName: "",
    guardianEmail: "",
    guardianPhone: "",
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
      row.recordNumber = cells[2]?.trim() || "";
      row.midNumber = cells[3]?.trim() || "";
      row.email = cells[4]?.trim() || "";
      row.phone = cells[5]?.trim() || "";
      row.guardianName = cells[6]?.trim() || "";
      row.guardianEmail = cells[7]?.trim() || "";
      row.guardianPhone = cells[8]?.trim() || "";
      return row;
    });
}

export default function CreateManyIntakes() {
  const [rows, setRows] = useState<Draft[]>([blankDraft(), blankDraft(), blankDraft()]);
  const [pasteText, setPasteText] = useState("");
  const [expectCca, setExpectCca] = useState(true);
  const [generateDraftPackets, setGenerateDraftPackets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const activeRows = useMemo(() => rows.filter(hasDraftData), [rows]);

  function updateRow(index: number, key: keyof Draft, value: string) {
    setRows((current) => current.map((row, i) => i === index ? { ...row, [key]: value } : row));
  }

  function addRows(count = 1) {
    setRows((current) => [...current, ...Array.from({ length: count }, blankDraft)].slice(0, 25));
  }

  function removeRow(index: number) {
    setRows((current) => current.length === 1 ? [blankDraft()] : current.filter((_, i) => i !== index));
  }

  function importPaste() {
    const imported = parsePastedRows(pasteText);
    if (!imported.length) return;
    setRows(imported);
    setPasteText("");
    setCreated([]);
    setFailures([]);
  }

  async function copyAllLinks() {
    await navigator.clipboard.writeText(created.map((item) => `${item.clientName}: ${item.clientLink}`).join("\n"));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCreated([]);
    setFailures([]);
    const missing = rows.findIndex((row) => hasDraftData(row) && (!row.fullName || !row.dob || !row.recordNumber));
    if (!activeRows.length) {
      setError("Add at least one intake.");
      return;
    }
    if (missing >= 0) {
      setError(`Row ${missing + 1} needs client name, DOB, and Record#.`);
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
    setBusy(true);
    try {
      const res = await fetch("/api/intakes/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intakes: activeRows, expectCca, generateDraftPackets }),
      });
      const body = await res.json();
      if (!res.ok && !body.created?.length) throw new Error(body.error || "Failed to create intakes");
      setCreated(body.created || []);
      setFailures(body.failures || []);
      if (body.created?.length) setRows([blankDraft(), blankDraft(), blankDraft()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create intakes");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <Link href="/dashboard" className="text-sm text-brand hover:underline">Dashboard</Link>
          <h1 className="mt-1 text-2xl font-bold">Create Many Intakes</h1>
        </div>
        <Link href="/intakes/new" className="btn-secondary">Create one</Link>
      </div>

      <section className="card mb-4">
        <label className="label">Paste rows</label>
        <textarea
          className="input min-h-24 font-mono text-xs"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={"Full name\tDOB\tRecord#\tMID#\tEmail\tPhone\tGuardian\tGuardian email\tGuardian phone"}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={importPaste}>Import pasted rows</button>
          <button type="button" className="btn-ghost" onClick={() => addRows(3)} disabled={rows.length >= 25}>Add 3 rows</button>
        </div>
      </section>

      <form onSubmit={submit} className="card">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Batch details</h2>
            <p className="text-sm text-slate-500">{activeRows.length} intake{activeRows.length === 1 ? "" : "s"} ready</p>
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

        <div className="overflow-x-auto rounded-lg border border-slate-200">
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
                  {COLUMNS.map(([key, , type, width]) => (
                    <td key={key} className="px-3 py-2">
                      <input
                        className={`input h-9 ${width || "min-w-32"}`}
                        type={type}
                        value={row[key]}
                        onChange={(e) => updateRow(index, key, e.target.value)}
                      />
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
          <button className="btn-primary" disabled={busy}>{busy ? "Creating..." : "Create Many"}</button>
          <button type="button" className="btn-ghost" onClick={() => setRows([blankDraft(), blankDraft(), blankDraft()])}>Clear</button>
        </div>
      </form>

      {(created.length > 0 || failures.length > 0) && (
        <section className="card mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Batch result</h2>
            {created.length > 0 && <button className="btn-secondary" onClick={copyAllLinks}>Copy all links</button>}
          </div>
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
