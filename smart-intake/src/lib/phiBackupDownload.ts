/** Staff-facing PHI dump. The confirm query is added only after an explicit dialog. */
export const PHI_BACKUP_PATH = "/api/admin/backup";

export const PHI_BACKUP_CONFIRM_MESSAGE =
  "This backup contains protected health information. Download it only to a private, encrypted location. Continue?";

/** Unconfirmed href has no confirmPhi param; confirmed URL is built only after the dialog. */
export function phiBackupDownloadUrl(confirmed: boolean): string {
  return confirmed ? `${PHI_BACKUP_PATH}?confirmPhi=yes` : PHI_BACKUP_PATH;
}
