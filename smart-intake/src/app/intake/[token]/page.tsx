"use client";
/**
 * Secure client intake link: /intake/[token]. No PHI in the URL.
 * Clients get Easy Mode by default: one big, simple question at a time -
 * tap an answer or speak it. Append ?mode=full for the dense wizard.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ClientQuestionnaire from "@/components/ClientQuestionnaire";
import EasyQuestionnaire from "@/components/EasyQuestionnaire";

function IntakeInner({ token }: { token: string }) {
  const searchParams = useSearchParams();
  const fullMode = searchParams.get("mode") === "full";
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [problem, setProblem] = useState<{
    message: string;
    code?: string;
    provider?: { name?: string | null; phone?: string | null } | null;
  }>({ message: "" });
  const [data, setData] = useState<{ clientName: string; status: string; quick?: boolean;
    provider?: { name?: string | null; phone?: string | null };
    answers: Record<string, string | boolean | number | string[]>;
    signatures: Record<string, { printedName: string }> } | null>(null);

  const load = useCallback(() => {
    setState("loading");
    setProblem({ message: "" });
    fetch(`/api/intake/${token}`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) {
          setProblem({
            message: body.error || "This link is not valid.",
            code: body.code,
            provider: body.provider,
          });
          setState("error");
        }
        else { setData(body); setState("ready"); }
      })
      .catch(() => {
        setProblem({ message: "We could not open the secure form. Check your connection and try again." });
        setState("error");
      });
  }, [token]);

  useEffect(load, [load]);

  return (
    <>
      {state === "loading" && <p className="mt-10 text-center text-slate-500">Loading your questions...</p>}
      {state === "error" && (
        <div className="card mx-auto max-w-md text-center" role="alert">
          <h2 className="text-xl font-bold text-slate-900">
            {problem.code === "LINK_EXPIRED"
              ? "This link has expired"
              : problem.code === "INTAKE_FINISHED"
                ? "Your intake was already submitted"
                : "We could not open this link"}
          </h2>
          <p className="mt-2 text-slate-600">{problem.message}</p>
          {problem.code === "LINK_EXPIRED" && (
            <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
              Your saved answers are still there. Ask {problem.provider?.name || "your provider"} to send you a new secure link.
            </p>
          )}
          {problem.code === "INTAKE_FINISHED" && (
            <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
              Your saved answers and signature are protected. No further action is needed unless your provider contacts you.
            </p>
          )}
          <div className="mt-4 grid gap-2">
            {problem.provider?.phone && (
              <a className="btn-primary w-full" href={`tel:${problem.provider.phone.replace(/[^\d+]/g, "")}`}>
                Call {problem.provider.name || "your provider"} at {problem.provider.phone}
              </a>
            )}
            {!["LINK_EXPIRED", "INTAKE_FINISHED"].includes(problem.code || "") && (
              <button type="button" className="btn-ghost w-full" onClick={load}>
                Try this link again
              </button>
            )}
          </div>
          {!problem.provider?.phone && (
            <p className="mt-3 text-sm text-slate-500">Please contact your provider for help with the link.</p>
          )}
        </div>
      )}
      {state === "ready" && data && (fullMode ? (
        <ClientQuestionnaire token={token} clientName={data.clientName}
          providerName={data.provider?.name || undefined}
          providerPhone={data.provider?.phone || undefined}
          initialAnswers={data.answers} initialStatus={data.status}
          signed={{ client: !!data.signatures.client, guardian: !!data.signatures.guardian }} />
      ) : (
        <EasyQuestionnaire token={token} clientName={data.clientName}
          providerName={data.provider?.name || undefined}
          providerPhone={data.provider?.phone || undefined}
          initialAnswers={data.answers} initialStatus={data.status} quick={!!data.quick}
          signed={{ client: !!data.signatures.client, guardian: !!data.signatures.guardian }} />
      ))}
    </>
  );
}

export default function ClientIntakePage({ params }: { params: { token: string } }) {
  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-10 bg-brand p-4 text-white">
        <h1 className="text-base font-bold">Client Intake</h1>
        <p className="text-xs opacity-80">Start your intake for services.</p>
      </header>
      <div className="p-4">
        <Suspense fallback={<p className="mt-10 text-center text-slate-500">Loading...</p>}>
          <IntakeInner token={params.token} />
        </Suspense>
      </div>
    </main>
  );
}
