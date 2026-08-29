import {
  signatureIntegrity,
  type ClientIdentity,
  type IntegritySignature,
} from "@/lib/recordIntegrity";

export interface SignatureSummary extends IntegritySignature {
  role: string;
  printedName: string;
  signedDate: string;
}

export interface SignatureStatus {
  key: string;
  label: string;
  state: "captured" | "missing" | "invalid";
  required: boolean;
  signedDate?: string;
  reason: string;
}

export type SignatureStatusContext = {
  client: ClientIdentity;
  currentContentRevision: number;
  latestMaterialUpdatedAt?: Date | string | null;
};

function bestSignature(
  signatures: SignatureSummary[],
  roles: string[],
  context?: SignatureStatusContext,
): SignatureSummary | undefined {
  const candidates = roles
    .map((role) => signatures.find((signature) => signature.role === role))
    .filter((signature): signature is SignatureSummary => !!signature);
  if (!context) return candidates.find((signature) => !signature.invalidatedAt) || candidates[0];
  return candidates.find((signature) => signatureIntegrity(
    signature,
    context.client,
    context.currentContentRevision,
    context.latestMaterialUpdatedAt,
  ).valid) || candidates[0];
}

function capturedStatus(
  key: string,
  label: string,
  required: boolean,
  signature: SignatureSummary | undefined,
  missingReason: string,
  context?: SignatureStatusContext,
): SignatureStatus {
  if (signature) {
    const integrity = context
      ? signatureIntegrity(signature, context.client, context.currentContentRevision, context.latestMaterialUpdatedAt)
      : { valid: !signature.invalidatedAt, reason: signature.invalidatedReason || "The signature is no longer current." };
    return {
      key,
      label,
      state: integrity.valid ? "captured" : "invalid",
      required,
      signedDate: signature.signedDate || undefined,
      reason: integrity.reason,
    };
  }
  return { key, label, state: "missing", required, reason: missingReason };
}

/**
 * Explains each signature slot without treating optional clinical signatures
 * as client errors. This is shared by the review screen and the PDF certificate.
 */
export function buildSignatureStatuses(
  signatures: SignatureSummary[],
  context?: SignatureStatusContext,
): SignatureStatus[] {
  return [
    capturedStatus(
      "client_guardian",
      "Client / guardian",
      true,
      bestSignature(signatures, ["client", "guardian"], context),
      "Not signed yet; the client or guardian signs in the secure SMS intake.",
      context,
    ),
    capturedStatus(
      "staff_qp",
      "Staff / QP",
      true,
      bestSignature(signatures, ["staff"], context),
      "Not collected by SMS; staff adds this signature on the review screen.",
      context,
    ),
    capturedStatus(
      "witness",
      "Witness",
      false,
      bestSignature(signatures, ["witness"], context),
      "Not recorded; only needed when the applicable form calls for a witness.",
      context,
    ),
    capturedStatus(
      "medical_director",
      "Medical Director",
      false,
      bestSignature(signatures, ["medicalDirector"], context),
      "Not recorded; only needed when the applicable clinical form requires it.",
      context,
    ),
  ];
}
