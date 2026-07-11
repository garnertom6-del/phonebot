import type { Answers } from "./fillPdf";

type InsurancePlanMap = {
  key: string;
  aliases: string[];
  providerChoice: string;
  mco?: string;
};

const INSURANCE_PLAN_MAP: InsurancePlanMap[] = [
  { key: "amerihealth", aliases: ["amerihealth"], providerChoice: "AmeriHealth", mco: "AmeriHealth" },
  { key: "alliance", aliases: ["alliance"], providerChoice: "Alliance", mco: "Alliance" },
  { key: "bcbs", aliases: ["bcbs", "blue cross", "blue cross blue shield"], providerChoice: "Blue Cross Blue Shield" },
  { key: "partners", aliases: ["partners", "partners bh", "partners behavioral health"], providerChoice: "Partners Behavioral Health", mco: "Partners BH" },
  { key: "carolina-complete", aliases: ["carolina complete"], providerChoice: "Carolina Complete", mco: "Carolina Complete" },
  { key: "trillium", aliases: ["trillium", "sandhills center", "sandhills center/trillium"], providerChoice: "Sandhills Center/Trillium", mco: "Trillium" },
  { key: "healthy-blue", aliases: ["healthy blue", "healthy blue medicaid"], providerChoice: "Healthy Blue", mco: "Healthy Blue Medicaid" },
  { key: "vaya", aliases: ["vaya"], providerChoice: "Vaya", mco: "Vaya" },
  { key: "medicaid", aliases: ["medicaid"], providerChoice: "Medicaid" },
  { key: "united", aliases: ["united", "united health care", "united healthcare"], providerChoice: "United Health Care", mco: "United Healthcare" },
  { key: "wellcare", aliases: ["wellcare"], providerChoice: "Wellcare", mco: "Wellcare" },
  { key: "not-sure", aliases: ["not sure", "unknown"], providerChoice: "Not sure", mco: "Not sure" },
];

export const PROVIDER_CHOICE_PLAN_OPTIONS = INSURANCE_PLAN_MAP.map((item) => item.providerChoice);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchingPlan(value: string): InsurancePlanMap | undefined {
  const key = normalizedKey(value);
  if (!key) return undefined;
  return INSURANCE_PLAN_MAP.find((plan) =>
    plan.aliases.some((alias) => {
      const normalizedAlias = normalizedKey(alias);
      return key === normalizedAlias || key.includes(normalizedAlias) || normalizedAlias.includes(key);
    }));
}

export function normalizeInsuranceValue(value: string, target: "providerChoice" | "mco"): string {
  const cleaned = text(value);
  if (!cleaned) return "";
  const plan = matchingPlan(cleaned);
  if (!plan) return cleaned;
  return target === "providerChoice" ? plan.providerChoice : (plan.mco || "");
}

export function applyInsurancePlanDefaults(a: Answers) {
  const providerChoice = text(a.provider_choice_plan);
  const mco = text(a.mco);
  if (!providerChoice && mco) {
    const normalized = normalizeInsuranceValue(mco, "providerChoice");
    if (normalized) a.provider_choice_plan = normalized;
  }
  if (!mco && providerChoice) {
    const normalized = normalizeInsuranceValue(providerChoice, "mco");
    if (normalized) a.mco = normalized;
  }
}

export function insuranceSummary(answers: Record<string, unknown>): string {
  const parts: string[] = [];
  if (text(answers.has_medicaid) === "Yes") parts.push("Medicaid");
  if (text(answers.has_nchc) === "Yes") parts.push("NCHC");
  const plan = text(answers.provider_choice_plan) && text(answers.provider_choice_plan) !== "Not sure"
    ? text(answers.provider_choice_plan)
    : text(answers.mco);
  if (plan && plan !== "Not sure" && !parts.some((part) => part.toLowerCase() === plan.toLowerCase())) {
    parts.push(plan);
  }
  return parts.join(" | ") || "Coverage not recorded";
}
