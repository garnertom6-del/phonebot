"use client";
import { useState } from "react";
import type { AnswerRevisions } from "@/lib/answerRevisions";
import type { SaveableAnswers } from "@/lib/answerSaveQueue";

export type ReviewedAnswerSnapshot = { answers: SaveableAnswers; answerRevisions: AnswerRevisions; contentRevision: number };

export default function ContentRevisionReview({ endpoint, baselineAnswers, onReviewed, labelForKey }: {
  endpoint: string;
  baselineAnswers: Record<string, unknown>;
  onReviewed: (snapshot: ReviewedAnswerSnapshot) => void;
  labelForKey?: (key: string) => string;
}) {
  const [snapshot, setSnapshot] = useState<ReviewedAnswerSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changes = snapshot ? Object.entries(snapshot.answers).filter(([key, value]) => (
    JSON.stringify(value) !== JSON.stringify(baselineAnswers[key])
  )) : [];
  const display = (value: unknown) => value === undefined || value === null || value === ""
    ? "Blank" : Array.isArray(value) ? value.join(", ") : String(value);
  return (
    <section role="alert" className="my-4 rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
      <h2 className="text-lg font-bold">Review updates before signing</h2>
      <p className="mt-1 text-sm">Another window changed this intake. Your signature has not been saved for those changes.</p>
      {!snapshot && <button type="button" disabled={busy} className="btn-primary mt-3 min-h-[48px]" onClick={async () => {
        setBusy(true); setError("");
        try {
          const response = await fetch(endpoint, { cache: "no-store" });
          const body = await response.json();
          if (!response.ok || !Number.isSafeInteger(body.contentRevision)) throw new Error(body.error || "Could not load the updated intake.");
          setSnapshot(body);
        } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load the updated intake."); }
        finally { setBusy(false); }
      }}>{busy ? "Loading updates..." : "Show the updated answers"}</button>}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {snapshot && <>
        <div className="mt-3 space-y-3">
          {changes.map(([key, value]) => <div key={key} className="rounded-lg bg-white p-3">
            <h3 className="font-semibold">{labelForKey?.(key) || key.replace(/_/g, " ")}</h3>
            <p className="mt-1 break-words text-sm"><b>Previously shown:</b> {display(baselineAnswers[key])}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm"><b>Updated:</b> {display(value)}</p>
          </div>)}
          {!changes.length && <p className="text-sm">The intake version changed without a visible answer change. Ask your provider to review any updated assessment or supporting document before continuing.</p>}
        </div>
        {changes.length > 0 && <button type="button" className="btn-primary mt-4 min-h-[48px]" onClick={() => onReviewed(snapshot)}>I reviewed these updates</button>}
        {!changes.length && <p className="mt-3 text-sm font-semibold">Signing remains on hold until the changed content has been reviewed with your provider.</p>}
      </>}
    </section>
  );
}
