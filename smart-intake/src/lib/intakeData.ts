import { prisma } from "./prisma";
import type { Answers } from "./fillPdf";
import { ALL_CONSENT_KEYS } from "@/config/mooreDivineQuestions";
import type { SignatureRecord } from "./signaturePlacement";

export async function loadAnswers(intakeId: string): Promise<Answers> {
  const rows = await prisma.intakeAnswer.findMany({ where: { intakeId } });
  const out: Answers = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

export async function saveAnswers(intakeId: string, answers: Answers): Promise<void> {
  const ops = Object.entries(answers).map(([key, v]) =>
    prisma.intakeAnswer.upsert({
      where: { intakeId_key: { intakeId, key } },
      create: { intakeId, key, value: JSON.stringify(v) },
      update: { value: JSON.stringify(v) },
    }),
  );
  await prisma.$transaction(ops);
  await prisma.intake.update({ where: { id: intakeId }, data: { lastActivityAt: new Date() } });
}

export async function loadSignatures(intakeId: string): Promise<Record<string, SignatureRecord>> {
  const rows = await prisma.signature.findMany({ where: { intakeId } });
  const out: Record<string, SignatureRecord> = {};
  for (const r of rows) {
    out[r.role] = {
      role: r.role, imageData: r.imageData, printedName: r.printedName, signedDate: r.signedDate,
    };
  }
  return out;
}

export function consentsFromAnswers(answers: Answers): Record<string, boolean> {
  const consents: Record<string, boolean> = {};
  for (const key of ALL_CONSENT_KEYS) consents[key] = answers[key] === true || answers[key] === "Yes";
  // discharge-time consent is a staff workflow, not part of the client wizard
  consents.consent_discharge = answers.consent_discharge === true;
  return consents;
}

/**
 * Mirrors repeat-group answers into the typed tables so staff tooling and
 * reports can query structured rows (release consents, referrals, emergency
 * contacts, medications, substances, treatment-plan rows).
 */
export async function syncStructuredRows(intakeId: string, a: Answers): Promise<void> {
  const s = (k: string) => (a[k] == null ? "" : String(a[k]));
  await prisma.$transaction([
    prisma.releaseConsent.deleteMany({ where: { intakeId } }),
    prisma.referral.deleteMany({ where: { intakeId } }),
    prisma.emergencyContact.deleteMany({ where: { intakeId } }),
    prisma.medication.deleteMany({ where: { intakeId } }),
    prisma.substanceUseRow.deleteMany({ where: { intakeId } }),
    prisma.treatmentPlanSignatureRow.deleteMany({ where: { intakeId } }),
  ]);
  const creates = [];
  for (const i of [1, 2, 3]) {
    if (s(`roi${i}_recipient`)) {
      creates.push(prisma.releaseConsent.create({
        data: {
          intakeId, slot: i, recipient: s(`roi${i}_recipient`),
          items: JSON.stringify(a[`roi${i}_items`] ?? []),
          purpose: s(`roi${i}_purpose`), thruDate: s(`roi${i}_thru_date`),
          agreed: a[`roi${i}_agreed`] === true,
        },
      }));
    }
  }
  for (let i = 1; i <= 10; i++) {
    if (s(`ref${i}_name`)) {
      creates.push(prisma.referral.create({
        data: { intakeId, slot: i, name: s(`ref${i}_name`), phone: s(`ref${i}_phone`) },
      }));
    }
  }
  for (const i of [1, 2]) {
    if (s(`ec${i}_name`)) {
      creates.push(prisma.emergencyContact.create({
        data: {
          intakeId, slot: i, name: s(`ec${i}_name`), street: s(`ec${i}_street`),
          city: s(`ec${i}_city`), state: s(`ec${i}_state`), homePhone: s(`ec${i}_home_phone`),
          workPhone: s(`ec${i}_work_phone`), cellPhone: s(`ec${i}_cell_phone`),
        },
      }));
    }
  }
  for (const [key, kind] of [["medications", "prescription"], ["otc_medications", "otc"]] as const) {
    for (const name of s(key).split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean)) {
      creates.push(prisma.medication.create({ data: { intakeId, name, kind } }));
    }
  }
  for (let i = 1; i <= 5; i++) {
    if (s(`sub${i}_name`)) {
      creates.push(prisma.substanceUseRow.create({
        data: {
          intakeId, slot: i, name: s(`sub${i}_name`), ageFirst: s(`sub${i}_age_first`),
          frequency: s(`sub${i}_freq`), route: s(`sub${i}_route`),
          amount: s(`sub${i}_amount`), lastUsed: s(`sub${i}_last_used`),
        },
      }));
    }
  }
  for (const i of [1, 2, 3]) {
    if (s(`otp_row${i}_staff_date`) || s(`otp_row${i}_client_date`)) {
      creates.push(prisma.treatmentPlanSignatureRow.create({
        data: { intakeId, slot: i, staffDate: s(`otp_row${i}_staff_date`), clientDate: s(`otp_row${i}_client_date`) },
      }));
    }
  }
  if (creates.length) await prisma.$transaction(creates);
}

export async function mappingOverrides() {
  const template = await prisma.pdfTemplate.findUnique({
    where: { name: "Moore Divine Care Client Intake Package" },
    include: { fieldMappings: true },
  });
  return (template?.fieldMappings ?? []).map((m) => ({
    fieldKey: m.fieldKey, page: m.page, ...JSON.parse(m.data),
  }));
}
