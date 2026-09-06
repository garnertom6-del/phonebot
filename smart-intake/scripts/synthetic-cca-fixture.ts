import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SYNTHETIC_CCA_IDENTITY = { fullName: "Synthetic E2E Intake", dob: "1991-02-03" };
export function syntheticCcaFixture(assessmentDate = new Date().toISOString().slice(0, 10)) {
  return {
    answers: [
      { key: "client_full_name", value: SYNTHETIC_CCA_IDENTITY.fullName }, { key: "dob", value: SYNTHETIC_CCA_IDENTITY.dob },
      { key: "gender", value: "Other" }, { key: "living_arrangement", value: "Adult Alone" },
      { key: "address_street", value: "100 Synthetic Test Way" }, { key: "address_city", value: "Testville" }, { key: "address_state", value: "NC" },
      { key: "client_phone_cell", value: "2025550101" }, { key: "client_email", value: "synthetic-e2e@example.invalid" },
      { key: "ec1_name", value: "Synthetic Emergency Contact" }, { key: "ec1_cell_phone", value: "2025550102" },
      { key: "presenting_problem", value: "SYNTHETIC TEST SCENARIO: worry and sleep difficulty affect a fictional work routine." },
      { key: "has_current_diagnosis", value: "Yes" }, { key: "diagnosis_list", value: "F41.1 Generalized anxiety disorder (synthetic test scenario only)" },
      { key: "cca_assessment_date", value: assessmentDate }, { key: "cca_provider_credentials", value: "Synthetic Test Clinician, TEST ONLY" },
      { key: "cca_recommendations", value: "Outpatient therapy (fictional test recommendation)" },
    ],
    ccaReview: {
      sourceClinician: "Synthetic Test Clinician, TEST ONLY", assessmentDate,
      prescriptionMedications: [], otcMedications: [], majorErrors: [], warnings: ["Synthetic fixture only; not a real clinical assessment."],
      hasRecommendation: true, hasDiagnosis: true, hasSignature: true, signatureMethod: "typed", dateIso: assessmentDate, dateWithinOneYear: true,
      primaryDiagnosis: { code: "F41.1", label: "Generalized anxiety disorder (synthetic test scenario only)" },
      additionalDiagnoses: [], sudDiagnoses: [], dualDiagnosis: false,
      recommendedServices: [{ name: "Outpatient therapy", policyId: "8C", score: "Supported", reason: "Synthetic test scenario only." }],
      appMismatches: [], functionalFacts: [{ domain: "employment", present: true, detail: "Synthetic worry disrupts a fictional work routine." }],
      sourceClientName: SYNTHETIC_CCA_IDENTITY.fullName, sourceClientDob: SYNTHETIC_CCA_IDENTITY.dob,
    },
  };
}
export async function buildSyntheticCcaPdf(assessmentDate = new Date().toISOString().slice(0, 10)) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("SYNTHETIC TEST CCA - NOT A CLINICAL RECORD");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([612, 792]);
  page.drawText("SYNTHETIC TEST CCA", { x: 40, y: 746, size: 20, font: bold, color: rgb(0.65, 0, 0) });
  page.drawText("NOT A REAL PATIENT, CLINICAL ASSESSMENT, OR AUTHORIZED SIGNATURE", { x: 40, y: 724, size: 9, font: bold });
  const lines = [
    `Client full name: ${SYNTHETIC_CCA_IDENTITY.fullName}`, `Date of birth: ${SYNTHETIC_CCA_IDENTITY.dob}`,
    `Assessment date: ${assessmentDate}`, "Clinician: Synthetic Test Clinician, TEST ONLY", "Gender: Other; living arrangement: Adult Alone",
    "Address: 100 Synthetic Test Way, Testville, NC", "Client cell: 202-555-0101; email: synthetic-e2e@example.invalid",
    "Emergency contact: Synthetic Emergency Contact; phone: 202-555-0102", "",
    "Presenting problem (fictional test scenario): worry and sleep difficulty affect", "a fictional work routine. This statement is test input, not a finding about a person.",
    "Diagnosis (fixture): F41.1 Generalized anxiety disorder.", "Recommendation (fixture): Outpatient therapy.", "Prescription medications: none documented in this synthetic fixture.",
    "Over-the-counter medications: none documented in this synthetic fixture.", "",
    "Synthetic typed-signature marker: /s/ Synthetic Test Clinician, TEST ONLY", `Synthetic signature date: ${assessmentDate}`,
    "The marker above exercises document extraction; it is not an actual attestation.", "",
    "All names, contacts, symptoms, diagnosis, recommendations, and signatures", "on this page are explicitly fictitious. Do not use for care, billing, eligibility,", "clinical approval, or external submission. No consent was granted by this fixture.",
  ];
  lines.forEach((line, index) => page.drawText(line, { x: 40, y: 688 - index * 23, size: 10, font }));
  return Buffer.from(await pdf.save());
}
async function writeFixture() {
  const args = process.argv.slice(2);
  if (args[0] !== "--write" || args.length !== 2 || !path.isAbsolute(args[1])) throw new Error("Use --write <absolute output directory>");
  const output = path.resolve(args[1]);
  if (output === process.cwd() || output.startsWith(`${process.cwd()}${path.sep}`)) throw new Error("Write synthetic artifacts outside the source checkout");
  await fs.mkdir(output, { recursive: true });
  const assessmentDate = new Date().toISOString().slice(0, 10);
  await fs.writeFile(path.join(output, "synthetic-e2e-cca.pdf"), await buildSyntheticCcaPdf(assessmentDate), { flag: "wx" });
  await fs.writeFile(path.join(output, "synthetic-e2e-cca-response.json"), JSON.stringify(syntheticCcaFixture(assessmentDate), null, 2), { flag: "wx" });
  console.log(JSON.stringify({ output, identity: SYNTHETIC_CCA_IDENTITY, assessmentDate }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) void writeFixture().catch((error) => { console.error(error.message); process.exitCode = 1; });
