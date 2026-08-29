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

export function requiredSignatureStatuses(statuses: SignatureStatus[]): SignatureStatus[] {
  return statuses.filter((status) => status.required);
}

export function missingRequiredSignatures(statuses: SignatureStatus[]): SignatureStatus[] {
  return requiredSignatureStatuses(statuses).filter((status) => status.state !== "captured");
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
  const witnessOnPacket = slotOnPacket("witness", mappedSlots);
  const medicalOnPacket = slotOnPacket("medical_director", mappedSlots);
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
      witnessOnPacket && !!mappedSlots?.includes("witness"),
      witnessOnPacket,
      bestSignature(signatures, ["witness"], context),
      mappedSlots?.includes("witness")
        ? "This packet has a witness signature line. Staff adds it on the review screen."
        : "Not on this packet; add only if the form calls for a witness.",
      context,
    ),
    capturedStatus(
      "medical_director",
      "Medical Director",
      medicalOnPacket && !!mappedSlots?.includes("medical_director"),
      medicalOnPacket,
      bestSignature(signatures, ["medicalDirector"], context),
      mappedSlots?.includes("medical_director")
        ? "This packet has a Medical Director signature line. Staff adds it on the review screen."
        : "Not on this packet; add only if the clinical form requires it.",
      context,
    ),
  ];
}
