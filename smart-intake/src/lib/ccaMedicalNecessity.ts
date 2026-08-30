/**
 * Documentation scan helpers for a completed CCA. These encode the four
 * required pieces (recommendation, diagnosis, signature, date) and a
 * Supported / Thin / Mismatch score against current NCDHHS service pages.
 *
 * This is not a coverage decision. Scores use only facts written on the CCA.
 * Policy pages (re-open when criteria change):
 *   8G  https://medicaid.ncdhhs.gov/8g-peer-support-services
 *   8A-6 https://medicaid.ncdhhs.gov/8a-6-community-support-team-cst
 *   8C  https://medicaid.ncdhhs.gov/8c-outpatient-behavioral-health-services-provided-direct-enrolled-providers
 *   8A  https://medicaid.ncdhhs.gov/8a-enhanced-mental-health-and-substance-abuse-services
 *   8A-5 https://medicaid.ncdhhs.gov/8a-5-diagnostic-assessment
 */
import { normalizeDateInput } from "./normalizeDateInput";
import {
  emptyCcaReview,
  type CcaAppMismatch,
  type CcaDiagnosis,
  type CcaFunctionalFact,
  type CcaRecommendedService,
  type CcaReview,
  type CcaServiceScore,
  type CcaSignatureMethod,
} from "./ccaReview";

export const CCA_FRESHNESS_DAYS = 365;

export const CCA_POLICY_PAGES = {
  "8G": "https://medicaid.ncdhhs.gov/8g-peer-support-services",
  "8A-6": "https://medicaid.ncdhhs.gov/8a-6-community-support-team-cst",
  "8C": "https://medicaid.ncdhhs.gov/8c-outpatient-behavioral-health-services-provided-direct-enrolled-providers",
  "8A": "https://medicaid.ncdhhs.gov/8a-enhanced-mental-health-and-substance-abuse-services",
  "8A-5": "https://medicaid.ncdhhs.gov/8a-5-diagnostic-assessment",
} as const;

export type CcaPolicyId = keyof typeof CCA_POLICY_PAGES;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ACCEPTABLE_SIGNATURES = new Set<CcaSignatureMethod>([
  "electronic",
  "typed",
  "docusign",
  "wet-ink",
]);

const SIGNATURE_ALIASES: Record<string, CcaSignatureMethod> = {
  electronic: "electronic",
  "e-sign": "electronic",
  esign: "electronic",
  esignature: "electronic",
  "e-signature": "electronic",
  digital: "electronic",
  typed: "typed",
  typewritten: "typed",
  "/s/": "typed",
  docusign: "docusign",
  "docu-sign": "docusign",
  "docu sign": "docusign",
  "wet-ink": "wet-ink",
  "wet ink": "wet-ink",
  wetink: "wet-ink",
  handwritten: "wet-ink",
  ink: "wet-ink",
  wet: "wet-ink",
};

const SERVICE_ALIASES: Array<{ match: RegExp; name: string; policyId: CcaPolicyId }> = [
  { match: /peer support group|pss group|\bh0038\b.*\bhq\b|\bgroup peer/i, name: "Peer Support Group", policyId: "8G" },
  { match: /peer support|\bpss\b|\bh0038\b/i, name: "Peer Support", policyId: "8G" },
  { match: /community support team|\bcst\b|\bh2015\b/i, name: "Community Support Team", policyId: "8A-6" },
  { match: /medication management|med(?:ication)?\s*mgt|med management|meds management/i, name: "Medication management", policyId: "8C" },
  { match: /outpatient therapy|outpatient behavioral|\bopt\b|individual therapy/i, name: "Outpatient therapy", policyId: "8C" },
  { match: /intensive in[-\s]?home|\biih\b|\bh2022\b/i, name: "Intensive In-Home", policyId: "8A" },
  { match: /diagnostic assessment|\b8a-5\b/i, name: "Diagnostic Assessment", policyId: "8A-5" },
];

const SUD_NAME = /\b(sud|substance(?:[-\s]use)?|alcohol|opioid|cannabis|cocaine|stimulant|amphetamine|sedative|inhalant|hallucinogen|nicotine|tobacco)\b/i;
const MH_NAME = /\b(depress|bipolar|anxiety|ptsd|trauma|schizo|mood|adhd|conduct|odd|ocd|panic|psychosis|personality|adjustment)\b/i;
const IDD_NAME = /\b(intellectual|developmental disabilit|idd|autism spectrum)\b/i;

export type CcaAppSnapshot = {
  clientName?: string;
  clientDob?: string;
  diagnosis?: string;
  services?: string[];
  clinician?: string;
  assessmentDate?: string;
};

export type FinalizeCcaOptions = {
  now?: Date;
  app?: CcaAppSnapshot | null;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function calendarUtc(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

function todayUtc(now: Date): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/** YYYY-MM-DD from any known CCA date spelling; empty when undated. */
export function assessmentDateIso(value: unknown): string {
  return normalizeDateInput(value);
}

/**
 * Assessment date must be a real calendar day, not in the future, and not
 * older than 365 days from today. Encoded here so a model omission cannot
 * mark an expired CCA as current.
 */
export function isAssessmentDateWithinOneYear(iso: string, now = new Date()): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return false;
  const dateUtc = calendarUtc(Number(match[1]), Number(match[2]), Number(match[3]));
  const ageDays = Math.round((todayUtc(now) - dateUtc) / MS_PER_DAY);
  return ageDays >= 0 && ageDays <= CCA_FRESHNESS_DAYS;
}

export function normalizeSignatureMethod(value: unknown): CcaSignatureMethod {
  const raw = text(value).toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!raw) return "missing";
  const dashed = raw.replace(/\s+/g, "-");
  if (ACCEPTABLE_SIGNATURES.has(dashed as CcaSignatureMethod)) return dashed as CcaSignatureMethod;
  if (SIGNATURE_ALIASES[raw]) return SIGNATURE_ALIASES[raw];
  if (SIGNATURE_ALIASES[dashed]) return SIGNATURE_ALIASES[dashed];
  if (/\b(electronic|e-?sign|docusign|typed|typewritten|wet|ink|handwrit)/i.test(raw)) {
    if (/docusign/i.test(raw)) return "docusign";
    if (/typed|typewritten|\/s\//i.test(raw)) return "typed";
    if (/wet|ink|handwrit/i.test(raw)) return "wet-ink";
    return "electronic";
  }
  if (/^(none|missing|absent|no|unsigned|not (signed|present|found))$/i.test(raw)) return "missing";
  return "unknown";
}

export function signatureIsAcceptable(method: unknown): boolean {
  return ACCEPTABLE_SIGNATURES.has(normalizeSignatureMethod(method));
}

function icdCode(value: string): string {
  const match = /\b([A-TV-Z][0-9]{2}(?:\.[0-9A-TV-Z]{1,4})?)\b/i.exec(value);
  return match ? match[1].toUpperCase() : "";
}

export function classifyDiagnosis(dx: CcaDiagnosis | null | undefined): "sud" | "mh" | "idd" | "other" | "" {
  if (!dx) return "";
  const blob = `${dx.code} ${dx.label}`.trim();
  if (!blob) return "";
  const code = icdCode(dx.code) || icdCode(dx.label);
  if (code) {
    const letter = code[0];
    const num = Number(code.slice(1, 3));
    if (letter === "F" && num >= 10 && num <= 19) return "sud";
    if (letter === "F" && num >= 70 && num <= 79) return "idd";
    if (letter === "F") return "mh";
  }
  if (SUD_NAME.test(blob)) return "sud";
  if (IDD_NAME.test(blob) && !MH_NAME.test(blob) && !SUD_NAME.test(blob)) return "idd";
  if (MH_NAME.test(blob)) return "mh";
  return "other";
}

function diagnosisLine(dx: CcaDiagnosis | null | undefined): string {
  if (!dx) return "";
  return [dx.code, dx.label].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function allDiagnoses(review: Pick<CcaReview, "primaryDiagnosis" | "additionalDiagnoses" | "sudDiagnoses">): CcaDiagnosis[] {
  return [
    review.primaryDiagnosis,
    ...review.additionalDiagnoses,
    ...review.sudDiagnoses,
  ].filter((item): item is CcaDiagnosis => !!item && !!(item.code || item.label));
}

export function mapRecommendedService(name: string): { name: string; policyId: string } {
  const trimmed = text(name);
  if (!trimmed) return { name: "", policyId: "" };
  for (const alias of SERVICE_ALIASES) {
    if (alias.match.test(trimmed)) return { name: alias.name, policyId: alias.policyId };
  }
  return { name: trimmed, policyId: "" };
}

function factOn(facts: CcaFunctionalFact[], domain: string): CcaFunctionalFact | undefined {
  return facts.find((fact) => fact.domain.toLowerCase() === domain && fact.present);
}

function functionalSupportCount(facts: CcaFunctionalFact[]): number {
  return ["employment", "budgeting", "housing", "help-needed", "adls"]
    .filter((domain) => !!factOn(facts, domain))
    .length;
}

function scoreService(
  service: { name: string; policyId: string },
  ctx: { hasMh: boolean; hasSud: boolean; facts: CcaFunctionalFact[] },
): { score: CcaServiceScore; reason: string } {
  const hasDx = ctx.hasMh || ctx.hasSud;
  const functional = functionalSupportCount(ctx.facts);
  const help = !!factOn(ctx.facts, "help-needed");
  const housing = !!factOn(ctx.facts, "housing");
  const employment = !!factOn(ctx.facts, "employment");

  switch (service.policyId) {
    case "8G":
      if (!hasDx) {
        return { score: "Mismatch", reason: "8G Peer Support needs a documented MH or SUD diagnosis on the CCA." };
      }
      if (functional === 0) {
        return { score: "Thin", reason: "8G needs a documented recovery or community-living need (work, daily living, housing, or help)." };
      }
      return { score: "Supported", reason: "MH/SUD diagnosis and a documented recovery or community-living need are on the CCA." };
    case "8A-6":
      if (!hasDx) {
        return { score: "Mismatch", reason: "8A-6 CST needs a documented MH or SUD diagnosis on the CCA." };
      }
      if (functional === 0) {
        return { score: "Thin", reason: "CST recommended without functional facts on the CCA." };
      }
      if (functional < 2) {
        return { score: "Thin", reason: "8A-6 CST expects significant impairment in at least two life domains; only one is documented." };
      }
      return { score: "Supported", reason: "MH/SUD diagnosis and two or more documented life-domain impairments are on the CCA." };
    case "8C":
      if (!hasDx) {
        return { score: "Mismatch", reason: "8C outpatient / medication management needs a current DSM diagnosis on the CCA." };
      }
      return { score: "Supported", reason: "A documented MH or SUD diagnosis is on the CCA for this 8C service." };
    case "8A":
      if (!hasDx) {
        return { score: "Mismatch", reason: "8A Intensive In-Home needs a documented MH or SUD diagnosis on the CCA." };
      }
      if (!help && !housing && functional === 0) {
        return { score: "Thin", reason: "8A IIH needs documented instability at home, school, or community, or a stated need for help." };
      }
      return { score: "Supported", reason: "Diagnosis plus documented help-needed or community instability is on the CCA." };
    case "8A-5":
      if (hasDx) {
        return { score: "Supported", reason: "Diagnostic Assessment documentation includes a named diagnosis." };
      }
      return { score: "Thin", reason: "Diagnostic Assessment is named without a completed diagnosis on this CCA." };
    default:
      if (!hasDx && functional === 0) {
        return { score: "Thin", reason: "Service is named on the CCA but has no mapped NCDHHS policy id and no supporting facts." };
      }
      return {
        score: "Thin",
        reason: "Service is named on the CCA; this scan has no mapped 8G / 8A-6 / 8C / 8A policy id.",
      };
  }
}

function foldName(value: unknown): string {
  return text(value)
    .replace(/\s+/g, " ")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();
}

function diagnosisTokens(value: string): Set<string> {
  const tokens = new Set<string>();
  const code = icdCode(value);
  if (code) tokens.add(code.toLowerCase());
  for (const word of value.toLowerCase().split(/[^a-z0-9.]+/)) {
    if (word.length >= 4) tokens.add(word);
  }
  return tokens;
}

function diagnosesOverlap(cca: string, app: string): boolean {
  const left = diagnosisTokens(cca);
  const right = diagnosisTokens(app);
  if (!left.size || !right.size) return false;
  for (const token of left) {
    if (right.has(token)) return true;
  }
  return false;
}

function serviceKey(name: string): string {
  const mapped = mapRecommendedService(name);
  return (mapped.policyId || mapped.name || name).toLowerCase();
}

function looksBlockedField(value: string): boolean {
  return /\b(ssn|social security|medicaid(\s*id)?|mid\s*#|mid number|street|address)\b/i.test(value);
}

function shortValue(value: string): string {
  const clean = text(value).replace(/\s+/g, " ");
  if (looksBlockedField(clean)) return "(on file)";
  return clean.slice(0, 120);
}

function addMismatch(
  out: CcaAppMismatch[],
  field: string,
  cca: string,
  app: string,
  note: string,
) {
  if (looksBlockedField(field) || looksBlockedField(note)) return;
  out.push({
    field,
    cca: shortValue(cca) || "not on CCA",
    app: shortValue(app) || "not in app",
    note,
  });
}

export function compareCcaToApp(review: CcaReview, app?: CcaAppSnapshot | null): CcaAppMismatch[] {
  if (!app) return [];
  const mismatches: CcaAppMismatch[] = [];
  const ccaName = text(review.sourceClientName);
  const appName = text(app.clientName);
  if (ccaName && appName && foldName(ccaName) !== foldName(appName)) {
    addMismatch(mismatches, "identity name", ccaName, appName, "CCA name and app name do not match.");
  }
  const ccaDob = assessmentDateIso(review.sourceClientDob) || text(review.sourceClientDob);
  const appDob = assessmentDateIso(app.clientDob) || text(app.clientDob);
  if (ccaDob && appDob && (assessmentDateIso(ccaDob) || ccaDob) !== (assessmentDateIso(appDob) || appDob)) {
    addMismatch(mismatches, "identity DOB", ccaDob, appDob, "CCA date of birth and app date of birth do not match.");
  }
  const ccaDx = [
    diagnosisLine(review.primaryDiagnosis),
    ...review.additionalDiagnoses.map(diagnosisLine),
    ...review.sudDiagnoses.map(diagnosisLine),
  ].filter(Boolean).join("; ");
  const appDx = text(app.diagnosis);
  if (ccaDx && appDx && !diagnosesOverlap(ccaDx, appDx)) {
    addMismatch(mismatches, "diagnosis", ccaDx, appDx, "CCA diagnosis and app diagnosis do not overlap.");
  } else if (ccaDx && !appDx) {
    addMismatch(mismatches, "diagnosis", ccaDx, "", "CCA names a diagnosis that is not yet in the app.");
  }
  const ccaClinician = text(review.sourceClinician);
  const appClinician = text(app.clinician);
  if (ccaClinician && appClinician && foldName(ccaClinician) !== foldName(appClinician)) {
    addMismatch(mismatches, "clinician", ccaClinician, appClinician, "Assessing clinician on the CCA does not match the app.");
  } else if (ccaClinician && !appClinician) {
    addMismatch(mismatches, "clinician", ccaClinician, "", "CCA clinician is not yet copied into the app.");
  }
  const ccaDate = review.dateIso || assessmentDateIso(review.assessmentDate);
  const appDate = assessmentDateIso(app.assessmentDate);
  if (ccaDate && appDate && ccaDate !== appDate) {
    addMismatch(mismatches, "assessment date", ccaDate, appDate, "CCA assessment date and app assessment date do not match.");
  } else if (ccaDate && !appDate && text(app.assessmentDate)) {
    addMismatch(mismatches, "assessment date", ccaDate, text(app.assessmentDate), "CCA assessment date and app assessment date do not match.");
  }
  const ccaServices = review.recommendedServices.map((item) => item.name).filter(Boolean);
  const appServices = (app.services || []).map((item) => text(item)).filter(Boolean);
  if (ccaServices.length && appServices.length) {
    const appKeys = new Set(appServices.map(serviceKey));
    const missing = ccaServices.filter((name) => !appKeys.has(serviceKey(name)));
    if (missing.length) {
      addMismatch(
        mismatches,
        "recommended services",
        ccaServices.join(", "),
        appServices.join(", "),
        "CCA recommended service(s) are not reflected in the app referral/request fields.",
      );
    }
  }
  return mismatches.slice(0, 20);
}

function asAnswersList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  const raw = text(value);
  if (!raw) return [];
  return raw.split(/[,;|/]+/).map((item) => item.trim()).filter(Boolean);
}

export function appSnapshotFromAnswers(
  answers: Record<string, unknown> | null | undefined,
  client?: { fullName?: string | null; dob?: string | null } | null,
): CcaAppSnapshot {
  const a = answers || {};
  const diagnosis = [
    text(a.sa_primary_diagnosis),
    text(a.sa_secondary_diagnosis),
    text(a.diagnosis_list),
    text(a.current_diagnosis_known),
  ].filter(Boolean).join("; ");
  const services = [
    ...asAnswersList(a.referred_for),
    ...asAnswersList(a.services_requested),
    ...asAnswersList(a.cca_recommendations),
  ];
  return {
    clientName: text(a.client_full_name) || text(client?.fullName),
    clientDob: text(a.dob) || text(client?.dob),
    diagnosis,
    services,
    clinician: text(a.cca_provider_credentials) || text(a.clinician_name),
    assessmentDate: text(a.cca_assessment_date) || text(a.initial_assessment_date) || text(a.assess_date),
  };
}

export function fourComponentsPass(review: CcaReview): boolean {
  return review.hasRecommendation
    && review.hasDiagnosis
    && review.hasSignature
    && review.dateWithinOneYear;
}

export function recommendedServicesClear(review: CcaReview): boolean {
  return review.recommendedServices.length > 0
    && review.recommendedServices.every((item) => item.score === "Supported");
}

/** Staff may call the scan "CCA ready" only when all four pieces pass. */
export function ccaDocumentationReady(review: CcaReview): boolean {
  return fourComponentsPass(review);
}

/**
 * Recompute date, signature, diagnosis, and service scores in code.
 * Never invents a service the CCA did not name.
 */
export function finalizeCcaReview(raw: Partial<CcaReview> | null | undefined, opts: FinalizeCcaOptions = {}): CcaReview {
  const now = opts.now || new Date();
  const base = emptyCcaReview();
  const incoming = raw && typeof raw === "object" ? raw : {};
  const primaryDiagnosis = incoming.primaryDiagnosis && (incoming.primaryDiagnosis.code || incoming.primaryDiagnosis.label)
    ? { code: text(incoming.primaryDiagnosis.code), label: text(incoming.primaryDiagnosis.label) }
    : null;
  const additionalDiagnoses = (incoming.additionalDiagnoses || [])
    .map((item) => ({ code: text(item?.code), label: text(item?.label) }))
    .filter((item) => item.code || item.label)
    .slice(0, 12);
  const sudDiagnoses = (incoming.sudDiagnoses || [])
    .map((item) => ({ code: text(item?.code), label: text(item?.label) }))
    .filter((item) => item.code || item.label)
    .slice(0, 12);
  const functionalFacts = (incoming.functionalFacts || []).filter((item) => text(item?.domain)).slice(0, 20);

  const classes = allDiagnoses({ primaryDiagnosis, additionalDiagnoses, sudDiagnoses }).map(classifyDiagnosis);
  const hasMh = classes.includes("mh");
  const hasSud = classes.includes("sud") || sudDiagnoses.length > 0;
  const hasDiagnosis = !!(primaryDiagnosis || additionalDiagnoses.length || sudDiagnoses.length);

  const recommendedServices = (incoming.recommendedServices || [])
    .map((item) => {
      const mapped = mapRecommendedService(item?.name);
      if (!mapped.name) return null;
      const scored = scoreService(mapped, { hasMh, hasSud, facts: functionalFacts });
      return {
        name: mapped.name,
        policyId: mapped.policyId,
        score: scored.score,
        reason: scored.reason,
      };
    })
    .filter((item): item is CcaRecommendedService => !!item)
    .filter((item, index, all) => all.findIndex((other) => other.name === item.name && other.policyId === item.policyId) === index);

  const dateIso = assessmentDateIso(incoming.dateIso) || assessmentDateIso(incoming.assessmentDate);
  const signatureMethod = normalizeSignatureMethod(incoming.signatureMethod);
  const hasSignature = signatureIsAcceptable(signatureMethod);
  const dateWithinOneYear = isAssessmentDateWithinOneYear(dateIso, now);

  const review: CcaReview = {
    ...base,
    sourceClinician: text(incoming.sourceClinician),
    assessmentDate: text(incoming.assessmentDate),
    prescriptionMedications: (incoming.prescriptionMedications || []).map(text).filter(Boolean).slice(0, 100),
    otcMedications: (incoming.otcMedications || []).map(text).filter(Boolean).slice(0, 100),
    majorErrors: (incoming.majorErrors || []).map(text).filter(Boolean).slice(0, 20),
    warnings: (incoming.warnings || []).map(text).filter(Boolean).slice(0, 30),
    hasRecommendation: recommendedServices.length > 0,
    hasDiagnosis,
    hasSignature,
    signatureMethod,
    dateIso,
    dateWithinOneYear,
    primaryDiagnosis,
    additionalDiagnoses,
    sudDiagnoses,
    dualDiagnosis: hasMh && hasSud,
    recommendedServices,
    appMismatches: [],
    functionalFacts,
    sourceClientName: text(incoming.sourceClientName),
    sourceClientDob: text(incoming.sourceClientDob),
  };
  review.appMismatches = compareCcaToApp(review, opts.app);
  return review;
}

export function diagnosisSummary(review: CcaReview): string {
  if (review.dualDiagnosis) return "Dual (MH + SUD)";
  const classes = allDiagnoses(review).map(classifyDiagnosis);
  if (classes.includes("mh")) return "MH only";
  if (classes.includes("sud") || review.sudDiagnoses.length) return "SUD only";
  if (review.hasDiagnosis) return "Documented";
  return "Not documented";
}
