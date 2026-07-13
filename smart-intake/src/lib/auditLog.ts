import { prisma } from "./prisma";

export type AuditEvent =
  | "intake_created" | "link_opened" | "section_started" | "section_completed"
  | "signature_captured" | "packet_submitted" | "staff_reviewed"
  | "pdf_generated" | "pdf_downloaded" | "link_reminder_sent"
  | "copies_link_sent" | "docusign_sent" | "answers_updated" | "document_uploaded" | "cca_imported"
  | "preflight_reviewed"
  | "preflight_overridden"
  | "cca_rescrubbed"
  | "signature_audited"
  | "signature_reminder_sent"
  | "packet_identity_override"
  | "provider_packet_approved"
  | "provider_packet_rolled_back"
  | "provider_status_changed"
  | "nctracks_lookup_not_configured" | "nctracks_lookup_completed" | "nctracks_lookup_failed"
  | "login_locked_out" | "backup_downloaded" | "document_downloaded" | "docusign_completed"
  | "provider_packet_uploaded" | "staff_user_created" | "staff_user_updated";

export async function audit(
  event: AuditEvent,
  opts: { providerId?: string; intakeId?: string; userId?: string; detail?: string; ip?: string } = {},
) {
  try {
    await prisma.auditLog.create({ data: { event, ...opts } });
  } catch (e) {
    console.error("audit log failed", e);
  }
}
