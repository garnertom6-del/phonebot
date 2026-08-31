import { SECTIONS, questionCatalogId, questionVisibleInCatalog } from "@/config/mooreDivineQuestions";
import { askIfSatisfied } from "@/lib/validation";
import type { SignatureStatus } from "@/lib/signatureStatus";
import { missingRequiredSignatures } from "@/lib/signatureStatus";

export type PacketChecklistState = "keep" | "missing" | "na";

export type PacketChecklistChip = {
  key: string;
  label: string;
  state: PacketChecklistState;
};

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === false || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function staffCheckState(
  answers: Record<string, unknown>,
  staffKey: string,
  evidence: boolean,
): PacketChecklistState {
  const marked = String(answers[staffKey] || "").trim().toLowerCase();
  if (marked === "no") return "na";
  if (marked === "yes" || evidence) return "keep";
  return "missing";
}

function hasDocType(documents: Array<{ docType: string }>, types: string[]): boolean {
  const wanted = new Set(types.map((type) => type.toUpperCase()));
  return documents.some((document) => wanted.has(document.docType.toUpperCase()));
}

function consentsState(
  answers: Record<string, unknown>,
  provider?: { name?: string | null; slug?: string | null } | string | null,
): PacketChecklistState {
  const catalogId = questionCatalogId(provider);
  const required = SECTIONS.flatMap((section) => section.questions).filter((question) => (
    question.type === "consent"
    && question.required
    && questionVisibleInCatalog(question, catalogId)
    && askIfSatisfied(question.askIf, answers)
  ));
  if (!required.length) return "na";
  const complete = required.every((question) => answers[question.key] === true || answers[question.key] === "Yes");
  return complete ? "keep" : "missing";
}

function planChipState(summary?: { state: string }): PacketChecklistState {
  if (!summary || summary.state === "not_started") return "na";
  return summary.state === "complete" ? "keep" : "missing";
}

/**
 * Paper EWC-style packet items staff can scan without opening the PDF.
 * Keep/missing/N/A only from answers, uploads, and signatures already on the case.
 */
export function buildPacketChecklistChips(input: {
  answers: Record<string, unknown>;
  uploadedDocuments: Array<{ docType: string }>;
  expectCca: boolean;
  hasCca: boolean;
  signatureStatuses: SignatureStatus[];
  provider?: { name?: string | null; slug?: string | null } | string | null;
  planCompleteness?: {
    pcp: { state: string };
    crisis: { state: string };
  };
}): PacketChecklistChip[] {
  const additionalEvals = Array.isArray(input.answers.additional_evals)
    ? input.answers.additional_evals.map((value) => String(value).toLowerCase())
    : String(input.answers.additional_evals || "").toLowerCase();
  const psychEvidence = Array.isArray(additionalEvals)
    ? additionalEvals.some((value) => value.includes("psycholog"))
    : additionalEvals.includes("psycholog");
  const signatureMissing = missingRequiredSignatures(input.signatureStatuses);

  return [
    {
      key: "social_history",
      label: "Social history",
      state: staffCheckState(
        input.answers,
        "staff_chk_social_history",
        hasValue(input.answers.social_family_medical_history) || hasValue(input.answers.mh_history),
      ),
    },
    {
      key: "psych_eval",
      label: "Psychological evaluation",
      state: staffCheckState(input.answers, "staff_chk_psych_eval", psychEvidence),
    },
    {
      key: "birth_id",
      label: "Birth certificate / ID",
      state: staffCheckState(
        input.answers,
        "staff_chk_birth_cert",
        hasDocType(input.uploadedDocuments, ["birth_certificate", "photo_id"]),
      ),
    },
    {
      key: "medications",
      label: "Medications",
      state: staffCheckState(
        input.answers,
        "staff_chk_medications",
        hasValue(input.answers.medications)
          || hasValue(input.answers.otc_medications)
          || hasDocType(input.uploadedDocuments, ["medication_list"]),
      ),
    },
    {
      key: "consents",
      label: "Consents",
      state: consentsState(input.answers, input.provider),
    },
    {
      key: "cca",
      label: "CCA",
      state: !input.expectCca ? "na" : input.hasCca ? "keep" : "missing",
    },
    {
      key: "signatures",
      label: "Signatures",
      state: signatureMissing.length ? "missing" : "keep",
    },
    {
      key: "pcp_plan",
      label: "PCP / person-centered plan",
      state: planChipState(input.planCompleteness?.pcp),
    },
    {
      key: "crisis_plan",
      label: "Crisis plan",
      state: planChipState(input.planCompleteness?.crisis),
    },
  ];
}
