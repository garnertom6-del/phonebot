import { SECTIONS } from "@/config/mooreDivineQuestions";
import { brandText } from "@/lib/providerBranding";
import PrintPageButton from "@/components/PrintPageButton";

const RIGHTS_SECTION_KEYS = new Set(["orientation", "rights", "hipaa", "confidentiality"]);
const GENERIC_BRANDING = {
  name: "your provider",
  phone: "the number your care team gave you",
};

export default function GeneralClientRightsPage() {
  const sections = SECTIONS.filter((section) => RIGHTS_SECTION_KEYS.has(section.key));
  return (
    <main className="mx-auto max-w-4xl p-4 pb-12 sm:p-6 print:p-0">
      <section className="rounded-2xl border-2 border-brand/20 bg-white p-5 shadow-sm print:border-0 print:shadow-none">
        <p className="text-sm font-bold uppercase tracking-wide text-brand">General client reference</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">Client rights, privacy &amp; confidentiality</h1>
        <p className="mt-3 rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-900">This page stays available even when a secure intake link is invalid or expired.</p>
        <p className="mt-4 leading-7 text-slate-700">Read these sections at your own pace. Your provider must give you its approved notices, contact information, grievance process, and a paper copy on request.</p>
        <div className="mt-5 print:hidden"><PrintPageButton label="Download or print this rights reference" /></div>
      </section>

      <div className="mt-5 space-y-4">
        {sections.map((section) => (
          <section key={section.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm print:break-inside-avoid print:shadow-none">
            <h2 className="text-2xl font-bold text-brand">{brandText(section.title, GENERIC_BRANDING)}</h2>
            {section.intro && <p className="mt-3 leading-7 text-slate-700">{brandText(section.intro, GENERIC_BRANDING)}</p>}
            <div className="mt-4 space-y-4">
              {section.questions.filter((question) => !question.staffOnly).map((question) => (
                <article key={question.key} className="rounded-xl bg-slate-50 p-4 print:bg-white">
                  <h3 className="font-bold text-slate-900">{brandText(question.label, GENERIC_BRANDING)}</h3>
                  {question.consentText && <p className="mt-2 whitespace-pre-line leading-7 text-slate-700">{brandText(question.consentText, GENERIC_BRANDING)}</p>}
                  {question.help && <p className="mt-2 text-sm text-slate-600">{brandText(question.help, GENERIC_BRANDING)}</p>}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-5 print:border-slate-200 print:bg-white">
        <h2 className="text-xl font-bold text-sky-950">Official privacy and records information</h2>
        <ul className="mt-3 space-y-3 font-semibold text-sky-950 print:list-disc print:pl-5">
          <li><a className="underline" href="https://connect.medicaid.ncdhhs.gov/beneficiary" target="_blank" rel="noreferrer">NC Medicaid health-record and HIPAA rights</a></li>
          <li><a className="underline" href="https://www.ncdhhs.gov/notice-privacy-practices" target="_blank" rel="noreferrer">NCDHHS Notice of Privacy Practices</a></li>
          <li><a className="underline" href="https://www.ncdhhs.gov/divisions/state-operated-healthcare-facilities/patientsresidents-rights" target="_blank" rel="noreferrer">NCDHHS patient rights and Disability Rights NC contact</a></li>
          <li><a className="underline" href="https://medicaid.ncdhhs.gov/tailored-care-management/help" target="_blank" rel="noreferrer">NC Medicaid Ombudsman and Tailored Care Management help</a></li>
        </ul>
      </section>
    </main>
  );
}
