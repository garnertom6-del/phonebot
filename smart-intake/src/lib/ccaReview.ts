export type CcaDiagnosis = {
  code: string;
  label: string;
};

export type CcaServiceScore = "Supported" | "Thin" | "Mismatch";

export type CcaRecommendedService = {
  name: string;
  policyId: string;
  score: CcaServiceScore;
  reason: string;
};

export type CcaAppMismatch = {
  field: string;
  cca: string;
  app: string;
  note: string;
};

export type CcaFunctionalDomain =
  | "employment"
  | "budgeting"
  | "housing"
  | "help-needed"
  | "adls"
  | string;

export type CcaFunctionalFact = {
  domain: CcaFunctionalDomain;
  present: boolean;
  detail: string;
};

export type CcaSignatureMethod =
  | "electronic"
  | "typed"
  | "docusign"
  | "wet-ink"
  | "unknown"
  | "missing";

export type CcaReview = {
  sourceClinician: string;
  assessmentDate: string;
  prescriptionMedications: string[];
  otcMedications: string[];
  majorErrors: string[];
  warnings: string[];
  hasRecommendation: boolean;
  hasDiagnosis: boolean;
  hasSignature: boolean;
  signatureMethod: CcaSignatureMethod;
  dateIso: string;
  dateWithinOneYear: boolean;
  primaryDiagnosis: CcaDiagnosis | null;
  additionalDiagnoses: CcaDiagnosis[];
  sudDiagnoses: CcaDiagnosis[];
  dualDiagnosis: boolean;
  recommendedServices: CcaRecommendedService[];
  appMismatches: CcaAppMismatch[];
  functionalFacts: CcaFunctionalFact[];
  sourceClientName: string;
  sourceClientDob: string;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item).trim()).filter(Boolean).slice(0, limit);
}

function asDiagnosis(value: unknown): CcaDiagnosis | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CcaDiagnosis>;
  const code = asString(raw.code).trim();
  const label = asString(raw.label).trim();
  if (!code && !label) return null;
  return { code, label };
}

function asDiagnoses(value: unknown, limit: number): CcaDiagnosis[] {
  if (!Array.isArray(value)) return [];
  return value.map(asDiagnosis).filter((item): item is CcaDiagnosis => !!item).slice(0, limit);
}

function asScore(value: unknown): CcaServiceScore | "" {
  const text = asString(value).trim();
  if (text === "Supported" || text === "Thin" || text === "Mismatch") return text;
  return "";
}

function asServices(value: unknown): CcaRecommendedService[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item) => {
    if (typeof item === "string") {
      const name = item.trim();
      return name ? { name, policyId: "", score: "Thin" as const, reason: "" } : null;
    }
    if (!item || typeof item !== "object") return null;
    const raw = item as Partial<CcaRecommendedService>;
    const name = asString(raw.name).trim();
    if (!name) return null;
    return {
      name,
      policyId: asString(raw.policyId).trim(),
      score: asScore(raw.score) || "Thin",
      reason: asString(raw.reason).trim(),
    };
  }).filter((item): item is CcaRecommendedService => !!item);
}

function asFacts(value: unknown): CcaFunctionalFact[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item) => {
    if (!item || typeof item !== "object") return null;
    const raw = item as Partial<CcaFunctionalFact>;
    const domain = asString(raw.domain).trim().toLowerCase();
    if (!domain) return null;
    return {
      domain,
      present: raw.present === true || asString(raw.present).toLowerCase() === "true",
      detail: asString(raw.detail).trim().slice(0, 240),
    };
  }).filter((item): item is CcaFunctionalFact => !!item);
}

function asMismatches(value: unknown): CcaAppMismatch[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item) => {
    if (!item || typeof item !== "object") return null;
    const raw = item as Partial<CcaAppMismatch>;
    const field = asString(raw.field).trim();
    if (!field) return null;
    return {
      field,
      cca: asString(raw.cca).trim().slice(0, 160),
      app: asString(raw.app).trim().slice(0, 160),
      note: asString(raw.note).trim().slice(0, 240),
    };
  }).filter((item): item is CcaAppMismatch => !!item);
}

function asSignatureMethod(value: unknown): CcaSignatureMethod {
  const text = asString(value).trim().toLowerCase().replace(/[_ ]+/g, "-");
  if (text === "electronic" || text === "typed" || text === "docusign" || text === "wet-ink") return text;
  if (text === "missing") return "missing";
  if (text === "unknown" || text) return "unknown";
  return "missing";
}

export function emptyCcaReview(): CcaReview {
  return {
    sourceClinician: "",
    assessmentDate: "",
    prescriptionMedications: [],
    otcMedications: [],
    majorErrors: [],
    warnings: [],
    hasRecommendation: false,
    hasDiagnosis: false,
    hasSignature: false,
    signatureMethod: "missing",
    dateIso: "",
    dateWithinOneYear: false,
    primaryDiagnosis: null,
    additionalDiagnoses: [],
    sudDiagnoses: [],
    dualDiagnosis: false,
    recommendedServices: [],
    appMismatches: [],
    functionalFacts: [],
    sourceClientName: "",
    sourceClientDob: "",
  };
}

/** Shallow parse of stored review JSON. Date/signature/service scores are
 *  applied later by `finalizeCcaReview` so a stale model answer cannot hide
 *  an expired assessment date. */
export function parseCcaReview(value: string | null | undefined): CcaReview | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as Partial<CcaReview>;
    if (!raw || typeof raw !== "object") return null;
    return {
      sourceClinician: asString(raw.sourceClinician),
      assessmentDate: asString(raw.assessmentDate),
      prescriptionMedications: asStringArray(raw.prescriptionMedications, 100),
      otcMedications: asStringArray(raw.otcMedications, 100),
      majorErrors: asStringArray(raw.majorErrors, 20),
      warnings: asStringArray(raw.warnings, 30),
      hasRecommendation: raw.hasRecommendation === true,
      hasDiagnosis: raw.hasDiagnosis === true,
      hasSignature: raw.hasSignature === true,
      signatureMethod: asSignatureMethod(raw.signatureMethod),
      dateIso: asString(raw.dateIso).trim(),
      dateWithinOneYear: raw.dateWithinOneYear === true,
      primaryDiagnosis: asDiagnosis(raw.primaryDiagnosis),
      additionalDiagnoses: asDiagnoses(raw.additionalDiagnoses, 12),
      sudDiagnoses: asDiagnoses(raw.sudDiagnoses, 12),
      dualDiagnosis: raw.dualDiagnosis === true,
      recommendedServices: asServices(raw.recommendedServices),
      appMismatches: asMismatches(raw.appMismatches),
      functionalFacts: asFacts(raw.functionalFacts),
      sourceClientName: asString(raw.sourceClientName).trim(),
      sourceClientDob: asString(raw.sourceClientDob).trim(),
    };
  } catch {
    return null;
  }
}

/**
 * The client may only attest to a clinical assessment after the source names
 * the clinician and assessment date and the accuracy scan has no major error.
 * This prevents a new intake from asking the client to affirm a meeting or
 * assessment that has not happened yet.
 */
export function clientCcaAttestationReady(value: string | null | undefined): boolean {
  const review = parseCcaReview(value);
  return !!review
    && !!review.sourceClinician.trim()
    && !!review.assessmentDate.trim()
    && review.majorErrors.length === 0;
}
