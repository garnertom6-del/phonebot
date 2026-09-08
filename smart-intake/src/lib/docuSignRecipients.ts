import type { FieldMapping } from "@/config/mooreDivinePacketMap";
import type { Answers } from "./fillPdf";
import { answeredClientFields } from "./clientAnswerSync";
import { preferredIntakeDeliveryRole, type ClientContactFields } from "./clientDeliveryContacts";
import { appliesToDocuSignSigner } from "./docusign";

export type DocuSignSignerRole = "client" | "guardian";

export type DocuSignSignerInput = {
  role: DocuSignSignerRole;
  email: string;
  name: string;
  recipientId: string;
  routingOrder: string;
};

export type DocuSignRecipientResult =
  | { ok: true; signers: DocuSignSignerInput[]; documentName: string }
  | { ok: false; status: "missing_email"; message: string };

function contactName(value: string | null | undefined, fallback = ""): string {
  return (value || fallback).trim();
}

function contactEmail(value: string | null | undefined): string {
  return (value || "").trim();
}

function hasApplicableGuardianTabs(
  answers: Answers,
  consents: Record<string, boolean>,
  fields: FieldMapping[],
): boolean {
  return fields.some((field) => (
    (field.type === "signature" || field.type === "signature_small" || field.source === "sign_date")
    && field.role === "guardian"
    && appliesToDocuSignSigner(field, answers, consents)
  ));
}

/**
 * Client-only stays the default. Guardian is added when delivery prefers the
 * guardian, or when mapped guardian tabs apply and a guardian is on file.
 * Preferred-guardian cases are guardian-only; otherwise client then guardian.
 */
export function resolveDocuSignRecipients(
  client: ClientContactFields & { fullName?: string | null; email?: string | null },
  answers: Answers,
  consents: Record<string, boolean>,
  fields: FieldMapping[],
): DocuSignRecipientResult {
  const answered = answeredClientFields(answers);
  const preferred = preferredIntakeDeliveryRole(client, answers);
  const clientName = contactName(client.fullName, answered.fullName);
  const clientEmail = contactEmail(client.email) || answered.email;
  const guardianName = contactName(client.guardianName, answered.guardianName);
  const guardianEmail = contactEmail(client.guardianEmail) || answered.guardianEmail;
  const guardianOnFile = !!(guardianName || guardianEmail);
  const includeGuardian = preferred === "guardian"
    || (guardianOnFile && hasApplicableGuardianTabs(answers, consents, fields));
  const includeClient = preferred !== "guardian";

  if (includeGuardian && (!guardianName || !guardianEmail)) {
    return {
      ok: false,
      status: "missing_email",
      message: !guardianName
        ? "Add a guardian name and email before DocuSign can include the guardian signer."
        : "Add a guardian email before DocuSign can include the guardian signer.",
    };
  }
  if (includeClient && !clientEmail) {
    return {
      ok: false,
      status: "missing_email",
      message: "Add a client email before DocuSign can be sent automatically.",
    };
  }

  const signers: DocuSignSignerInput[] = [];
  if (includeClient) {
    signers.push({
      role: "client",
      email: clientEmail,
      name: clientName || "Client",
      recipientId: "1",
      routingOrder: "1",
    });
  }
  if (includeGuardian) {
    signers.push({
      role: "guardian",
      email: guardianEmail,
      name: guardianName,
      recipientId: includeClient ? "2" : "1",
      routingOrder: includeClient ? "2" : "1",
    });
  }
  return {
    ok: true,
    signers,
    documentName: clientName || guardianName || "Client",
  };
}
