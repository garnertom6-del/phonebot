export type CcaReview = {
  sourceClinician: string;
  assessmentDate: string;
  prescriptionMedications: string[];
  otcMedications: string[];
  majorErrors: string[];
  warnings: string[];
};

export function parseCcaReview(value: string | null | undefined): CcaReview | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as Partial<CcaReview>;
    return {
      sourceClinician: typeof raw.sourceClinician === "string" ? raw.sourceClinician : "",
      assessmentDate: typeof raw.assessmentDate === "string" ? raw.assessmentDate : "",
      prescriptionMedications: Array.isArray(raw.prescriptionMedications)
        ? raw.prescriptionMedications.map(String).filter(Boolean)
        : [],
      otcMedications: Array.isArray(raw.otcMedications)
        ? raw.otcMedications.map(String).filter(Boolean)
        : [],
      majorErrors: Array.isArray(raw.majorErrors) ? raw.majorErrors.map(String).filter(Boolean) : [],
      warnings: Array.isArray(raw.warnings) ? raw.warnings.map(String).filter(Boolean) : [],
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
