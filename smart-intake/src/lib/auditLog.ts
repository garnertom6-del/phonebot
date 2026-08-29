import { prisma } from "./prisma";

export type AuditEvent =
  | "intake_created" | "link_opened" | "section_started" | "section_completed"
  | "signature_captured" | "packet_submitted" | "staff_reviewed"
  | "pdf_generated" | "pdf_downloaded" | "link_reminder_sent" | "link_reminder_failed" | "link_sent_manually"
  | "copies_link_sent" | "copies_link_failed" | "docusign_sent" | "answers_updated" | "document_uploaded" | "cca_imported"
  | "provider_packet_email_sent"
  | "preflight_reviewed"
  | "preflight_overridden"
  | "preflight_corrected"
  | "follow_up_created"
  | "follow_up_sent"
  | "follow_up_delivery_failed"
  | "follow_up_opened"
  | "follow_up_completed"
  | "cca_rescrubbed"
  | "signature_audited"
  | "signature_reminder_sent" | "signature_reminder_failed"
  | "packet_identity_override"
  | "provider_packet_approved"
  | "provider_packet_rolled_back"
  | "provider_status_changed"
  | "nctracks_lookup_not_configured" | "nctracks_lookup_completed" | "nctracks_lookup_failed"
  | "login_locked_out" | "backup_downloaded" | "document_downloaded" | "docusign_completed"
  | "provider_portal_notification_sent"
  | "provider_created" | "provider_admin_updated"
  | "provider_packet_uploaded" | "provider_packet_ai_mapped" | "provider_profile_deleted" | "staff_user_created" | "staff_user_updated";

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
