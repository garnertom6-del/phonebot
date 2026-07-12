export interface SignatureSummary {
  role: string;
  printedName: string;
  signedDate: string;
}

export interface SignatureStatus {
  key: string;
  label: string;
  state: "captured" | "missing";
  required: boolean;
  signedDate?: string;
  reason: string;
}

function firstSignature(
  signatures: SignatureSummary[],
  roles: string[],
): SignatureSummary | undefined {
  return roles.map((role) => signatures.find((signature) => signature.role === role))
    .find((signature): signature is SignatureSummary => !!signature);
}

function capturedStatus(
  key: string,
  label: string,
  required: boolean,
  signature: SignatureSummary | undefined,
  missingReason: string,
): SignatureStatus {
  if (signature) {
    return {
      key,
      label,
      state: "captured",
      required,
      signedDate: signature.signedDate || undefined,
      reason: "",
    };
  }
  return { key, label, state: "missing", required, reason: missingReason };
}

/**
 * Explains each signature slot without treating optional clinical signatures
 * as client errors. This is shared by the review screen and the PDF certificate.
 */
export function buildSignatureStatuses(signatures: SignatureSummary[]): SignatureStatus[] {
  return [
    capturedStatus(
      "client_guardian",
      "Client / guardian",
      true,
      firstSignature(signatures, ["client", "guardian"]),
      "Not signed yet; the client or guardian signs in the secure SMS intake.",
    ),
    capturedStatus(
      "staff_qp",
      "Staff / QP",
      false,
      firstSignature(signatures, ["staff", "clinician"]),
      "Not collected by SMS; staff adds this signature on the review screen.",
    ),
    capturedStatus(
      "witness",
      "Witness",
      false,
      firstSignature(signatures, ["witness"]),
      "Not recorded; only needed when the applicable form calls for a witness.",
    ),
    capturedStatus(
      "medical_director",
      "Medical Director",
      false,
      firstSignature(signatures, ["medicalDirector"]),
      "Not recorded; only needed when the applicable clinical form requires it.",
    ),
  ];
}
