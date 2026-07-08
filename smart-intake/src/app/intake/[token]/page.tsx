"use client";
/**
 * Secure client intake link: /intake/[token]. No PHI in the URL.
 * Clients get Easy Mode by default: one big, simple question at a time -
 * tap an answer or speak it. Append ?mode=full for the dense wizard.
 */
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ClientQuestionnaire from "@/components/ClientQuestionnaire";
import EasyQuestionnaire from "@/components/EasyQuestionnaire";

function IntakeInner({ token }: { token: string }) {
  const searchParams = useSearchParams();
  const fullMode = searchParams.get("mode") === "full";
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [data, setData] = useState<{ clientName: string; status: string;
    answers: Record<string, string | boolean | number | string[]>;
    signatures: Record<string, { printedName: string }> } | null>(null);

  useEffect(() => {
    fetch(`/api/intake/${token}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) { setError(body.error || "This link is not valid."); setState("error"); }
        else { setData(body); setState("ready"); }
      })
      .catch(() => { setError("Could not load - check your connection."); setState("error"); });
  }, [token]);

  return (
    <>
      {state === "loading" && <p className="mt-10 text-center text-slate-500">Loading your questions...</p>}
      {state === "error" && (
        <div className="card mx-auto max-w-md text-center">
          <p className="text-lg font-bold text-red-600">Link problem</p>
          <p className="mt-2 text-slate-600">{error}</p>
        </div>
      )}
      {state === "ready" && data && (fullMode ? (
        <ClientQuestionnaire token={token} clientName={data.clientName}
          initialAnswers={data.answers} initialStatus={data.status}
          signed={{ client: !!data.signatures.client, guardian: !!data.signatures.guardian }} />
      ) : (
        <EasyQuestionnaire token={token} clientName={data.clientName}
          initialAnswers={data.answers} initialStatus={data.status}
          signed={{ client: !!data.signatures.client, guardian: !!data.signatures.guardian }} />
      ))}
    </>
  );
}

export default function ClientIntakePage({ params }: { params: { token: string } }) {
  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-10 bg-brand p-4 text-white">
        <h1 className="text-base font-bold">Moore Divine Care, Inc.</h1>
        <p className="text-xs opacity-80">We are glad you are here 💙</p>
      </header>
      <div className="p-4">
        <Suspense fallback={<p className="mt-10 text-center text-slate-500">Loading...</p>}>
          <IntakeInner token={params.token} />
        </Suspense>
      </div>
    </main>
  );
}
