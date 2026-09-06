"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ncTracksRequest } from "@/lib/ncTracksClientRequest";
import { validNpi } from "@/lib/npi";
import { NCTRACKS_PROVIDER } from "@/lib/ncTracksProvider";

type HostConfig = {
  authorizedNpi: string | null;
  host: { id: string; name: string; lastSeenAt: string | null; revokedAt: string | null; expiresAt: string; adapterReady: boolean } | null;
};
type HostCredential = { hostId: string; hostToken: string; expiresAt: string };
function time(value: string | null | undefined) { return value ? new Date(value).toLocaleString() : "Not connected yet"; }

export default function NcTracksSetup({ providerId, onChanged }: { providerId: string; onChanged: () => Promise<void> }) {
  const [config, setConfig] = useState<HostConfig | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [credential, setCredential] = useState<HostCredential | null>(null);
  const generation = useRef(0);
  const endpoint = `/api/nctracks/config?providerId=${encodeURIComponent(providerId)}`;
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const body = await ncTracksRequest<HostConfig>(`/api/nctracks/config?providerId=${encodeURIComponent(providerId)}`);
      if (current === generation.current) { setConfig(body); setError(""); }
    } catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : "Setup could not be loaded."); }
  }, [providerId]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);

  async function update(body: Record<string, string>, message: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await ncTracksRequest<Partial<HostCredential>>(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (body.action === "provision_host" && result.hostToken && result.hostId && result.expiresAt) {
        // Preserve the one-time credential before optional follow-up reads.
        setCredential({ hostToken: result.hostToken, hostId: result.hostId, expiresAt: result.expiresAt });
      }
      if (body.action === "revoke_host") setCredential(null);
      setNotice(message);
      await load();
      await onChanged();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Setup change could not be confirmed. Reload before retrying."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function configure(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get("authorized") !== "on") { setError("Confirm that this provider is authorized to use the NPI before saving."); return; }
    const authorizedNpi = String(data.get("authorizedNpi") || "").trim();
    if (!validNpi(authorizedNpi)) { setError("Enter a valid 10-digit provider NPI including its check digit."); return; }
    void update({ action: "configure", authorizedNpi }, "Provider NPI authorization saved.");
  }

  function provision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get("hostAuthorized") !== "on") { setError("Confirm this is the provider's authorized workstation before registering it."); return; }
    const hostName = String(data.get("hostName") || "").trim();
    if (!hostName) { setError("Enter a name for the authorized workstation."); return; }
    void update({ action: "provision_host", hostName }, "Host credential created. Copy it now and connect the authorized workstation. Registration alone does not run portal lookups.");
  }

  return <details className="mt-6 min-w-0 rounded-2xl border border-slate-300 bg-white p-4">
    <summary className="min-h-11 cursor-pointer py-2 text-lg font-bold">Administrator setup</summary>
    <p className="mt-2 text-sm text-slate-600">Authorize this provider's NPI and register its lookup workstation. Use the workstation for portal sign-in. Never enter a portal password or one-time code on this page.</p>
    <p className="mt-2 text-sm text-slate-600">The Windows bridge requires a configured Codex browser connector and an already signed-in NCTracks session in Microsoft Edge. Keep that computer running. An operator must handle sign-in, MFA or an expired session there before retrying.</p>
    {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
    {notice && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{notice}</p>}
    {!config && !error && <p className="mt-3 text-sm" role="status">Loading setup…</p>}
    <button type="button" disabled={busy} className="btn-ghost mt-3 min-h-11 text-sm" onClick={() => void load()}>Reload setup</button>
    {config && <div className="mt-4 grid min-w-0 gap-5 md:grid-cols-2">
      <form onSubmit={configure} className="min-w-0 rounded-xl bg-slate-50 p-4"><fieldset disabled={busy} className="min-w-0 space-y-3">
        <legend className="mb-2 font-bold">1. Authorize provider NPI</legend>
        <p className="break-words text-sm text-slate-600">Current authorized NPI: {config.authorizedNpi || "Not configured"}</p>
        <p className="font-semibold text-sm">{NCTRACKS_PROVIDER.name}</p>
        <label className="block min-w-0"><span className="label">Provider NPI</span><input name="authorizedNpi" className="input min-h-11" value={NCTRACKS_PROVIDER.npi} readOnly /></label>
        <p className="text-xs text-slate-600">All NCTracks inquiries use this organization and NPI. This selection does not change the intake's provider or packet details.</p>
        <label className="flex items-start gap-3 text-sm"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" name="authorized" required /><span>I confirm this provider is authorized to use this NPI for NCTracks eligibility lookups.</span></label>
        <button className="btn-secondary min-h-11 w-full">{busy ? "Saving…" : "Save NPI authorization"}</button>
      </fieldset></form>
      <form onSubmit={provision} className="min-w-0 rounded-xl bg-slate-50 p-4"><fieldset disabled={busy || !config.authorizedNpi} className="min-w-0 space-y-3">
        <legend className="mb-2 font-bold">2. Register authorized workstation</legend>
        <label className="block min-w-0"><span className="label">Workstation name</span><input name="hostName" className="input min-h-11" maxLength={80} required placeholder="For example: Eligibility office PC" autoComplete="off" /></label>
        <label className="flex items-start gap-3 text-sm"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" name="hostAuthorized" required /><span>I am registering the provider's authorized lookup workstation.</span></label>
        <button className="btn-secondary min-h-11 w-full">{busy ? "Saving…" : config.host && !config.host.revokedAt ? "Replace host credential" : "Create host credential"}</button>
        <p className="text-xs text-slate-600">The credential is shown once. A new credential replaces existing host access; saved lookup history remains.</p>
      </fieldset></form>
    </div>}
    {credential && <section className="mt-4 min-w-0 rounded-xl border-2 border-amber-300 bg-amber-50 p-4" aria-labelledby="one-time-host-credential">
      <h3 className="font-bold" id="one-time-host-credential">Copy this host credential now</h3>
      <p className="mt-2 text-sm">This credential is only shown in this session. Give it only to the authorized workstation setup. It is not a portal password.</p>
      <label className="mt-3 block"><span className="label">One-time host credential</span><textarea className="input min-w-0 break-all font-mono text-xs" value={credential.hostToken} readOnly rows={3} autoComplete="off" spellCheck={false} onFocus={(event) => event.currentTarget.select()} /></label>
      <p className="mt-2 break-all text-xs">Host ID: {credential.hostId} · Expires {time(credential.expiresAt)}</p>
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-secondary min-h-11" onClick={async () => {
        try { await navigator.clipboard.writeText(credential.hostToken); setNotice("Host credential copied. Keep it only in the authorized workstation's protected setup."); }
        catch { setNotice("Select the credential above and copy it manually."); }
      }}>Copy credential</button><button type="button" className="btn-ghost min-h-11" onClick={() => setCredential(null)}>Hide credential</button></div>
    </section>}
    {config?.host && <section className="mt-4 min-w-0 rounded-xl border border-slate-200 p-4" aria-labelledby="registered-host-heading">
      <h3 className="break-words font-bold" id="registered-host-heading">Registered workstation: {config.host.name}</h3>
      <p className="mt-2 text-sm">{config.host.revokedAt ? `Credential revoked ${time(config.host.revokedAt)}.` : config.host.adapterReady ? "The workstation has reported its lookup adapter ready." : "The workstation has not reported a ready lookup adapter."}</p>
      <p className="mt-1 text-sm">Last connection: {time(config.host.lastSeenAt)}</p>
      {!config.host.revokedAt && <button type="button" className="btn-ghost mt-3 min-h-11 text-sm" disabled={busy} onClick={() => void update({ action: "revoke_host" }, "Host credential revoked. Reconnect with a new credential before further lookups.")}>Revoke host credential</button>}
    </section>}
  </details>;
}
