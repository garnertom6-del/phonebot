import type { NcTracksJobStatus } from "./ncTracksJobTypes";

export const NCTRACKS_STATUS_LABELS: Record<NcTracksJobStatus, string> = {
  NOT_CONFIGURED: "Setup required", QUEUED: "Queued", WAITING_FOR_HOST: "Waiting for workstation",
  RUNNING: "Lookup running", ACTION_REQUIRED: "Workstation needs attention", REVIEW_REQUIRED: "Review required",
  NO_MATCH: "No matching result", FAILED: "Lookup failed", CANCELLED: "Cancelled", VERIFIED_LOCAL: "Saved on workstation",
};
export const NCTRACKS_STATUS_DETAILS: Record<NcTracksJobStatus, string> = {
  NOT_CONFIGURED: "A provider administrator must finish setup before this lookup can run.",
  QUEUED: "The request is saved and waiting for the authorized workstation to claim it.",
  WAITING_FOR_HOST: "The request is saved. It will wait until the authorized workstation is connected and ready.",
  RUNNING: "The authorized workstation has claimed this request. Review the returned evidence when it finishes.",
  ACTION_REQUIRED: "An authorized operator must check the workstation. This page never asks for a portal password or one-time code.",
  REVIEW_REQUIRED: "The returned information needs staff review. It has not changed this client's intake or coverage record.",
  NO_MATCH: "No matching result was returned for this request. This does not prove that the client lacks coverage.",
  FAILED: "The lookup did not finish successfully. Check the request and workstation before retrying.",
  CANCELLED: "This request is cancelled. It will not accept a later result.",
  VERIFIED_LOCAL: "The source PDF is saved on the workstation. Review identity, service dates, and coverage there before using it. The PDF is not attached to this intake.",
};
export const NCTRACKS_POLL_STATUSES = new Set<NcTracksJobStatus>(["QUEUED", "WAITING_FOR_HOST", "RUNNING"]);
export const NCTRACKS_RETRY_STATUSES = new Set<NcTracksJobStatus>(["NOT_CONFIGURED", "ACTION_REQUIRED", "REVIEW_REQUIRED", "NO_MATCH", "FAILED", "CANCELLED"]);
export const NCTRACKS_CANCEL_STATUSES = new Set<NcTracksJobStatus>(["NOT_CONFIGURED", "QUEUED", "WAITING_FOR_HOST", "RUNNING", "ACTION_REQUIRED", "REVIEW_REQUIRED", "FAILED"]);

export function localDateOnly(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** A DOB is a date, never a timestamp converted through the device timezone. */
export function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Accept explicit saved calendar dates without inferring two-digit years. */
export function savedLookupDob(value: string): string {
  if (validDateOnly(value)) return value;
  const match = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(value.trim());
  if (!match) return "";
  const candidate = `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return validDateOnly(candidate) ? candidate : "";
}

export function ncTracksSourceText(value: string | null | undefined): string {
  return value?.trim() ? value : "Not shown on NCTracks response";
}

export function lookupFormError(input: { intakeId: string; firstName: string; lastName: string; dob: string; serviceDateFrom: string; serviceDateTo: string }): string {
  if (!input.intakeId) return "Choose an existing intake first.";
  if (!input.firstName.trim() || !input.lastName.trim()) return "Enter the client's saved first and last names in their separate fields.";
  if (!validDateOnly(input.dob)) return "The saved date of birth needs correction in the intake before a lookup can be requested.";
  if (!validDateOnly(input.serviceDateFrom) || !validDateOnly(input.serviceDateTo)) return "Enter valid service dates.";
  if (input.serviceDateTo < input.serviceDateFrom) return "The service end date must be on or after the start date.";
  return "";
}
