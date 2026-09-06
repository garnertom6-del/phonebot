export const NCTRACKS_JOB_STATUSES = ["NOT_CONFIGURED", "QUEUED", "WAITING_FOR_HOST", "RUNNING", "ACTION_REQUIRED", "REVIEW_REQUIRED", "NO_MATCH", "FAILED", "CANCELLED", "VERIFIED_LOCAL"] as const;
export type NcTracksJobStatus = typeof NCTRACKS_JOB_STATUSES[number];
export type NcTracksCoverage = "ACTIVE" | "INACTIVE" | "UNKNOWN" | "CONFLICT";
export interface NcTracksSubject { firstName: string; lastName: string; dob: string; midNumber: string | null }
export interface NcTracksHostJob {
  id: string; leaseToken: string; leaseExpiresAt: string; attempt: number;
  subject: NcTracksSubject; authorizedNpi: string; serviceDateFrom: string; serviceDateTo: string;
}
export interface NcTracksHostResult {
  leaseToken: string;
  status: "VERIFIED_LOCAL" | "NO_MATCH" | "ACTION_REQUIRED" | "REVIEW_REQUIRED" | "FAILED";
  coverage: NcTracksCoverage;
  subject: NcTracksSubject;
  serviceDateFrom: string; serviceDateTo: string; authorizedNpi: string;
  provenance: { source: "NCTRACKS_PORTAL" | "NOT_OBSERVED"; observedAt: string; reference: string };
  actualInquiryFrom?: string;
  actualInquiryTo?: string;
  selectedCoveragePeriod?: string;
  sourceCarrierText?: string;
  sourceProviderText?: string;
  sourceFacilityText?: string;
  sourcePhoneText?: string;
  sourceCountyText?: string;
  artifactSha256?: string;
  code?: string;
}
export interface NcTracksJobView {
  id: string; intakeId: string; status: NcTracksJobStatus; coverage: NcTracksCoverage;
  subject: NcTracksSubject; serviceDateFrom: string; serviceDateTo: string;
  createdAt: string; updatedAt: string; attempt: number; code: string | null;
  result: Omit<NcTracksHostResult, "leaseToken"> | null;
}
export interface NcTracksContext {
  providerId: string;
  configuration: { authorizedNpi: string | null; configured: boolean; hostOnline: boolean; reason: string; canManage: boolean };
  intakes: Array<{ id: string; fullName: string; dob: string; midNumber: string | null }>;
  jobs: NcTracksJobView[];
}
