import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { Answers } from "./fillPdf";
import { ALL_CONSENT_KEYS } from "@/config/mooreDivineQuestions";
import type { SignatureRecord } from "./signaturePlacement";
import { applyOperationalDefaults } from "./answerDefaults";

export async function loadAnswers(intakeId: string): Promise<Answers> {
  const rows = await prisma.intakeAnswer.findMany({ where: { intakeId } });
  return decodeAnswerRows(rows);
}

export function decodeAnswerRows(rows: Array<{ key: string; value: string }>): Answers {
  const out: Answers = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

export async function saveAnswersInTransaction(
  db: Prisma.TransactionClient,
  intakeId: string,
  answers: Answers,
): Promise<void> {
  for (const [key, value] of Object.entries(answers)) {
    await db.intakeAnswer.upsert({
      where: { intakeId_key: { intakeId, key } },
      create: { intakeId, key, value: JSON.stringify(value) },
      update: { value: JSON.stringify(value) },
    });
  }
}

export async function saveAnswers(intakeId: string, answers: Answers): Promise<void> {
  await prisma.$transaction(async (db) => {
    await saveAnswersInTransaction(db, intakeId, answers);
    await db.intake.update({ where: { id: intakeId }, data: { lastActivityAt: new Date() } });
  });
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
  const withDefaults = applyOperationalDefaults(answers, { forPdf: true });
  for (const key of ALL_CONSENT_KEYS) consents[key] = withDefaults[key] === true || withDefaults[key] === "Yes";
  for (const key of ["roi1_agreed", "roi2_agreed", "roi3_agreed"]) {
    consents[key] = withDefaults[key] === true || withDefaults[key] === "Yes";
  }
  // discharge-time consent is a staff workflow, not part of the client wizard
  consents.consent_discharge = answers.consent_discharge === true;
  return consents;
}

/**
 * Mirrors repeat-group answers into the typed tables so staff tooling and
 * reports can query structured rows (release consents, referrals, emergency
 * contacts, medications, substances, treatment-plan rows).
 */
export async function syncStructuredRowsInTransaction(
  db: Prisma.TransactionClient,
  intakeId: string,
  a: Answers,
): Promise<void> {
  const s = (k: string) => (a[k] == null ? "" : String(a[k]));
  await db.releaseConsent.deleteMany({ where: { intakeId } });
  await db.referral.deleteMany({ where: { intakeId } });
  await db.emergencyContact.deleteMany({ where: { intakeId } });
  await db.medication.deleteMany({ where: { intakeId } });
  await db.substanceUseRow.deleteMany({ where: { intakeId } });
  await db.treatmentPlanSignatureRow.deleteMany({ where: { intakeId } });
  const creates = [];
  for (const i of [1, 2, 3]) {
    if (s(`roi${i}_recipient`)) {
      creates.push(db.releaseConsent.create({
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
      creates.push(db.referral.create({
        data: { intakeId, slot: i, name: s(`ref${i}_name`), phone: s(`ref${i}_phone`) },
      }));
    }
  }
  for (const i of [1, 2]) {
    if (s(`ec${i}_name`)) {
      creates.push(db.emergencyContact.create({
        data: {
          intakeId, slot: i, name: s(`ec${i}_name`), street: s(`ec${i}_street`),
          city: s(`ec${i}_city`), state: s(`ec${i}_state`), homePhone: s(`ec${i}_home_phone`),
          workPhone: s(`ec${i}_work_phone`), cellPhone: s(`ec${i}_cell_phone`),
        },
      }));
    }
  }
  for (const [key, kind] of [["medications", "prescription"], ["otc_medications", "otc"]] as const) {
    // split on ; or newline only - "Strattera, 40mg" is ONE medication with a dose
    for (const entry of s(key).split(/[\n;]+/).map((x) => x.trim()).filter(Boolean)) {
      const m = /^([^,]+),\s*(.+)$/.exec(entry);
      creates.push(db.medication.create({
        data: m
          ? { intakeId, name: m[1].trim(), dosage: m[2].trim(), kind }
          : { intakeId, name: entry, kind },
      }));
    }
  }
  for (let i = 1; i <= 5; i++) {
    if (s(`sub${i}_name`)) {
      creates.push(db.substanceUseRow.create({
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
      creates.push(db.treatmentPlanSignatureRow.create({
        data: { intakeId, slot: i, staffDate: s(`otp_row${i}_staff_date`), clientDate: s(`otp_row${i}_client_date`) },
      }));
    }
  }
  if (creates.length) await Promise.all(creates);
}

export async function syncStructuredRows(intakeId: string, a: Answers): Promise<void> {
  await prisma.$transaction(async (db) => {
    await syncStructuredRowsInTransaction(db, intakeId, a);
  });
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
