"use client";
/** Secure client intake link: /intake/[token]. No PHI in the URL. */
import { useEffect, useState } from "react";
import ClientQuestionnaire from "@/components/ClientQuestionnaire";

export default function ClientIntakePage({ params }: { params: { token: string } }) {
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [data, setData] = useState<{ clientName: string; status: string;
    answers: Record<string, string | boolean | number | string[]>;
    signatures: Record<string, { printedName: string }> } | null>(null);

  useEffect(() => {
    fetch(`/api/intake/${params.token}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) { setError(body.error || "This link is not valid."); setState("error"); }
        else { setData(body); setState("ready"); }
      })
      .catch(() => { setError("Could not load - check your connection."); setState("error"); });
  }, [params.token]);

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-10 bg-brand p-4 text-white">
        <h1 className="text-base font-bold">Moore Divine Care, Inc.</h1>
        <p className="text-xs opacity-80">Client Intake - answer by typing or speaking 🎤</p>
      </header>
      <div className="p-4">
        {state === "loading" && <p className="mt-10 text-center text-slate-500">Loading your intake...</p>}
        {state === "error" && (
          <div className="card mx-auto max-w-md text-center">
            <p className="text-lg font-bold text-red-600">Link problem</p>
            <p className="mt-2 text-slate-600">{error}</p>
          </div>
        )}
        {state === "ready" && data && (
          <ClientQuestionnaire token={params.token} clientName={data.clientName}
            initialAnswers={data.answers} initialStatus={data.status}
            signed={{ client: !!data.signatures.client, guardian: !!data.signatures.guardian }} />
        )}
      </div>
    </main>
  );
}
