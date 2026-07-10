"use client";
import Link from "next/link";
import { useState } from "react";
import { intakeMailtoHref, intakeShareMessage, intakeSmsHref } from "@/lib/shareLinks";

const FIELDS = [
  ["fullName", "Client full name *", "text"], ["dob", "Date of birth *", "date"],
  ["midNumber", "MID#", "text"], ["recordNumber", "Record# *", "text"],
  ["intakeDate", "Date of intake", "date"], ["location", "Location", "text"],
  ["email", "Client email", "email"], ["phone", "Client phone", "tel"],
  ["guardianName", "Guardian name (if applicable)", "text"],
  ["guardianEmail", "Guardian email", "email"], ["guardianPhone", "Guardian phone", "tel"],
] as const;

function todayInputDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export default function NewIntake() {
  const [form, setForm] = useState<Record<string, string>>({ location: "Greensboro", intakeDate: todayInputDate() });
  const [expectCca, setExpectCca] = useState(true);
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<{ id: string; clientLink: string; linkDays?: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [messageCopied, setMessageCopied] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const [ncTracksTab, setNcTracksTab] = useState<"upload" | "notes" | "lookup">("upload");
  const [helperNotes, setHelperNotes] = useState("");
  const [ncTracksFile, setNcTracksFile] = useState<File | null>(null);
  const [setupStatus, setSetupStatus] = useState("");
  const [setupStatusKind, setSetupStatusKind] = useState<"success" | "error" | "info">("info");

  async function readResponse(res: Response) {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text };
    }
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

  async function applyStarterInfo(intakeId: string) {
    const notes = helperNotes.trim();
    const messages: string[] = [];
    let hadError = false;

    if (notes) {
      const res = await fetch(`/api/intakes/${intakeId}/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: {}, helperNotes: notes }),
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSetupStatus("");
    setIsCreating(true);
    try {
      const res = await fetch("/api/intakes", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, expectCca }),
      });
      const body = await readResponse(res);
      if (res.ok) {
        const created = body as { id: string; clientLink: string; linkDays?: number };
        await applyStarterInfo(created.id);
        setResult(created);
      }
      else setError((body as { error?: string }).error || "Failed to create intake");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the intake right now.");
    } finally {
      setIsCreating(false);
    }
  }

  async function sendWithApp() {
    if (!result) return;
    setSendStatus("Sending...");
    const res = await fetch(`/api/intakes/${result.id}/remind`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const sent = Array.isArray(body.sent) ? body.sent : [];
      const failed = Array.isArray(body.failed) ? body.failed : [];
      const parts = [
        sent.length ? `Sent: ${sent.join(", ")}` : "",
        failed.length ? `Not sent: ${failed.join("; ")}` : "",
      ].filter(Boolean);
      setSendStatus(parts.length ? parts.join(" | ") : "No phone or email saved for this client.");
    } else {
      setSendStatus(`Send failed: ${body.error || res.status}`);
    }
  }

  if (result) {
    const phone = form.phone || form.guardianPhone || "";
    const email = form.email || form.guardianEmail || "";
    const message = intakeShareMessage(result.clientLink);
    return (
      <main className="mx-auto max-w-xl p-6">
        <div className="card">
          <h1 className="text-xl font-bold text-emerald-600">Intake created</h1>
          <p className="mt-2 text-sm text-slate-600">
            Package: <b>Moore Divine Care Client Intake Package</b>. Send the client this secure
            link (works for {result.linkDays || 7} days, no client info in the URL):
          </p>
          <div className="mt-3 break-all rounded-lg bg-slate-100 p-3 font-mono text-sm">{result.clientLink}</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button className="btn-primary" onClick={async () => {
              await navigator.clipboard.writeText(result.clientLink); setCopied(true);
            }}>{copied ? "Copied" : "Copy client link"}</button>
            <a className="btn-primary text-center" href={intakeSmsHref(phone, result.clientLink)}>
              Open SMS on this computer
            </a>
            <button className="btn-ghost" onClick={() => { void sendWithApp(); }}>
              Send SMS/email now
            </button>
            <a className="btn-ghost text-center" href={intakeMailtoHref(email, result.clientLink)}>
              Open email
            </a>
            <button className="btn-ghost" onClick={async () => {
              await navigator.clipboard.writeText(message); setMessageCopied(true);
            }}>{messageCopied ? "Message copied" : "Copy text message"}</button>
            <Link href={`/intakes/${result.id}`} className="btn-secondary">Open intake & staff setup</Link>
          </div>
          {setupStatus && (
            <p className={`mt-3 rounded-lg p-3 text-sm font-semibold ${
              setupStatusKind === "success" ? "bg-emerald-50 text-emerald-700" :
              setupStatusKind === "error" ? "bg-red-50 text-red-700" :
              "bg-slate-50 text-slate-700"
            }`}>
              {setupStatus}
            </p>
          )}
          {sendStatus && <p className="mt-3 rounded-lg bg-brand-light p-2 text-sm font-semibold text-brand">{sendStatus}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <Link href="/dashboard" className="text-sm text-brand hover:underline">Dashboard</Link>
      <form onSubmit={submit} className="card mt-3">
        <h1 className="mb-1 text-xl font-bold">Create New Intake</h1>
        <p className="mb-4 text-sm text-slate-500">Package: Moore Divine Care Client Intake Package (43 pages)</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map(([key, label, type]) => (
            <div key={key} className={key === "fullName" ? "sm:col-span-2" : ""}>
              <label className="label">{label}</label>
              <input className="input" type={type} value={form[key] || ""}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-900">NC Tracks starter info</h2>
              <p className="mt-1 text-sm text-slate-600">
                Best workflow: create the link fast, but if you already have NC Tracks open you can
                start that work here. The app can open NC Tracks, save quick notes, or scan an NC Tracks
                card / PDF after this intake is created.
              </p>
            </div>
            <a className="btn-ghost px-3 py-1.5 text-sm" href="https://www.nctracks.nc.gov/" target="_blank">
              Open NC Tracks
            </a>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ["upload", "Upload card / PDF"],
              ["notes", "Paste quick notes"],
              ["lookup", "How it works"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setNcTracksTab(key as "upload" | "notes" | "lookup")}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                  ncTracksTab === key ? "bg-brand text-white" : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {ncTracksTab === "upload" && (
            <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-4">
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
          {ncTracksTab === "notes" && (
            <label className="mt-4 block">
              <span className="label">Quick notes</span>
              <textarea
                className="input min-h-[120px]"
                value={helperNotes}
                onChange={(e) => setHelperNotes(e.target.value)}
                placeholder={"Examples:\nMID: 123456789A\nPCP: Guilford County Pediatrics\nPCP phone: 336-555-0100\nRace: Black or African American\nEthnicity: Non-Hispanic/Black\nEmployment status: Unemployed\nEmergency contact: Jane Smith\nEmergency phone: 336-555-0101"}
              />
            </label>
          )}
          {ncTracksTab === "lookup" && (
            <div className="mt-4 rounded-lg bg-white p-4 text-sm text-slate-600">
              The app cannot safely read another signed-in browser tab by itself. The good workflows are:
              open NC Tracks in a new tab, upload a card / PDF to scan, or paste quick notes. If your
              approved NC Tracks integration is connected later, the intake page also has an automatic
              lookup button.
            </div>
          )}
        </div>
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={expectCca}
            onChange={(e) => setExpectCca(e.target.checked)} />
          <span><b>Fast Intake</b> - only ask the client the essentials (about 35 quick
          taps + consents + signature). The clinician&apos;s CCA will fill in the rest when you
          upload it in the <b>Add CCA</b> section on the client&apos;s page. Uncheck for the full question set.</span>
        </label>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button className="btn-primary mt-5 w-full disabled:cursor-not-allowed disabled:opacity-70" disabled={isCreating}>
          {isCreating ? "Creating secure link..." : "Create intake & generate secure link"}
        </button>
      </form>
    </main>
  );
}
