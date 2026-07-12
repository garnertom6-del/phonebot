"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { intakeMailtoHref, intakeShareMessage, intakeSmsHref } from "@/lib/shareLinks";
import { makeRecordNumber, RECORD_NUMBER_GENERATOR_PLAN_OPTIONS, RECORD_NUMBER_LOOKUP_LINKS, RECORD_NUMBER_LOOKUP_PLAN_OPTIONS, recordNumberPrefix } from "@/lib/insurancePlans";

const FIELDS = [
  ["fullName", "Client full name *", "text"], ["dob", "Date of birth *", "date"],
  ["midNumber", "MID#", "text"], ["recordNumber", "Record# (generated if blank)", "text"],
  ["intakeDate", "Date of intake", "date"], ["location", "Location", "text"],
  ["email", "Client email", "email"], ["phone", "Client phone", "tel"],
  ["guardianName", "Guardian name (if applicable)", "text"],
  ["guardianEmail", "Guardian email", "email"], ["guardianPhone", "Guardian phone", "tel"],
  ["addressStreet", "Street address", "text"], ["addressCity", "City", "text"], ["addressState", "State", "text"],
  ["livingArrangement", "Living arrangement", "text"],
] as const;
type FieldKey = (typeof FIELDS)[number][0];

function todayInputDate(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function readFieldValues(formEl: HTMLFormElement, fallback: Record<string, string>): Record<FieldKey, string> {
  const formData = new FormData(formEl);
  return Object.fromEntries(FIELDS.map(([key]) => {
    const value = formData.get(key);
    return [key, typeof value === "string" ? value : (fallback[key] || "")];
  })) as Record<FieldKey, string>;
}

export default function NewIntake() {
  const [form, setForm] = useState<Record<string, string>>({ location: "Greensboro", intakeDate: todayInputDate() });
  const [recordPanel, setRecordPanel] = useState("");
  const [recordTab, setRecordTab] = useState<"generate" | "lookup">("generate");
  const [housingTab, setHousingTab] = useState<"address" | "homeless">("address");
  const [recordGeneratorNote, setRecordGeneratorNote] = useState("");
  const [expectCca, setExpectCca] = useState(true);
  const [error, setError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<{ id: string; clientLink: string; linkDays?: number; recordNumber?: string; providerChoicePlan?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [messageCopied, setMessageCopied] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const [ncTracksTab, setNcTracksTab] = useState<"upload" | "notes" | "lookup">("upload");
  const [helperNotes, setHelperNotes] = useState("");
  const [ncTracksFile, setNcTracksFile] = useState<File | null>(null);
  const [setupStatus, setSetupStatus] = useState("");
  const [setupStatusKind, setSetupStatusKind] = useState<"success" | "error" | "info">("info");
  const [providerName, setProviderName] = useState("Provider");
  const [providerPhone, setProviderPhone] = useState("");
  const [packetName, setPacketName] = useState("Provider Intake Packet");
  const [packetPageCount, setPacketPageCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/intakes/context").then(async (res) => {
      const body = await readResponse(res) as {
        provider?: { name?: string; phone?: string };
        packet?: { name?: string; pageCount?: number };
      };
      if (!res.ok || !active) return;
      setProviderName(body.provider?.name || "Provider");
      setProviderPhone(body.provider?.phone || "");
      setPacketName(body.packet?.name || "Provider Intake Packet");
      setPacketPageCount(typeof body.packet?.pageCount === "number" ? body.packet.pageCount : null);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

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

  function generateRecordNumber() {
    if (!recordPanel) {
      setRecordGeneratorNote("Choose an insurance panel first so the Record# gets the correct prefix.");
      return;
    }
    const generated = makeRecordNumber(recordPanel);
    setForm((current) => ({ ...current, recordNumber: generated }));
    setRecordGeneratorNote(`Generated ${generated} for ${recordPanel}.`);
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

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nextForm = readFieldValues(e.currentTarget, form);
    setForm((current) => ({ ...current, ...nextForm }));
    setError("");
    setSetupStatus("");
    setIsCreating(true);
    try {
      const requestBody = {
        ...form,
        ...nextForm,
        providerChoicePlan: recordPanel,
        livingArrangement: housingTab === "homeless" ? "Homeless" : "",
        expectCca,
      };
      const res = await fetch("/api/intakes", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody),
      });
      const body = await readResponse(res);
      if (res.ok) {
        const created = body as { id: string; clientLink: string; linkDays?: number; recordNumber?: string; providerChoicePlan?: string };
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
    const message = intakeShareMessage(result.clientLink, providerName);
    return (
      <main className="mx-auto max-w-xl p-6">
        <div className="card">
          <h1 className="text-xl font-bold text-emerald-600">Intake created</h1>
          <p className="mt-2 text-sm text-slate-600">
            Package: <b>{packetName}</b>. Send the client this secure
            link (works for {result.linkDays || 7} days, no client info in the URL):
          </p>
          <p className="mt-2 text-sm font-semibold text-brand">
            Record#: {result.recordNumber || "Generated"}{result.providerChoicePlan ? ` (${result.providerChoicePlan})` : ""}
          </p>
          <div className="mt-3 break-all rounded-lg bg-slate-100 p-3 font-mono text-sm">{result.clientLink}</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button className="btn-primary" onClick={async () => {
              await navigator.clipboard.writeText(result.clientLink); setCopied(true);
            }}>{copied ? "Copied" : "Copy client link"}</button>
            <a className="btn-primary text-center" href={intakeSmsHref(phone, result.clientLink, providerName)}>
              Open SMS on this computer
            </a>
            <button className="btn-ghost" onClick={() => { void sendWithApp(); }}>
              Send SMS/email now
            </button>
            <a className="btn-ghost text-center" href={intakeMailtoHref(email, result.clientLink, providerName, providerPhone)}>
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
        <p className="mb-4 text-sm text-slate-500">
          Package: {packetName}{packetPageCount ? ` (${packetPageCount} pages)` : ""}
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.filter(([key]) => !["recordNumber", "addressStreet", "addressCity", "addressState", "livingArrangement"].includes(key)).map(([key, label, type]) => (
            <div key={key} className={key === "fullName" ? "sm:col-span-2" : ""}>
              <label className="label">{label}</label>
              <input className="input" name={key} type={type} value={form[key] || ""}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h2 className="font-bold text-slate-900">Address &amp; housing</h2>
          <p className="mt-1 text-sm text-slate-600">
            Add a confirmed address to save the client time. If the client has no fixed address, use the homeless tab instead and do not enter a made-up street address.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ["address", "Address"],
              ["homeless", "Homeless / no fixed address"],
            ].map(([key, label]) => (
              <button key={key} type="button" onClick={() => setHousingTab(key as "address" | "homeless")}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${housingTab === key ? "bg-brand text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                {label}
              </button>
            ))}
          </div>
          {housingTab === "address" ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {(["addressStreet", "addressCity", "addressState"] as const).map((key) => (
                <label key={key}>
                  <span className="label">{key === "addressStreet" ? "Street address" : key === "addressCity" ? "City" : "State"}</span>
                  <input className="input" name={key} value={form[key] || ""}
                    onChange={(e) => setForm((current) => ({ ...current, [key]: e.target.value }))}
                    placeholder={key === "addressState" ? "NC" : ""} />
                </label>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="font-semibold text-amber-900">Homeless / no fixed address selected</p>
              <p className="mt-1 text-sm text-amber-800">The packet will mark the client as homeless, skip the street-address requirement, and let the client continue without repeating that question.</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label>
                  <span className="label">City or area (optional)</span>
                  <input className="input" name="addressCity" value={form.addressCity || ""}
                    onChange={(e) => setForm((current) => ({ ...current, addressCity: e.target.value }))} />
                </label>
                <label>
                  <span className="label">State (optional)</span>
                  <input className="input" name="addressState" value={form.addressState || ""}
                    onChange={(e) => setForm((current) => ({ ...current, addressState: e.target.value }))} placeholder="NC" />
                </label>
              </div>
              <input type="hidden" name="livingArrangement" value="Homeless" />
            </div>
          )}
        </div>
        <div className="mt-4 rounded-xl border border-brand/20 bg-brand-light/40 p-4">
          <h2 className="font-bold text-brand">Record number generator</h2>
          <p className="mt-1 text-sm text-slate-600">
            Choose the insurance panel, then generate a Record# in the format <b>PANEL-12345</b>.
            The five digits are random and the server checks for duplicates within this provider.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setRecordTab("generate")}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${recordTab === "generate" ? "bg-brand text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
              Generate new Record#
            </button>
            <button type="button" onClick={() => setRecordTab("lookup")}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${recordTab === "lookup" ? "bg-brand text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
              Lookup Partners / Vaya / Alliance / Trillium
            </button>
          </div>
          {recordTab === "generate" ? (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <label>
                <span className="label">Insurance panel</span>
                <select className="input" value={recordPanel} onChange={(e) => setRecordPanel(e.target.value)}>
                  <option value="">Select panel</option>
                  {RECORD_NUMBER_GENERATOR_PLAN_OPTIONS.map((plan) => (
                    <option key={plan} value={plan}>{plan} ({recordNumberPrefix(plan) || "OTHER"})</option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn-secondary" onClick={generateRecordNumber}>Generate Record#</button>
            </div>
          ) : (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">These panels are lookup-only. Open the official site, find the client record, then enter the returned number below.</p>
              <label className="mt-3 block">
                <span className="label">Insurance panel</span>
                <select className="input" value={recordPanel} onChange={(e) => setRecordPanel(e.target.value)}>
                  <option value="">Select lookup panel</option>
                  {RECORD_NUMBER_LOOKUP_PLAN_OPTIONS.map((plan) => (
                    <option key={plan} value={plan}>{plan}</option>
                  ))}
                </select>
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {RECORD_NUMBER_LOOKUP_LINKS.map((link) => (
                  <a key={link.key} className="btn-ghost px-2 py-1 text-xs" href={link.url} target="_blank" rel="noreferrer">
                    {link.label} lookup
                  </a>
                ))}
              </div>
            </div>
          )}
          <label className="mt-3 block">
            <span className="label">Record#</span>
            <input className="input" name="recordNumber" value={form.recordNumber || ""}
              onChange={(e) => setForm((current) => ({ ...current, recordNumber: e.target.value }))}
              placeholder={recordTab === "lookup" ? "Enter the official lookup Record#" : "Generate or type one"} />
          </label>
          {recordGeneratorNote && <p className="mt-2 text-sm font-semibold text-brand">{recordGeneratorNote}</p>}
          <p className="mt-2 text-xs text-slate-500">Only Blue Cross Blue Shield = BCBS-12345, United Health Care = UHC-12345, AmeriHealth = AMERI-12345, and Carolina Complete = CC-12345 use the generator. Other panels require their official Record#.</p>
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
