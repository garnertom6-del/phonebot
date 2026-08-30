import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { loadAnswers } from "@/lib/intakeData";
import { buildCompletedCopySections, COPY_ALLOWED_STATUSES } from "@/lib/completedCopies";
import { brandText, providerDisplayName, providerPhone } from "@/lib/providerBranding";
import PrintPageButton from "@/components/PrintPageButton";
import {
  PROVIDER_PACKET_NOT_READY_MESSAGE,
  ProviderPacketNotReadyError,
  requireProviderPacketForCompletion,
} from "@/lib/providerPacketTemplates";

export default async function CopiesPage({ params }: { params: { token: string } }) {
  const intake = await prisma.intake.findUnique({
    where: { token: params.token },
    include: {
      client: true,
      provider: true,
      signatures: { select: { id: true, role: true, printedName: true, signedDate: true } },
    },
  });
  if (
    !intake
    || intake.archived
    || !intake.submittedAt
    || intake.tokenExpiresAt < new Date()
    || (intake.provider && intake.provider.status !== "ACTIVE")
  ) {
    notFound();
  }

  if (!COPY_ALLOWED_STATUSES.includes(intake.status)) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section className="card">
          <h1 className="text-2xl font-bold text-brand">Completed copies are not ready yet</h1>
          <p className="mt-3 text-sm text-slate-600">
            This intake is still pending staff completion. The CCA, required answers, review, QP signature, and final packet must be ready first. Please contact {providerDisplayName(intake.provider?.name)}
            {" "}at {providerPhone(intake.provider?.phone, intake.provider?.name)} if you believe this is a mistake.
          </p>
        </section>
      </main>
    );
  }

  let packetUnavailable = intake.providerId ? "" : PROVIDER_PACKET_NOT_READY_MESSAGE;
  if (intake.providerId) {
    try {
      await requireProviderPacketForCompletion(intake.providerId);
    } catch (error) {
      if (!(error instanceof ProviderPacketNotReadyError)) throw error;
      packetUnavailable = error.message;
    }
  }
  if (packetUnavailable) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <section className="card">
          <h1 className="text-2xl font-bold text-brand">Completed copies are temporarily unavailable</h1>
          <p className="mt-3 text-sm text-slate-600">{packetUnavailable}</p>
          <p className="mt-3 text-sm text-slate-600">
            Your saved intake answers are not affected. Please contact {providerDisplayName(intake.provider?.name)} at{" "}
            {providerPhone(intake.provider?.phone, intake.provider?.name)}.
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
          {providerDisplayName(intake.provider?.name)}
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
        <div className="mt-5 grid gap-3 sm:grid-cols-2 print:hidden">
          <a className="btn-primary min-h-[52px]" href={`/api/copies/${params.token}/packet`}>
            Download completed intake packet
          </a>
          <PrintPageButton label="Save rights and answers as PDF" />
        </div>
        <p className="mt-3 text-xs font-semibold text-slate-500 print:hidden">
          The packet button downloads the provider&apos;s final PDF. The second button saves this readable rights-and-answers page.
        </p>
      </section>

      <div className="space-y-4">
        {sections.map((section) => (
          <section key={section.key} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:break-inside-avoid print:shadow-none">
            <h2 className="text-xl font-bold text-brand">{section.title}</h2>
            {section.intro && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{brandText(section.intro, intake.provider || undefined)}</p>}
            <div className="mt-4 space-y-4">
              {section.questions.map((q) => (
                <div key={q.key} className="rounded-lg border border-slate-100 bg-slate-50 p-4 print:bg-white">
                  <p className="font-semibold text-slate-900">{brandText(q.label, intake.provider || undefined)}</p>
                  {q.help && <p className="mt-1 text-sm leading-6 text-slate-600">{brandText(q.help, intake.provider || undefined)}</p>}
                  {q.placeholder && <p className="mt-1 text-xs text-slate-500">Prompt: {q.placeholder}</p>}
                  {q.options?.length ? (
                    <p className="mt-1 text-xs text-slate-500">Options: {q.options.map((opt) => brandText(opt, intake.provider || undefined)).join(", ")}</p>
                  ) : null}
                  {q.consentText && (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{brandText(q.consentText, intake.provider || undefined)}</p>
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
        Questions? Call {providerDisplayName(intake.provider?.name)} at {providerPhone(intake.provider?.phone, intake.provider?.name)}.
      </p>
    </main>
  );
}
