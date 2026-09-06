"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NcTracksContext, NcTracksJobView } from "@/lib/ncTracksJobTypes";
import { localDateOnly, lookupFormError, ncTracksSourceText, NCTRACKS_CANCEL_STATUSES, NCTRACKS_POLL_STATUSES, NCTRACKS_RETRY_STATUSES, NCTRACKS_STATUS_DETAILS, NCTRACKS_STATUS_LABELS, savedLookupDob } from "@/lib/ncTracksUi";
import NcTracksSetup from "./NcTracksSetup";
import { ncTracksRequest } from "@/lib/ncTracksClientRequest";
import { NCTRACKS_PROVIDER } from "@/lib/ncTracksProvider";

function showTime(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Not recorded";
}

export default function NcTracksWorkspace({ providerId, providerName, readOnly }: { providerId: string; providerName: string; readOnly: boolean }) {
  const [context, setContext] = useState<NcTracksContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedIntake, setSelectedIntake] = useState<NcTracksContext["intakes"][number] | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<NcTracksContext["intakes"] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const searchGeneration = useRef(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const busyRef = useRef(new Set<string>());
  const generation = useRef(0);
  const requestKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const [pollRound, setPollRound] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const query = `?providerId=${encodeURIComponent(providerId)}`;
  const load = useCallback(async (manual = false) => {
    const current = ++generation.current;
    if (manual) { setLoading(true); setPollRound(0); }
    try {
      const body = await ncTracksRequest<NcTracksContext>(`/api/nctracks/context?providerId=${encodeURIComponent(providerId)}`);
      if (current !== generation.current) return;
      if (body.providerId !== providerId) throw new Error("Provider context changed. Reopen this workspace from the dashboard.");
      setContext(body);
      setSelectedIntake((selected) => selected ? body.intakes.find((intake) => intake.id === selected.id) || selected : null);
      setLoadError("");
      setUpdatedAt(new Date().toISOString());
    } catch (failure) {
      if (current === generation.current) setLoadError(failure instanceof Error ? failure.message : "Saved requests could not be loaded. Check your connection and reload.");
    } finally { if (current === generation.current) setLoading(false); }
  }, [providerId]);
  useEffect(() => { void load(true); return () => { generation.current++; }; }, [load]);
  useEffect(() => {
    const current = ++searchGeneration.current;
    const text = search.trim();
    if (text.length < 2) { setSearchResults(null); setSearching(false); setSearchError(""); setHasMore(false); return; }
    setSearching(true); setSearchError("");
    const timer = window.setTimeout(async () => {
      try {
        const body = await ncTracksRequest<{ intakes: NcTracksContext["intakes"]; hasMore: boolean }>("/api/nctracks/search", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId, query: text }),
        });
        if (current !== searchGeneration.current) return;
        setSearchResults(body.intakes); setHasMore(body.hasMore);
      } catch (failure) {
        if (current === searchGeneration.current) setSearchError(failure instanceof Error ? failure.message : "Search could not be loaded.");
      } finally { if (current === searchGeneration.current) setSearching(false); }
    }, 300);
    return () => { window.clearTimeout(timer); searchGeneration.current++; };
  }, [providerId, search]);
  const pending = !!context?.jobs.some((job) => NCTRACKS_POLL_STATUSES.has(job.status));
  useEffect(() => {
    if (!pending || pollRound >= 12) return;
    const timer = window.setTimeout(() => {
      setPollRound((round) => round + 1);
      if (document.visibilityState === "visible") void load();
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [pending, pollRound, load]);

  async function run(key: string, action: () => Promise<void>) {
    if (readOnly || busyRef.current.has(key)) return;
    busyRef.current.add(key); setBusy(new Set(busyRef.current));
    setError(""); setNotice("");
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The action could not be confirmed. Reload saved requests before retrying."); }
    finally { busyRef.current.delete(key); setBusy(new Set(busyRef.current)); }
  }

  function retainJob(job: NcTracksJobView) {
    setContext((current) => current ? { ...current, jobs: [job, ...current.jobs.filter((item) => item.id !== job.id)] } : current);
    setPollRound(0);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context?.configuration.configured || readOnly) return;
    const selected = selectedIntake;
    const fields = new FormData(event.currentTarget);
    const input = {
      intakeId: selected?.id || "", firstName: String(fields.get("firstName") || "").trim(),
      lastName: String(fields.get("lastName") || "").trim(), dob: selected ? savedLookupDob(selected.dob) : "",
      serviceDateFrom: String(fields.get("serviceDateFrom") || ""), serviceDateTo: String(fields.get("serviceDateTo") || ""),
    };
    const problem = lookupFormError(input);
    if (problem) { setError(problem); return; }
    const fingerprint = JSON.stringify({ providerId, ...input });
    if (requestKey.current?.fingerprint !== fingerprint) requestKey.current = { fingerprint, key: window.crypto.randomUUID() };
    const idempotencyKey = requestKey.current.key;
    await run("create", async () => {
      const body = await ncTracksRequest<{ job: NcTracksJobView }>(`/api/nctracks/jobs${query}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, idempotencyKey }),
      });
      retainJob(body.job);
      requestKey.current = null;
      setNotice("Lookup request saved. You can close this page; the saved request does not depend on this browser staying open.");
      await load();
    });
  }

  async function jobAction(job: NcTracksJobView, action: "cancel" | "retry") {
    await run(job.id, async () => {
      const body = await ncTracksRequest<{ job: NcTracksJobView }>(`/api/nctracks/jobs/${encodeURIComponent(job.id)}/${action}${query}`, { method: "POST" });
      retainJob(body.job);
      setNotice(action === "cancel" ? "Cancellation saved." : "Retry request saved. Check its status below.");
      await load();
    });
  }

  const selected = selectedIntake;
  const candidates = searchResults || context?.intakes || [];
  const matches = selected && !candidates.some((intake) => intake.id === selected.id) ? [selected, ...candidates] : candidates;
  const queuedForSelected = context?.jobs.some((job) => job.intakeId === selectedId && NCTRACKS_POLL_STATUSES.has(job.status));
  return (
    <main className="mx-auto max-w-5xl min-w-0 p-4 sm:p-6">
      <Link href={`/dashboard${query}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand">← Intake dashboard</Link>
      <header className="mt-2 rounded-2xl bg-brand p-5 text-white sm:p-6"><p className="break-words text-sm text-white/80">{providerName}</p><h1 className="mt-1 text-2xl font-bold sm:text-3xl">NCTracks lookup</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/90">Request a lookup for an existing intake. Review identity, service dates, and source evidence before using the result.</p></header>
      <p className="mt-3 text-sm font-semibold">NCTracks query provider: {NCTRACKS_PROVIDER.name} · NPI {NCTRACKS_PROVIDER.npi}</p>
      {loadError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{loadError}</p>}
      {loading && !context && <p className="mt-4 text-sm" role="status">Loading provider setup and saved requests…</p>}
      {context && <>
        <section className={`mt-4 rounded-xl border p-4 ${context.configuration.configured && context.configuration.hostOnline ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`} aria-labelledby="lookup-connection-heading">
          <h2 id="lookup-connection-heading" className="font-bold">{!context.configuration.configured ? "Setup required" : context.configuration.hostOnline ? "Lookup workstation connected" : "Lookup workstation offline"}</h2>
          <p className="mt-1 break-words text-sm">{context.configuration.reason}</p>
          <p className="mt-2 text-sm">{!context.configuration.configured ? "A provider administrator must authorize the NPI and register a workstation before lookups can be requested." : !context.configuration.hostOnline ? "You can save a request now. It will wait for the authorized workstation to be connected and ready." : "Requests run on the authorized workstation. This page does not log in to the portal."}</p>
        </section>
        {readOnly ? <p className="mt-4 rounded-xl bg-slate-200 p-4 text-sm">This reviewer account can view saved requests and evidence. It cannot request, retry, cancel, or configure lookups.</p> : <section className="card mt-4 min-w-0" aria-labelledby="new-lookup-heading">
          <h2 id="new-lookup-heading" className="text-xl font-bold">Request a lookup</h2>
          <form className="mt-4 space-y-4" onSubmit={submit}>
            <fieldset disabled={busy.has("create")} className="min-w-0 space-y-4">
              <label className="block min-w-0"><span className="label">Find an existing intake</span><input className="input min-h-11" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Search saved name or record number" autoComplete="off" /></label>
              <p className="text-xs text-slate-500" role="status">{searching ? "Searching this provider's saved intakes…" : search.trim().length < 2 ? "Recent intakes are listed below. Enter at least two characters to search all saved intakes." : hasMore ? "More matches are available. Narrow your search." : `${searchResults?.length || 0} matching intake(s).`}</p>
              {searchError && <p role="alert" className="text-sm text-red-800">{searchError} The previous list remains available.</p>}
              <label className="block min-w-0"><span className="label">Client intake</span><select className="input min-h-11 w-full min-w-0" required value={selectedId} onChange={(event) => { const id = event.currentTarget.value; setSelectedId(id); setSelectedIntake(matches.find((intake) => intake.id === id) || null); setError(""); setNotice(""); }}><option value="">Choose an intake</option>{matches.map((intake) => <option key={intake.id} value={intake.id}>{intake.fullName} · {intake.dob}</option>)}</select></label>
              {!context.intakes.length && <p className="text-sm text-slate-600">No eligible intakes are available. <Link className="font-semibold text-brand underline" href="/intakes/new">Create an intake first.</Link></p>}
              {selected && <div key={selected.id} className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="break-words text-sm"><strong>Saved name:</strong> {selected.fullName}</p>
                <p id="lookup-name-help" className="text-sm text-slate-600">Enter the saved given and family names separately. Keep compound names intact. The two fields together must match the saved name.</p>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <label className="min-w-0"><span className="label">First / given name(s)</span><input className="input min-h-11" name="firstName" required maxLength={100} aria-describedby="lookup-name-help" autoComplete="off" /></label>
                  <label className="min-w-0"><span className="label">Last / family name(s)</span><input className="input min-h-11" name="lastName" required maxLength={100} aria-describedby="lookup-name-help" autoComplete="off" /></label>
                  <label className="min-w-0"><span className="label">Saved date of birth</span><input className="input min-h-11 min-w-0" type="date" readOnly value={savedLookupDob(selected.dob)} /></label>
                  <div className="min-w-0"><p className="label">Known MID</p><p className="break-all rounded-lg border border-slate-200 bg-white p-3 text-sm">{selected.midNumber || "Not recorded"}</p></div>
                </div>
                <p className="text-xs text-slate-600">Date of birth and any known MID come from this intake. <Link href={`/intakes/${encodeURIComponent(selected.id)}`} className="font-semibold text-brand underline">Open intake to correct saved identity</Link>.</p>
                {!savedLookupDob(selected.dob) && <p role="alert" className="text-sm font-semibold text-red-700">The saved date of birth needs a complete calendar date. Correct it in the intake before requesting a lookup.</p>}
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <label className="min-w-0"><span className="label">Service date from</span><input name="serviceDateFrom" type="date" className="input min-h-11 min-w-0" defaultValue={localDateOnly()} required /></label>
                  <label className="min-w-0"><span className="label">Service date through</span><input name="serviceDateTo" type="date" className="input min-h-11 min-w-0" defaultValue={localDateOnly()} required /></label>
                </div>
              </div>}
              {queuedForSelected && <p className="text-sm text-amber-800">This intake already has a queued or running lookup. Review that request below before creating another.</p>}
              <button className="btn-primary min-h-12 w-full sm:w-auto" disabled={!context.configuration.configured || !selected || !savedLookupDob(selected.dob) || !!queuedForSelected}>{busy.has("create") ? "Saving request…" : !context.configuration.configured ? "Setup required before lookup" : "Request NCTracks lookup"}</button>
            </fieldset>
          </form>
        </section>}
      </>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
      <section className="mt-6 min-w-0" aria-labelledby="saved-lookups-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="saved-lookups-heading" className="text-xl font-bold">Saved lookup requests</h2><button type="button" className="btn-secondary min-h-11" disabled={loading} onClick={() => void load(true)}>{loading ? "Reloading…" : "Reload requests"}</button></div>
        <p className="mt-2 text-sm text-slate-600">Requests stay saved when this page closes. Results remain separate from intake answers and packet documents; nothing is automatically applied.</p>
        {updatedAt && <p className="mt-1 text-xs text-slate-500">Updated {showTime(updatedAt)}. {pending ? pollRound >= 12 ? "Auto refresh paused. Reload to check again; saved jobs continue independently." : "Checking for updates for up to two minutes." : "Reload to check for later updates."}</p>}
        {context && !context.jobs.length && <p className="mt-4 rounded-xl bg-white p-4 text-sm text-slate-600">No lookup requests have been saved for this provider.</p>}
        <div className="mt-4 space-y-4">{context?.jobs.map((job) => <NcTracksJobCard key={job.id} job={job} readOnly={readOnly} configured={context.configuration.configured} busy={busy.has(job.id)} onAction={jobAction} />)}</div>
      </section>
      {context?.configuration.canManage && !readOnly && <NcTracksSetup providerId={providerId} onChanged={() => load(true)} />}
    </main>
  );
}

function NcTracksJobCard({ job, readOnly, configured, busy, onAction }: { job: NcTracksJobView; readOnly: boolean; configured: boolean; busy: boolean; onAction: (job: NcTracksJobView, action: "cancel" | "retry") => Promise<void> }) {
  const result = job.result;
  const observed = result?.provenance.source === "NCTRACKS_PORTAL";
  const matchedIdentity = observed && job.status === "VERIFIED_LOCAL";
  return <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words font-bold">{job.subject.firstName} {job.subject.lastName}</h3><p className="mt-1 text-sm text-slate-600">Requested service dates: {job.serviceDateFrom} through {job.serviceDateTo}</p><p className="mt-1 break-words text-xs text-slate-500">Requested identity: DOB {job.subject.dob} · Known MID {job.subject.midNumber || "not recorded"}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold">{NCTRACKS_STATUS_LABELS[job.status]}</span></div>
    <p className="mt-3 text-sm text-slate-700">{NCTRACKS_STATUS_DETAILS[job.status]}</p>
    <p className="mt-2 text-xs text-slate-500">Requested {showTime(job.createdAt)} · Attempt {job.attempt}</p>
    {result && <details className="mt-3 min-w-0 rounded-xl border border-sky-200 bg-sky-50 p-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Review returned evidence</summary>
      <p className="mt-2 text-sm font-semibold">{observed ? "Source: NCTracks portal, reported by the authorized workstation" : "No NCTracks portal observation was recorded for this attempt."}</p>
      <dl className="mt-3 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
        <div className="min-w-0"><dt className="font-semibold">{matchedIdentity ? "Observed identity" : "Request identity; no verified match"}</dt><dd className="break-words">{result.subject.firstName} {result.subject.lastName} · DOB {result.subject.dob}</dd></div>
        <div><dt className="font-semibold">Reported coverage</dt><dd>{result.coverage === "ACTIVE" ? "Active" : result.coverage === "INACTIVE" ? "Inactive" : result.coverage === "CONFLICT" ? "Conflicting information — review required" : "Unknown / not established"}</dd></div>
        <div><dt className="font-semibold">Actual inquiry dates</dt><dd className="break-words">From: {ncTracksSourceText(result.actualInquiryFrom)}<br />Through: {ncTracksSourceText(result.actualInquiryTo)}</dd></div>
        <div><dt className="font-semibold">Selected coverage period</dt><dd className="break-words">{ncTracksSourceText(result.selectedCoveragePeriod)}</dd></div>
        <div><dt className="font-semibold">Provider NPI</dt><dd className="break-all">{result.authorizedNpi}</dd></div>
        <div><dt className="font-semibold">{observed ? "Source observed at" : "Attempt recorded at"}</dt><dd>{showTime(result.provenance.observedAt)}</dd></div>
        <div><dt className="font-semibold">{matchedIdentity ? "Returned MID" : "Requested MID"}</dt><dd className="break-all">{ncTracksSourceText(result.subject.midNumber)}</dd></div>
        <div className="min-w-0"><dt className="font-semibold">Carrier / plan as shown</dt><dd className="whitespace-pre-wrap break-words">{ncTracksSourceText(result.sourceCarrierText)}</dd></div>
        <div className="min-w-0"><dt className="font-semibold">Provider / PCP as shown</dt><dd className="whitespace-pre-wrap break-words">{ncTracksSourceText(result.sourceProviderText)}</dd></div>
        <div className="min-w-0"><dt className="font-semibold">Facility as shown</dt><dd className="whitespace-pre-wrap break-words">{ncTracksSourceText(result.sourceFacilityText)}</dd></div>
        <div className="min-w-0"><dt className="font-semibold">Phone as shown</dt><dd className="whitespace-pre-wrap break-words">{ncTracksSourceText(result.sourcePhoneText)}</dd></div>
        <div className="min-w-0"><dt className="font-semibold">County as shown</dt><dd className="whitespace-pre-wrap break-words">{ncTracksSourceText(result.sourceCountyText)}</dd></div>
      </dl>
      <p className="mt-3 break-words text-sm"><strong>Source reference:</strong> {result.provenance.reference || "Not recorded"}</p>
      {result.artifactSha256 && <p className="mt-2 break-all font-mono text-xs"><strong>Evidence SHA-256:</strong> {result.artifactSha256}</p>}
      <p className="mt-3 text-xs text-slate-600">A source reference or file hash is not an eligibility card. Review the source evidence on the authorized workstation; this page has not attached a document or changed coverage.</p>
    </details>}
    {job.code && <p className="mt-2 break-words text-xs text-slate-500">Detail code: {job.code}</p>}
    <div className="mt-3 flex flex-wrap gap-2"><Link className="btn-ghost inline-flex min-h-11 items-center text-sm" href={`/intakes/${encodeURIComponent(job.intakeId)}`}>Open intake</Link>
      {!readOnly && NCTRACKS_RETRY_STATUSES.has(job.status) && <button className="btn-secondary min-h-11 text-sm" type="button" disabled={busy || !configured} onClick={() => void onAction(job, "retry")}>{busy ? "Saving…" : "Retry lookup"}</button>}
      {!readOnly && NCTRACKS_CANCEL_STATUSES.has(job.status) && <button className="btn-ghost min-h-11 text-sm" type="button" disabled={busy} onClick={() => void onAction(job, "cancel")}>Cancel request</button>}
    </div>
  </article>;
}
