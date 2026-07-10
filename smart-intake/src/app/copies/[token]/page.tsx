import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadAnswers } from "@/lib/intakeData";
import { buildCompletedCopySections, COPY_ALLOWED_STATUSES } from "@/lib/completedCopies";

export default async function CopiesPage({ params }: { params: { token: string } }) {
  const intake = await prisma.intake.findUnique({
    where: { token: params.token },
    include: {
      client: true,
      provider: true,
      signatures: { select: { id: true, role: true, printedName: true, signedDate: true } },
    },
  });
  if (!intake || (intake.provider && intake.provider.status !== "ACTIVE")) notFound();

  if (!COPY_ALLOWED_STATUSES.includes(intake.status)) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section className="card">
          <h1 className="text-2xl font-bold text-brand">Completed copies are not ready yet</h1>
          <p className="mt-3 text-sm text-slate-600">
            This intake has not been submitted or completed yet. Please contact Moore Divine Care
            at 336-285-5204 if you believe this is a mistake.
          </p>
        </section>
      </main>
    );
  }

  const answers = await loadAnswers(intake.id);
  const sections = buildCompletedCopySections(answers);

  return (
    <main className="mx-auto max-w-5xl p-6 print:p-0">
      <section className="mb-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">
          {intake.provider?.name || "Moore Divine Care, Inc."}
        </p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">Completed Intake Copies</h1>
        <div className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
          <p><b>Client:</b> {intake.client.fullName}</p>
          <p><b>Date of birth:</b> {intake.client.dob}</p>
          <p><b>Status:</b> {intake.status.replace("_", " ")}</p>
          <p><b>Prepared:</b> {new Date().toLocaleDateString("en-US")}</p>
        </div>
        <p className="mt-4 text-sm text-slate-600">
          Please read carefully and keep this page for your records. These copies include the
          writing from the intake sections, including orientation, consent for treatment, client
          rights and responsibilities, privacy/confidentiality, emergency care, treatment plan
          participation, and related acknowledgments.
        </p>
        <p className="mt-4 rounded-lg bg-brand-light p-3 text-sm font-semibold text-brand print:hidden">
          To save or print: use your browser menu and choose Print or Save as PDF.
        </p>
      </section>

      <div className="space-y-4">
        {sections.map((section) => (
          <section key={section.key} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:break-inside-avoid print:shadow-none">
            <h2 className="text-xl font-bold text-brand">{section.title}</h2>
            {section.intro && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{section.intro}</p>}
            <div className="mt-4 space-y-4">
              {section.questions.map((q) => (
                <div key={q.key} className="rounded-lg border border-slate-100 bg-slate-50 p-4 print:bg-white">
                  <p className="font-semibold text-slate-900">{q.label}</p>
                  {q.help && <p className="mt-1 text-sm leading-6 text-slate-600">{q.help}</p>}
                  {q.placeholder && <p className="mt-1 text-xs text-slate-500">Prompt: {q.placeholder}</p>}
                  {q.options?.length ? (
                    <p className="mt-1 text-xs text-slate-500">Options: {q.options.join(", ")}</p>
                  ) : null}
                  {q.consentText && (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{q.consentText}</p>
                  )}
                  {q.clientAnswer && (
                    <p className="mt-3 rounded bg-white px-3 py-2 text-sm text-slate-700">
                      <b>Client response:</b> {q.clientAnswer}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm print:shadow-none">
        <h2 className="text-lg font-bold text-brand">Signatures</h2>
        {intake.signatures.length ? (
          <ul className="mt-2 space-y-1">
            {intake.signatures.map((signature) => (
              <li key={signature.id}>
                <b>{signature.role}:</b> {signature.printedName} ({signature.signedDate})
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-slate-500">No signatures are recorded on this copy.</p>
        )}
      </section>

      <p className="mt-6 text-center text-sm text-slate-500">
        Questions? Call Moore Divine Care at 336-285-5204.
      </p>
    </main>
  );
}
