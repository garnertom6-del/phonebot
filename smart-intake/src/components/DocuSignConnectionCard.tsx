"use client";

import { useEffect, useState } from "react";
import type { DocuSignConnection } from "@/lib/docuSignConnectionTypes";

export default function DocuSignConnectionCard() {
  const [connection, setConnection] = useState<DocuSignConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/docusign/connection", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Could not load DocuSign settings. Reload this page to retry.");
        setConnection(await response.json());
      })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);

  async function check() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/docusign/connection", { method: "POST" });
      if (!response.ok) throw new Error("Could not check DocuSign. Refresh your sign-in and try again.");
      setConnection(await response.json());
    } catch (error) {
      setConnection(current => current ? { ...current, status: "not_checked", checkedAt: undefined, accountName: undefined, message: "Connection could not be verified. Try again." } : null);
      setError(error instanceof Error ? error.message : "DocuSign check failed.");
    } finally { setBusy(false); }
  }

  const label = connection?.environment === "sandbox" ? "Sandbox · test account" : connection?.environment === "production" ? "Live account" : "Automatic environment detection";
  return (
    <section aria-labelledby="docusign-connection-heading" className="my-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id="docusign-connection-heading" className="text-lg font-bold text-slate-900">DocuSign connection</h2>
          <p className={`mt-1 text-sm font-semibold ${connection?.environment === "sandbox" ? "text-amber-800" : "text-slate-700"}`}>{connection ? label : "Loading settings…"}</p>
          <div role="status" aria-live="polite" className="mt-2 text-sm text-slate-700">
            <p>{busy ? "Checking account access…" : connection?.message}</p>
            {!busy && connection?.status === "connected" && <p className="mt-1 font-semibold">{connection.environment === "sandbox" ? "Sandbox connection verified" : "Live connection verified"}{connection.accountName ? ` · ${connection.accountName}` : ""}</p>}
          </div>
          {connection?.checkedAt && <p className="mt-1 text-xs text-slate-500">Checked {new Date(connection.checkedAt).toLocaleString()}</p>}
          {!!connection?.missing.length && <p className="mt-2 break-words text-xs text-amber-800">Missing: {connection.missing.join(", ")}</p>}
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
          <p className="mt-2 text-xs text-slate-500">This check verifies the shared server connection without sending an envelope. It does not test signing, delivery or automatic status updates.</p>
        </div>
        <button type="button" className="btn-primary min-h-11 px-4 py-2 text-sm" onClick={() => void check()} disabled={busy || !connection?.configured}>
          {busy ? "Checking…" : "Check DocuSign connection"}
        </button>
      </div>
    </section>
  );
}
