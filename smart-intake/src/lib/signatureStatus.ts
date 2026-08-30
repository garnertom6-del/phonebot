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

export type SignatureSlotKey = "client_guardian" | "staff_qp" | "witness" | "medical_director";

export interface SignatureStatus {
  key: string;
  label: string;
  state: "captured" | "missing" | "invalid";
  required: boolean;
  onPacket?: boolean;
  signedDate?: string;
  reason: string;
}

export type SignatureStatusContext = {
  client?: ClientIdentity;
  currentContentRevision?: number;
  latestMaterialUpdatedAt?: Date | string | null;
  mappedSlots?: SignatureSlotKey[];
  requiredSlots?: SignatureSlotKey[];
};

const ALWAYS_ON_PACKET: SignatureSlotKey[] = ["client_guardian", "staff_qp"];

function hasIntegrityContext(
  context?: SignatureStatusContext,
): context is SignatureStatusContext & { client: ClientIdentity; currentContentRevision: number } {
  return !!context?.client && context.currentContentRevision != null;
}

function bestSignature(
  signatures: SignatureSummary[],
  roles: string[],
  context?: SignatureStatusContext,
): SignatureSummary | undefined {
  const candidates = roles
    .map((role) => signatures.find((signature) => signature.role === role))
    .filter((signature): signature is SignatureSummary => !!signature);
  if (!hasIntegrityContext(context)) {
    return candidates.find((signature) => !signature.invalidatedAt) || candidates[0];
  }
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
  onPacket: boolean,
  signature: SignatureSummary | undefined,
  missingReason: string,
  context?: SignatureStatusContext,
): SignatureStatus {
  if (signature) {
    const integrity = hasIntegrityContext(context)
      ? signatureIntegrity(signature, context.client, context.currentContentRevision, context.latestMaterialUpdatedAt)
      : { valid: !signature.invalidatedAt, reason: signature.invalidatedReason || "The signature is no longer current." };
    return {
      key,
      label,
      state: integrity.valid ? "captured" : "invalid",
      required,
      onPacket,
      signedDate: signature.signedDate || undefined,
      reason: integrity.reason,
    };
  }
  return { key, label, state: "missing", required, onPacket, reason: missingReason };
}

function slotOnPacket(key: SignatureSlotKey, mappedSlots?: SignatureSlotKey[]): boolean {
  if (!mappedSlots?.length) return ALWAYS_ON_PACKET.includes(key);
  return mappedSlots.includes(key) || ALWAYS_ON_PACKET.includes(key);
}

/** Map packet signature field roles onto the four staff-case slots. */
export function mappedSignatureSlotsFromFields(
  fields: Array<{ type?: string | null; role?: string | null }>,
): SignatureSlotKey[] {
  const slots = new Set<SignatureSlotKey>();
  for (const field of fields) {
    if (field.type !== "signature" && field.type !== "signature_small") continue;
    const role = field.role;
    if (role === "client" || role === "guardian" || role === "auto") slots.add("client_guardian");
    if (role === "staff" || role === "clinician") slots.add("staff_qp");
    if (role === "witness") slots.add("witness");
    if (role === "medicalDirector") slots.add("medical_director");
  }
  return [...slots];
}

/**
 * Signature slots explicitly marked required by the reviewed packet map.
 * A blank line appearing on a form does not by itself make that signer
 * applicable to every client (for example, Medical Director or Witness).
 */
export function requiredSignatureSlotsFromFields(
  fields: Array<{ type?: string | null; role?: string | null; required?: boolean | null }>,
): SignatureSlotKey[] {
  return mappedSignatureSlotsFromFields(fields.filter((field) => field.required === true));
}

export function requiredSignatureStatuses(statuses: SignatureStatus[]): SignatureStatus[] {
  return statuses.filter((status) => status.required);
}

export function missingRequiredSignatures(statuses: SignatureStatus[]): SignatureStatus[] {
  return requiredSignatureStatuses(statuses).filter((status) => status.state !== "captured");
}

function signatureNeedsAction(status: SignatureStatus): boolean {
  return (status.required || !!status.onPacket) && status.state !== "captured";
}

export const DOCUSIGN_SEND_CONFIRM =
  "Send the missing signature fields through DocuSign? Missing staff fields will be routed to your signed-in staff account.";

export function signatureSendHint(input: {
  packetReady: boolean;
  packetMessage?: string;
  statuses: SignatureStatus[];
  docusignEnvelopeId?: string | null;
}): { enabled: boolean; title: string; reason: string } {
  const hint = (enabled: boolean, title: string) => ({ enabled, title, reason: title });
  if (!input.packetReady) {
    return hint(false, input.packetMessage || "Master admin must approve and activate this provider's packet first.");
  }
  if (input.docusignEnvelopeId) {
    return hint(false, "A DocuSign envelope is already in progress. Check DocuSign status instead of sending another.");
  }
  const pending = input.statuses.filter(signatureNeedsAction);
  if (!pending.length) {
    return hint(false, "No missing signatures to send.");
  }
  const invalid = pending.filter((status) => status.state === "invalid");
  if (invalid.length) {
    const first = invalid[0];
    return hint(true, `${first.label} needs to be re-signed: ${first.reason}`);
  }
  const labels = pending.map((status) => status.label).join(", ");
  return hint(true, `Send missing signature fields through DocuSign (${labels}).`);
}

/** Never swallow a Send missing signatures click — blocked sends still return a visible reason. */
export function beginSignatureSend(hint: { enabled: boolean; title: string }):
  | { action: "blocked"; message: string }
  | { action: "proceed"; confirm: string } {
  if (!hint.enabled) return { action: "blocked", message: hint.title };
  return { action: "proceed", confirm: DOCUSIGN_SEND_CONFIRM };
}

/**
 * Explains each signature slot without treating unmapped clinical signatures
 * as client errors. Packet-mapped witness / medical director slots are required
 * before send/complete. Client / guardian and Staff / QP stay required.
 */
export function buildSignatureStatuses(
  signatures: SignatureSummary[],
  context?: SignatureStatusContext,
): SignatureStatus[] {
  const mappedSlots = context?.mappedSlots;
  const requiredSlots = context?.requiredSlots;
  const witnessOnPacket = slotOnPacket("witness", mappedSlots);
  const medicalOnPacket = slotOnPacket("medical_director", mappedSlots);
  // Keep the old mapped-slot behavior for callers that have not supplied a
  // reviewed required-slot profile. Packet-aware callers pass requiredSlots,
  // including an empty array when all special-role lines are optional.
  const witnessRequired = requiredSlots
    ? requiredSlots.includes("witness")
    : witnessOnPacket && !!mappedSlots?.includes("witness");
  const medicalRequired = requiredSlots
    ? requiredSlots.includes("medical_director")
    : medicalOnPacket && !!mappedSlots?.includes("medical_director");
  return [
    capturedStatus(
      "client_guardian",
      "Client / guardian",
      true,
      true,
      bestSignature(signatures, ["client", "guardian"], context),
      "Not signed yet; the client or guardian signs in the secure SMS intake.",
      context,
    ),
    capturedStatus(
      "staff_qp",
      "Staff / QP",
      true,
      true,
      bestSignature(signatures, ["staff"], context),
      "Not collected by SMS; staff adds this signature on the review screen.",
      context,
    ),
    capturedStatus(
      "witness",
      "Witness",
      witnessRequired,
      witnessOnPacket,
      bestSignature(signatures, ["witness"], context),
      mappedSlots?.includes("witness")
        ? witnessRequired
          ? "This packet requires a witness signature. Staff adds it on the review screen."
          : "This packet includes an optional witness line; add it only when applicable."
        : "Not on this packet; add only if the form calls for a witness.",
      context,
    ),
    capturedStatus(
      "medical_director",
      "Medical Director",
      medicalRequired,
      medicalOnPacket,
      bestSignature(signatures, ["medicalDirector"], context),
      mappedSlots?.includes("medical_director")
        ? medicalRequired
          ? "This packet requires a Medical Director signature. Staff adds it on the review screen."
          : "This packet includes an optional Medical Director line; add it only when applicable."
        : "Not on this packet; add only if the clinical form requires it.",
      context,
    ),
  ];
}
