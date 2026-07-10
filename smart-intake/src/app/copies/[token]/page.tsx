import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

const COPY_SECTIONS = [
  {
    title: "Client Rights and Responsibilities",
    body:
      "You have the right to be treated with dignity and respect, to be informed about your care, " +
      "to privacy and confidentiality, to ask questions, to speak up or complain without getting in trouble, " +
      "and to receive services in a safe environment. You are responsible for participating in " +
      "services, sharing accurate information, respecting others, and following program safety rules.",
  },
  {
    title: "Client Orientation",
    body:
      "Moore Divine Care explained program services, hours, after-hours access, emergency procedures, " +
      "confidentiality, how to make a complaint, financial responsibilities, service coordination, " +
      "assessment, treatment planning, transition criteria, and program expectations.",
  },
  {
    title: "Consent for Treatment",
    body:
      "You consent to receive services from Moore Divine Care. You were told about confidentiality, " +
      "benefits and risks, alternatives, your right to refuse treatment, client rights, the consumer " +
      "handbook, service-plan copies, fees, how to make a complaint, the rules about being paused or " +
      "removed from the program, and the rules about checking personal belongings.",
  },
  {
    title: "Welcome Letter from the Executive Team",
    body:
      "Welcome to Moore Divine Care. Our mission is to support you and your family with effective, " +
      "efficient, person-centered services. Office hours are Monday through Friday, 10 AM to 4 PM. " +
      "For questions or emergencies, call 336-285-5204.",
  },
  {
    title: "Please Review Carefully",
    body:
      "You acknowledged that the information was explained to you, that you had an opportunity to ask " +
      "questions, and that you were given copies of the required intake information.",
  },
];

export default async function CopiesPage({ params }: { params: { token: string } }) {
  const intake = await prisma.intake.findUnique({
    where: { token: params.token },
    include: { client: true, provider: true },
  });
  if (!intake || (intake.provider && intake.provider.status !== "ACTIVE")) notFound();

  return (
    <main className="mx-auto max-w-3xl p-6">
      <section className="card">
        <h1 className="text-2xl font-bold text-brand">Moore Divine Care intake copies</h1>
        <p className="mt-2 text-sm text-slate-600">
          Client: <b>{intake.client.fullName}</b>
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Keep this page for your records. You may print it or save it as a PDF from your phone or browser.
        </p>
        <p className="mt-4 rounded-lg bg-brand-light p-3 text-sm font-semibold text-brand print:hidden">
          To save or print: use your browser menu and choose Print or Save as PDF.
        </p>
      </section>
      <div className="mt-4 space-y-4">
        {COPY_SECTIONS.map((s) => (
          <section key={s.title} className="card">
            <h2 className="text-lg font-bold">{s.title}</h2>
            <p className="mt-2 leading-relaxed text-slate-700">{s.body}</p>
          </section>
        ))}
      </div>
      <p className="mt-6 text-center text-sm text-slate-500">
        Questions? Call Moore Divine Care at 336-285-5204.
      </p>
    </main>
  );
}
