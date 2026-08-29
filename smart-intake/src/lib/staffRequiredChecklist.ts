import { humanFieldLabel } from "@/lib/fieldLabels";
import type { SignatureStatus } from "@/lib/signatureStatus";
import type { MissingField } from "@/lib/validation";

const SIGNATURE_CHECKLIST_KEY: Record<string, string> = {
  client_guardian: "signature",
  staff_qp: "signature_staff_qp",
  witness: "signature_witness",
  medical_director: "signature_medical_director",
};

/**
 * One required-item list for the staff checklist and dashboard missing-items
 * preview. Packet answers, expected CCA, and required signature slots share
 * this definition so "all required complete" cannot appear while CCA or a
 * required signature is still missing.
 */
export function buildStaffRequiredChecklist(input: {
  missingRequired: MissingField[];
  expectCca: boolean;
  hasCca: boolean;
  signatureStatuses: Array<Pick<SignatureStatus, "key" | "label" | "state" | "required">>;
}): MissingField[] {
  const items: MissingField[] = input.missingRequired.map((field) => ({
    ...field,
    label: humanFieldLabel(field.key, field.label),
  }));
  const keys = new Set(items.map((item) => item.key));

  if (input.expectCca && !input.hasCca && !keys.has("cca")) {
    items.push({ key: "cca", label: humanFieldLabel("cca") });
    keys.add("cca");
  }

  for (const status of input.signatureStatuses) {
    if (!status.required || status.state === "captured") continue;
    const key = SIGNATURE_CHECKLIST_KEY[status.key] || `signature_${status.key}`;
    if (keys.has(key)) continue;
    items.push({
      key,
      label: status.key === "client_guardian"
        ? humanFieldLabel("signature", status.label)
        : `${status.label} signature`,
    });
    keys.add(key);
  }

  return items;
}

export function checklistIsComplete(items: MissingField[]): boolean {
  return items.length === 0;
}
